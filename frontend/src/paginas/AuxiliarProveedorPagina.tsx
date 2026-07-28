import { useEffect, useState } from "react";
import { api } from "../api/cliente";
import { formatearVisual, sumar } from "../api/dinero";
import type { AuxiliarProveedorResultado } from "../api/tipos";
import { useContextoApp } from "../contexto/ContextoApp";
import { MensajeError, MensajeExito } from "../componentes/Mensaje";

function hoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function inicioAnioIso(): string {
  return `${new Date().getFullYear()}-01-01`;
}

const ETIQUETA_ESTADO: Record<string, string> = {
  abierta: "Abierta",
  compensada: "Compensada",
};

export function AuxiliarProveedorPagina(): React.JSX.Element {
  const { sociedad, proveedores } = useContextoApp();

  const [terceroId, setTerceroId] = useState("");
  const [fechaDesde, setFechaDesde] = useState(inicioAnioIso());
  const [fechaHasta, setFechaHasta] = useState(hoyIso());
  const [resultado, setResultado] = useState<AuxiliarProveedorResultado | null>(null);
  const [saldoPartidasAbiertas, setSaldoPartidasAbiertas] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sociedad || !terceroId) {
      setResultado(null);
      setSaldoPartidasAbiertas(null);
      return;
    }
    setCargando(true);
    setError(null);
    Promise.all([
      api.auxiliarProveedor({ sociedadId: sociedad.id, terceroId, fechaDesde, fechaHasta }),
      api.partidasAbiertas({ sociedadId: sociedad.id, terceroId }),
    ])
      .then(([auxiliar, partidas]) => {
        setResultado(auxiliar);
        setSaldoPartidasAbiertas(formatearVisual(sumar(partidas.map((p) => p.saldoAbierto))));
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setCargando(false));
  }, [sociedad, terceroId, fechaDesde, fechaHasta]);

  if (!sociedad) {
    return <p className="texto-tenue">Selecciona una sociedad para continuar.</p>;
  }

  const cuadra =
    resultado !== null &&
    saldoPartidasAbiertas !== null &&
    Number(resultado.saldoFinal) === Number(saldoPartidasAbiertas.replace(/[^0-9.-]/g, ""));

  return (
    <div>
      <h1>Auxiliar de proveedor</h1>
      <p className="texto-tenue">
        Todos los movimientos del proveedor en el rango de fechas — facturas, notas de crédito y
        pagos, incluidas las partidas ya compensadas — con saldo corriente acumulado. Derivado
        100% de las líneas de documento.
      </p>

      {error && <MensajeError texto={error} />}

      <div className="tarjeta">
        <div className="fila-campos">
          <div className="campo">
            <label htmlFor="proveedor-auxiliar">Proveedor</label>
            <select
              id="proveedor-auxiliar"
              value={terceroId}
              onChange={(e) => setTerceroId(e.target.value)}
            >
              <option value="">Selecciona un proveedor</option>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.codigo} — {p.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="fecha-desde">Desde</label>
            <input
              id="fecha-desde"
              type="date"
              value={fechaDesde}
              onChange={(e) => setFechaDesde(e.target.value)}
            />
          </div>
          <div className="campo">
            <label htmlFor="fecha-hasta">Hasta</label>
            <input
              id="fecha-hasta"
              type="date"
              value={fechaHasta}
              onChange={(e) => setFechaHasta(e.target.value)}
            />
          </div>
        </div>

        {!terceroId && <p className="texto-tenue">Selecciona un proveedor para ver su auxiliar.</p>}
        {cargando && <p className="texto-tenue">Cargando…</p>}

        {!cargando && terceroId && resultado && resultado.movimientos.length === 0 && (
          <p className="texto-tenue">Este proveedor no tiene movimientos en el rango seleccionado.</p>
        )}

        {!cargando && resultado && resultado.movimientos.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th>Número</th>
                <th>Referencia</th>
                <th className="num">Cargo</th>
                <th className="num">Abono</th>
                <th className="num">Saldo</th>
                <th>Partida</th>
              </tr>
            </thead>
            <tbody>
              {resultado.movimientos.map((m) => (
                <tr key={m.lineaId}>
                  <td>{m.fecha}</td>
                  <td>{m.tipoDocumento}</td>
                  <td>{m.numero ?? "—"}</td>
                  <td>{m.referencia ?? "—"}</td>
                  <td className="num">{m.cargo !== "0.00" ? formatearVisual(m.cargo) : ""}</td>
                  <td className="num">{m.abono !== "0.00" ? formatearVisual(m.abono) : ""}</td>
                  <td className="num">{formatearVisual(m.saldoAcumulado)}</td>
                  <td>
                    {m.estadoPartida && (
                      <span
                        className={
                          "etiqueta " +
                          (m.estadoPartida === "compensada" ? "etiqueta-compensada" : "etiqueta-abierta")
                        }
                      >
                        {ETIQUETA_ESTADO[m.estadoPartida]}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6}>
                  <strong>Saldo final</strong>
                </td>
                <td className="num">
                  <strong>{formatearVisual(resultado.saldoFinal)}</strong>
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {!cargando && resultado && saldoPartidasAbiertas && (
        <div className="tarjeta">
          {cuadra ? (
            <MensajeExito
              texto={`Cuadra: el saldo final del auxiliar (${formatearVisual(
                resultado.saldoFinal,
              )}) coincide con la suma de partidas abiertas (${saldoPartidasAbiertas}).`}
            />
          ) : (
            <MensajeError
              texto={`No cuadra: saldo del auxiliar ${formatearVisual(
                resultado.saldoFinal,
              )} vs. suma de partidas abiertas ${saldoPartidasAbiertas}. Revisa el rango de fechas — el auxiliar solo derrama lo contabilizado dentro de él.`}
            />
          )}
        </div>
      )}
    </div>
  );
}
