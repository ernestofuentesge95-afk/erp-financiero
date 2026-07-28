import type {
  AntiguedadProveedor,
  CentroCosto,
  Cuenta,
  Documento,
  Empresa,
  IndicadorImpuesto,
  PartidaAbiertaReporte,
  ReglaDeterminacionCuenta,
  RegistrarFacturaInput,
  RegistrarPagoInput,
  ResultadoPago,
  Sociedad,
  Tercero,
} from "./tipos";

export class ApiError extends Error {
  readonly codigo: string;
  readonly status: number;

  constructor(codigo: string, message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.codigo = codigo;
    this.status = status;
  }
}

async function solicitar<T>(ruta: string, opciones?: RequestInit): Promise<T> {
  const respuesta = await fetch(`/api${ruta}`, {
    ...opciones,
    headers: { "Content-Type": "application/json", ...opciones?.headers },
  });

  if (!respuesta.ok) {
    const cuerpo = (await respuesta.json().catch(() => null)) as
      | { error?: string; message?: string }
      | null;
    throw new ApiError(
      cuerpo?.error ?? "ERROR_DESCONOCIDO",
      cuerpo?.message ?? `Error ${respuesta.status} al llamar ${ruta}`,
      respuesta.status,
    );
  }
  if (respuesta.status === 204) {
    return undefined as T;
  }
  return (await respuesta.json()) as T;
}

function post<T>(ruta: string, cuerpo: unknown): Promise<T> {
  return solicitar<T>(ruta, { method: "POST", body: JSON.stringify(cuerpo) });
}

function query(params: Record<string, string | undefined>): string {
  const entradas = Object.entries(params).filter((par): par is [string, string] => par[1] !== undefined);
  if (entradas.length === 0) return "";
  return `?${new URLSearchParams(entradas).toString()}`;
}

export const api = {
  listarEmpresas: (): Promise<Empresa[]> => solicitar("/empresas"),
  listarSociedades: (empresaId: string): Promise<Sociedad[]> =>
    solicitar(`/empresas/${empresaId}/sociedades`),
  listarTerceros: (empresaId: string): Promise<Tercero[]> => solicitar(`/empresas/${empresaId}/terceros`),
  listarCentrosCosto: (sociedadId: string): Promise<CentroCosto[]> =>
    solicitar(`/sociedades/${sociedadId}/centros-costo`),
  listarIndicadoresImpuesto: (sociedadId: string): Promise<IndicadorImpuesto[]> =>
    solicitar(`/sociedades/${sociedadId}/indicadores-impuesto`),
  listarReglasDeterminacion: (sociedadId: string): Promise<ReglaDeterminacionCuenta[]> =>
    solicitar(`/sociedades/${sociedadId}/reglas-determinacion`),
  listarCuentas: (planCuentasId: string): Promise<Cuenta[]> =>
    solicitar(`/planes-cuenta/${planCuentasId}/cuentas`),

  registrarFactura: (input: RegistrarFacturaInput): Promise<Documento> => post("/cxp/facturas", input),
  registrarPago: (input: RegistrarPagoInput): Promise<ResultadoPago> => post("/cxp/pagos", input),

  partidasAbiertas: (params: {
    sociedadId: string;
    terceroId?: string;
    fechaCorte?: string;
  }): Promise<PartidaAbiertaReporte[]> => solicitar(`/cxp/partidas-abiertas${query(params)}`),

  antiguedad: (params: { sociedadId: string; fechaCorte?: string }): Promise<AntiguedadProveedor[]> =>
    solicitar(`/cxp/antiguedad${query(params)}`),
};
