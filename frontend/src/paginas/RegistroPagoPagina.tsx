import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/cliente";
import { aMonto, formatearMonto, formatearVisual, sumar } from "../api/dinero";
import type { PartidaAbiertaReporte, ResultadoPago } from "../api/tipos";
import { useContextoApp } from "../contexto/ContextoApp";
import { MensajeError, MensajeExito } from "../componentes/Mensaje";

function hoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function RegistroPagoPagina(): React.JSX.Element {
  const { sociedad, proveedores, usuario } = useContextoApp();

  const [terceroId, setTerceroId] = useState("");
  const [fecha, setFecha] = useState(hoyIso());
  const [referencia, setReferencia] = useState("");
  const [partidas, setPartidas] = useState<PartidaAbiertaReporte[]>([]);
  const [montos, setMontos] = useState<Record<string, string>>({});
  const [cargandoPartidas, setCargandoPartidas] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoPago | null>(null);

  const cargarPartidas = useCallback(
    (idTercero: string) => {
      if (!sociedad || !idTercero) {
        setPartidas([]);
        return;
      }
      setCargandoPartidas(true);
      api
        .partidasAbiertas({ sociedadId: sociedad.id, terceroId: idTercero })
        .then((lista) => {
          setPartidas(lista);
          setMontos({});
        })
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setCargandoPartidas(false));
    },
    [sociedad],
  );

  useEffect(() => {
    setResultado(null);
    cargarPartidas(terceroId);
  }, [terceroId, cargarPartidas]);

  const totalAplicado = useMemo(() => sumar(Object.values(montos).map((m) => m || "0")), [montos]);

  function actualizarMonto(lineaId: string, valor: string): void {
    setMontos((prev) => ({ ...prev, [lineaId]: valor }));
  }

  function aplicarSaldoCompleto(partida: PartidaAbiertaReporte): void {
    setMontos((prev) => ({ ...prev, [partida.lineaId]: partida.saldoAbierto }));
  }

  async function enviar(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    if (!sociedad) return;
    setError(null);

    const aplicaciones = partidas
      .filter((p) => aMonto(montos[p.lineaId] || "0").greaterThan(0))
      .map((p) => ({ lineaAbiertaId: p.lineaId, monto: formatearMonto(montos[p.lineaId] || "0") }));

    if (aplicaciones.length === 0) {
      setError("Indica al menos un monto a aplicar contra una partida abierta.");
      return;
    }

    setEnviando(true);
    try {
      const res = await api.registrarPago({
        sociedadId: sociedad.id,
        terceroId,
        fecha,
        referencia: referencia || undefined,
        aplicaciones,
        creadoPor: usuario,
      });
      setResultado(res);
      setReferencia("");
      cargarPartidas(terceroId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo registrar el pago.");
    } finally {
      setEnviando(false);
    }
  }

  if (!sociedad) {
    return <p className="texto-tenue">Selecciona una sociedad para continuar.</p>;
  }

  return (
    <div>
      <h1>Registro de pago a proveedor</h1>
      <p className="texto-tenue">
        Elige el proveedor, indica cuánto aplicar a cada partida abierta (total o parcial) y
        contabiliza. La partida solo se marca compensada cuando su saldo llega a cero.
      </p>

      {error && <MensajeError texto={error} />}
      {resultado && (
        <MensajeExito
          texto={`Pago #${resultado.documento.numero} contabilizado por ${formatearVisual(
            sumar(resultado.documento.lineas.filter((l) => l.haber !== "0.00").map((l) => l.haber)),
          )}.`}
        />
      )}

      <form className="tarjeta" onSubmit={enviar}>
        <div className="fila-campos">
          <div className="campo">
            <label htmlFor="proveedor-pago">Proveedor</label>
            <select
              id="proveedor-pago"
              value={terceroId}
              onChange={(e) => setTerceroId(e.target.value)}
              required
            >
              <option value="" disabled>
                Selecciona un proveedor
              </option>
              {proveedores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.codigo} — {p.nombre}
                </option>
              ))}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="fecha-pago">Fecha de pago</label>
            <input
              id="fecha-pago"
              type="date"
              value={fecha}
              onChange={(e) => setFecha(e.target.value)}
              required
            />
          </div>
          <div className="campo">
            <label htmlFor="referencia-pago">Referencia (nº de cheque / transferencia)</label>
            <input
              id="referencia-pago"
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              placeholder="Opcional"
            />
          </div>
        </div>

        {cargandoPartidas && <p className="texto-tenue">Cargando partidas abiertas…</p>}

        {!cargandoPartidas && terceroId && partidas.length === 0 && (
          <p className="texto-tenue">Este proveedor no tiene partidas abiertas.</p>
        )}

        {partidas.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>Referencia</th>
                <th>Vencimiento</th>
                <th className="num">Días vencido</th>
                <th className="num">Saldo abierto</th>
                <th className="num">Monto a aplicar</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {partidas.map((partida) => (
                <tr key={partida.lineaId}>
                  <td>{partida.documentoReferencia}</td>
                  <td>{partida.fechaVencimiento}</td>
                  <td className="num">
                    {partida.diasVencido > 0 ? (
                      <span className="etiqueta etiqueta-vencida">{partida.diasVencido}</span>
                    ) : (
                      partida.diasVencido
                    )}
                  </td>
                  <td className="num">{formatearVisual(partida.saldoAbierto)}</td>
                  <td className="num">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={montos[partida.lineaId] ?? ""}
                      onChange={(e) => actualizarMonto(partida.lineaId, e.target.value)}
                    />
                  </td>
                  <td>
                    <button type="button" className="secundario" onClick={() => aplicarSaldoCompleto(partida)}>
                      Saldo completo
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {partidas.length > 0 && (
          <div className="tarjeta" style={{ marginTop: 16, background: "var(--fondo)" }}>
            <strong>Total del pago: {formatearVisual(totalAplicado)}</strong>
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <button
            type="submit"
            className="primario"
            disabled={enviando || totalAplicado.lessThanOrEqualTo(0)}
          >
            {enviando ? "Contabilizando…" : "Registrar y contabilizar pago"}
          </button>
        </div>
      </form>

      {resultado && (
        <div className="tarjeta">
          <h2>Partidas actualizadas</h2>
          <table>
            <thead>
              <tr>
                <th>Línea</th>
                <th className="num">Saldo abierto</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {resultado.partidas.map((p) => (
                <tr key={p.lineaId}>
                  <td>{p.lineaId}</td>
                  <td className="num">{formatearVisual(p.saldoAbierto)}</td>
                  <td>
                    <span
                      className={"etiqueta " + (p.estadoPartida === "compensada" ? "etiqueta-compensada" : "etiqueta-abierta")}
                    >
                      {p.estadoPartida}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
