import { useEffect, useState } from "react";
import { api } from "../api/cliente";
import { formatearVisual, sumar } from "../api/dinero";
import type { AntiguedadProveedor, NombreBucketAntiguedad } from "../api/tipos";
import { useContextoApp } from "../contexto/ContextoApp";
import { MensajeError } from "../componentes/Mensaje";

const BUCKETS: NombreBucketAntiguedad[] = ["0-30", "31-60", "61-90", "+90"];

function hoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function AntiguedadPagina(): React.JSX.Element {
  const { sociedad } = useContextoApp();
  const [fechaCorte, setFechaCorte] = useState(hoyIso());
  const [filas, setFilas] = useState<AntiguedadProveedor[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sociedad) return;
    setCargando(true);
    setError(null);
    api
      .antiguedad({ sociedadId: sociedad.id, fechaCorte })
      .then(setFilas)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setCargando(false));
  }, [sociedad, fechaCorte]);

  if (!sociedad) {
    return <p className="texto-tenue">Selecciona una sociedad para continuar.</p>;
  }

  const totalesPorBucket = BUCKETS.map((bucket) =>
    sumar(filas.map((f) => f.buckets.find((b) => b.bucket === bucket)?.monto ?? "0")),
  );
  const totalGeneral = sumar(filas.map((f) => f.total));

  return (
    <div>
      <h1>Antigüedad de saldos — Cuentas por Pagar</h1>
      <p className="texto-tenue">
        Buckets 0-30 / 31-60 / 61-90 / +90 días, calculados sobre el vencimiento de cada partida abierta.
      </p>

      {error && <MensajeError texto={error} />}

      <div className="tarjeta">
        <div className="campo" style={{ maxWidth: 220 }}>
          <label htmlFor="fecha-corte">Fecha de corte</label>
          <input
            id="fecha-corte"
            type="date"
            value={fechaCorte}
            onChange={(e) => setFechaCorte(e.target.value)}
          />
        </div>

        {cargando && <p className="texto-tenue">Cargando…</p>}
        {!cargando && filas.length === 0 && (
          <p className="texto-tenue">No hay saldos pendientes a esta fecha de corte.</p>
        )}

        {!cargando && filas.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Proveedor</th>
                {BUCKETS.map((bucket) => (
                  <th key={bucket} className="num">
                    {bucket}
                  </th>
                ))}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {filas.map((fila) => (
                <tr key={fila.terceroId}>
                  <td>{fila.terceroNombre}</td>
                  {BUCKETS.map((bucket) => (
                    <td key={bucket} className="num">
                      {formatearVisual(fila.buckets.find((b) => b.bucket === bucket)?.monto ?? "0")}
                    </td>
                  ))}
                  <td className="num">
                    <strong>{formatearVisual(fila.total)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>
                  <strong>Total</strong>
                </td>
                {totalesPorBucket.map((total, i) => (
                  <td key={BUCKETS[i]} className="num">
                    <strong>{formatearVisual(total)}</strong>
                  </td>
                ))}
                <td className="num">
                  <strong>{formatearVisual(totalGeneral)}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
