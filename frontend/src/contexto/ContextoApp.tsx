import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../api/cliente";
import type { CentroCosto, Cuenta, Empresa, IndicadorImpuesto, Sociedad, Tercero } from "../api/tipos";

export interface OperacionGasto {
  operacion: string;
  cuentaId: string;
  cuentaNombre: string;
  requiereCentroCosto: boolean;
}

interface EstadoContextoApp {
  cargando: boolean;
  error: string | null;

  empresas: Empresa[];
  empresaId: string;
  setEmpresaId: (id: string) => void;

  sociedades: Sociedad[];
  sociedadId: string;
  setSociedadId: (id: string) => void;
  sociedad: Sociedad | null;

  proveedores: Tercero[];
  centrosCosto: CentroCosto[];
  indicadoresImpuesto: IndicadorImpuesto[];
  operacionesGasto: OperacionGasto[];
  cuentasPorId: Map<string, Cuenta>;

  usuario: string;
  setUsuario: (usuario: string) => void;

  recargarDatosSociedad: () => void;
}

const ContextoApp = createContext<EstadoContextoApp | null>(null);

const CLAVE_USUARIO = "erp.usuario";
const CLAVE_EMPRESA = "erp.empresaId";
const CLAVE_SOCIEDAD = "erp.sociedadId";

export function ProveedorContextoApp({ children }: { children: ReactNode }): React.JSX.Element {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaIdState] = useState<string>(() => localStorage.getItem(CLAVE_EMPRESA) ?? "");

  const [sociedades, setSociedades] = useState<Sociedad[]>([]);
  const [sociedadId, setSociedadIdState] = useState<string>(
    () => localStorage.getItem(CLAVE_SOCIEDAD) ?? "",
  );

  const [proveedores, setProveedores] = useState<Tercero[]>([]);
  const [centrosCosto, setCentrosCosto] = useState<CentroCosto[]>([]);
  const [indicadoresImpuesto, setIndicadoresImpuesto] = useState<IndicadorImpuesto[]>([]);
  const [operacionesGasto, setOperacionesGasto] = useState<OperacionGasto[]>([]);
  const [cuentasPorId, setCuentasPorId] = useState<Map<string, Cuenta>>(new Map());

  const [usuario, setUsuarioState] = useState<string>(
    () => localStorage.getItem(CLAVE_USUARIO) ?? "contabilidad@demo",
  );
  const [version, setVersion] = useState(0);

  const setEmpresaId = useCallback((id: string) => {
    localStorage.setItem(CLAVE_EMPRESA, id);
    setEmpresaIdState(id);
    setSociedadIdState("");
  }, []);
  const setSociedadId = useCallback((id: string) => {
    localStorage.setItem(CLAVE_SOCIEDAD, id);
    setSociedadIdState(id);
  }, []);
  const setUsuario = useCallback((valor: string) => {
    localStorage.setItem(CLAVE_USUARIO, valor);
    setUsuarioState(valor);
  }, []);
  const recargarDatosSociedad = useCallback(() => setVersion((v) => v + 1), []);

  // Empresas -> elegir la persistida o la primera.
  useEffect(() => {
    api
      .listarEmpresas()
      .then((lista) => {
        setEmpresas(lista);
        if (lista.length === 0) return;
        const persistida = lista.find((e) => e.id === empresaId);
        if (!persistida) setEmpresaIdState(lista[0]!.id);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    // Solo al montar: cambios posteriores de empresaId no deben re-listar empresas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sociedades de la empresa activa + proveedores (empresa-scoped).
  useEffect(() => {
    if (!empresaId) return;
    setCargando(true);
    Promise.all([api.listarSociedades(empresaId), api.listarTerceros(empresaId)])
      .then(([listaSociedades, listaTerceros]) => {
        setSociedades(listaSociedades);
        setProveedores(listaTerceros.filter((t) => t.es_proveedor));
        if (listaSociedades.length === 0) return;
        const persistida = listaSociedades.find((s) => s.id === sociedadId);
        setSociedadIdState(persistida ? persistida.id : listaSociedades[0]!.id);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empresaId]);

  const sociedad = useMemo(
    () => sociedades.find((s) => s.id === sociedadId) ?? null,
    [sociedades, sociedadId],
  );

  // Catálogos de la sociedad activa: centros de costo, indicadores, reglas -> operaciones de gasto.
  useEffect(() => {
    if (!sociedad) return;
    setCargando(true);
    setError(null);
    Promise.all([
      api.listarCentrosCosto(sociedad.id),
      api.listarIndicadoresImpuesto(sociedad.id),
      api.listarReglasDeterminacion(sociedad.id),
      api.listarCuentas(sociedad.plan_cuentas_id),
    ])
      .then(([listaCentros, listaIndicadores, listaReglas, listaCuentas]) => {
        setCentrosCosto(listaCentros);
        setIndicadoresImpuesto(listaIndicadores);
        const mapaCuentas = new Map(listaCuentas.map((c) => [c.id, c]));
        setCuentasPorId(mapaCuentas);
        // Convención del seed (docs/01 §5): las categorías de gasto capturables
        // por el usuario son las reglas AP.GASTO_*; AP.CXP_DEFAULT,
        // BK.BANCO_DEFAULT y AP.NC_CONTRAPARTIDA son cuentas de sistema.
        const gastos = listaReglas
          .filter((r) => r.modulo === "AP" && r.operacion.startsWith("AP.GASTO_"))
          .map((r) => {
            const cuenta = mapaCuentas.get(r.cuenta_id);
            return {
              operacion: r.operacion,
              cuentaId: r.cuenta_id,
              cuentaNombre: cuenta?.nombre ?? r.operacion,
              requiereCentroCosto: cuenta?.requiere_centro_costo ?? false,
            };
          })
          .sort((a, b) => a.cuentaNombre.localeCompare(b.cuentaNombre));
        setOperacionesGasto(gastos);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setCargando(false));
  }, [sociedad, version]);

  const valor: EstadoContextoApp = {
    cargando,
    error,
    empresas,
    empresaId,
    setEmpresaId,
    sociedades,
    sociedadId,
    setSociedadId,
    sociedad,
    proveedores,
    centrosCosto,
    indicadoresImpuesto,
    operacionesGasto,
    cuentasPorId,
    usuario,
    setUsuario,
    recargarDatosSociedad,
  };

  return <ContextoApp.Provider value={valor}>{children}</ContextoApp.Provider>;
}

export function useContextoApp(): EstadoContextoApp {
  const contexto = useContext(ContextoApp);
  if (!contexto) {
    throw new Error("useContextoApp debe usarse dentro de <ProveedorContextoApp>.");
  }
  return contexto;
}
