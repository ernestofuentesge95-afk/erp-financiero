import { useEffect, useState } from "react";
import { api } from "../api/cliente";
import { formatearVisual, sumar } from "../api/dinero";
import type { PartidaAbiertaReporte } from "../api/tipos";
import { useContextoApp } from "../contexto/ContextoApp";
import { MensajeError } from "../componentes/Mensaje";

export function PartidasAbiertasPagina(): React.JSX.Element {
  const { sociedad, proveedores } = useContextoApp();
  const [terceroId, setTerceroId] = useState("");
  const [partidas, setPartidas] = useState<PartidaAbiertaReporte[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sociedad) return;
    setCargando(true);
    setError(null);
    api
      .partidasAbiertas({ sociedadId: sociedad.id, terceroId: terceroId || undefined })
      .then(setPartidas)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setCargando(false));
  }, [sociedad, terceroId]);

  const nombreProveedor = (id: string): string =>
    proveedores.find((p) => p.id === id)?.nombre ?? id;

  if (!sociedad) {
    return <p className="texto-tenue">Selecciona una sociedad para continuar.</p>;
  }

  const total = sumar(partidas.map((p) => p.saldoAbierto));

  return (
    <div>
      <h1>Partidas abiertas de Cuentas por Pagar</h1>
      <p className="texto-tenue">Saldo derivado en vivo desde las líneas de documento — no hay una tabla de saldos.</p>

      {error && <MensajeError texto={error} />}

      <div className="tarjeta">
        <div className="campo" style={{ maxWidth: 320 }}>
          <label htmlFor="filtro-proveedor">Proveedor</label>
          <select id="filtro-proveedor" value={terceroId} onChange={(e) => setTerceroId(e.target.value)}>
            <option value="">Todos los proveedores</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.codigo} — {p.nombre}
              </option>
            ))}
          </select>
        </div>

        {cargando && <p className="texto-tenue">Cargando…</p>}

        {!cargando && partidas.length === 0 && (
          <p className="texto-tenue">No hay partidas abiertas para este filtro.</p>
        )}

        {!cargando && partidas.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Proveedor</th>
                <th>Referencia</th>
                <th>Fecha factura</th>
                <th>Vencimiento</th>
                <th className="num">Días vencido</th>
                <th className="num">Monto original</th>
                <th className="num">Saldo abierto</th>
              </tr>
            </thead>
            <tbody>
              {partidas.map((partida) => (
                <tr key={partida.lineaId}>
                  <td>{nombreProveedor(partida.terceroId)}</td>
                  <td>{partida.documentoReferencia}</td>
                  <td>{partida.fechaDocumento}</td>
                  <td>{partida.fechaVencimiento}</td>
                  <td className="num">
                    {partida.diasVencido > 0 ? (
                      <span className="etiqueta etiqueta-vencida">{partida.diasVencido}</span>
                    ) : (
                      partida.diasVencido
                    )}
                  </td>
                  <td className="num">{formatearVisual(partida.montoOriginal)}</td>
                  <td className="num">
                    <strong>{formatearVisual(partida.saldoAbierto)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6}>
                  <strong>Total</strong>
                </td>
                <td className="num">
                  <strong>{formatearVisual(total)}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
