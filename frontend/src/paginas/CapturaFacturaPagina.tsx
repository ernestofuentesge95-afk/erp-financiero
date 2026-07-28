import { useMemo, useState } from "react";
import { api, ApiError } from "../api/cliente";
import { aMonto, formatearMonto, formatearVisual, sumar } from "../api/dinero";
import type { Documento, LineaFacturaInput } from "../api/tipos";
import { useContextoApp } from "../contexto/ContextoApp";
import { MensajeError, MensajeExito } from "../componentes/Mensaje";

interface LineaFormulario {
  operacion: string;
  monto: string;
  centroCostoId: string;
  descripcion: string;
}

function lineaVacia(operacionPorDefecto: string): LineaFormulario {
  return { operacion: operacionPorDefecto, monto: "", centroCostoId: "", descripcion: "" };
}

function hoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function CapturaFacturaPagina(): React.JSX.Element {
  const { sociedad, proveedores, centrosCosto, indicadoresImpuesto, operacionesGasto, cuentasPorId, usuario } =
    useContextoApp();

  const primeraOperacion = operacionesGasto[0]?.operacion ?? "";

  const [terceroId, setTerceroId] = useState("");
  const [fecha, setFecha] = useState(hoyIso());
  const [referencia, setReferencia] = useState("");
  const [indicadorCodigo, setIndicadorCodigo] = useState("");
  const [lineas, setLineas] = useState<LineaFormulario[]>([lineaVacia(primeraOperacion)]);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facturaCreada, setFacturaCreada] = useState<Documento | null>(null);

  const indicadorSeleccionado = indicadoresImpuesto.find((i) => i.codigo === indicadorCodigo) ?? null;

  const gastoTotal = useMemo(() => sumar(lineas.map((l) => l.monto || "0")), [lineas]);
  const ivaEstimado = useMemo(
    () => (indicadorSeleccionado ? gastoTotal.times(indicadorSeleccionado.tasa).toDecimalPlaces(2) : aMonto(0)),
    [gastoTotal, indicadorSeleccionado],
  );
  const totalEstimado = useMemo(() => gastoTotal.plus(ivaEstimado), [gastoTotal, ivaEstimado]);

  function actualizarLinea(indice: number, cambios: Partial<LineaFormulario>): void {
    setLineas((prev) => prev.map((l, i) => (i === indice ? { ...l, ...cambios } : l)));
  }

  function agregarLinea(): void {
    setLineas((prev) => [...prev, lineaVacia(primeraOperacion)]);
  }

  function quitarLinea(indice: number): void {
    setLineas((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== indice)));
  }

  function operacionRequiereCentroCosto(operacion: string): boolean {
    return operacionesGasto.find((o) => o.operacion === operacion)?.requiereCentroCosto ?? false;
  }

  function reiniciar(): void {
    setTerceroId("");
    setReferencia("");
    setIndicadorCodigo("");
    setLineas([lineaVacia(primeraOperacion)]);
    setFecha(hoyIso());
  }

  async function enviar(evento: React.FormEvent): Promise<void> {
    evento.preventDefault();
    if (!sociedad) return;
    setError(null);
    setFacturaCreada(null);

    const lineasInput: LineaFacturaInput[] = lineas.map((l) => ({
      operacion: l.operacion,
      monto: formatearMonto(l.monto || "0"),
      centroCostoId: l.centroCostoId || undefined,
      descripcion: l.descripcion || undefined,
    }));

    setEnviando(true);
    try {
      const documento = await api.registrarFactura({
        sociedadId: sociedad.id,
        terceroId,
        fecha,
        referencia,
        indicadorImpuestoCodigo: indicadorCodigo || undefined,
        lineas: lineasInput,
        creadoPor: usuario,
      });
      setFacturaCreada(documento);
      reiniciar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo registrar la factura.");
    } finally {
      setEnviando(false);
    }
  }

  if (!sociedad) {
    return <p className="texto-tenue">Selecciona una sociedad para continuar.</p>;
  }

  const puedeEnviar =
    terceroId !== "" &&
    referencia.trim() !== "" &&
    lineas.every(
      (l) =>
        l.operacion !== "" &&
        aMonto(l.monto || "0").greaterThan(0) &&
        (!operacionRequiereCentroCosto(l.operacion) || l.centroCostoId !== ""),
    );

  return (
    <div>
      <h1>Captura de factura de proveedor</h1>
      <p className="texto-tenue">
        Elige la categoría de gasto de cada línea — el sistema resuelve la cuenta contable, el IVA
        crédito y la cuenta de CxP por sí solo (regla_determinacion_cuenta / indicador_impuesto).
      </p>

      {error && <MensajeError texto={error} />}
      {facturaCreada && (
        <MensajeExito
          texto={`Factura #${facturaCreada.numero} contabilizada correctamente (${facturaCreada.lineas.length} líneas).`}
        />
      )}

      <form className="tarjeta" onSubmit={enviar}>
        <div className="fila-campos">
          <div className="campo">
            <label htmlFor="proveedor">Proveedor</label>
            <select id="proveedor" value={terceroId} onChange={(e) => setTerceroId(e.target.value)} required>
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
            <label htmlFor="fecha">Fecha de factura</label>
            <input id="fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} required />
          </div>
          <div className="campo">
            <label htmlFor="referencia">Nº de factura del proveedor</label>
            <input
              id="referencia"
              value={referencia}
              onChange={(e) => setReferencia(e.target.value)}
              placeholder="Ej. F-00123"
              required
            />
          </div>
          <div className="campo">
            <label htmlFor="impuesto">Impuesto</label>
            <select id="impuesto" value={indicadorCodigo} onChange={(e) => setIndicadorCodigo(e.target.value)}>
              <option value="">Sin impuesto</option>
              {indicadoresImpuesto
                .filter((i) => i.cuenta_iva_credito_id)
                .map((i) => (
                  <option key={i.id} value={i.codigo}>
                    {i.codigo} ({(Number(i.tasa) * 100).toFixed(0)}%)
                  </option>
                ))}
            </select>
          </div>
        </div>

        <h2 style={{ marginTop: 16 }}>Líneas de gasto</h2>
        <table>
          <thead>
            <tr>
              <th>Categoría de gasto</th>
              <th>Centro de costo</th>
              <th>Descripción</th>
              <th className="num">Monto</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((linea, indice) => (
              <tr key={indice}>
                <td>
                  <select
                    value={linea.operacion}
                    onChange={(e) => actualizarLinea(indice, { operacion: e.target.value })}
                    required
                  >
                    <option value="" disabled>
                      Selecciona una categoría
                    </option>
                    {operacionesGasto.map((op) => (
                      <option key={op.operacion} value={op.operacion}>
                        {op.cuentaNombre}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={linea.centroCostoId}
                    onChange={(e) => actualizarLinea(indice, { centroCostoId: e.target.value })}
                    required={operacionRequiereCentroCosto(linea.operacion)}
                  >
                    <option value="">
                      {operacionRequiereCentroCosto(linea.operacion) ? "Selecciona uno" : "— (opcional)"}
                    </option>
                    {centrosCosto.map((cc) => (
                      <option key={cc.id} value={cc.id}>
                        {cc.codigo} — {cc.nombre}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    value={linea.descripcion}
                    onChange={(e) => actualizarLinea(indice, { descripcion: e.target.value })}
                    placeholder="Opcional"
                  />
                </td>
                <td className="num">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={linea.monto}
                    onChange={(e) => actualizarLinea(indice, { monto: e.target.value })}
                    required
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="peligro"
                    onClick={() => quitarLinea(indice)}
                    disabled={lineas.length === 1}
                  >
                    Quitar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 8 }}>
          <button type="button" className="secundario" onClick={agregarLinea}>
            + Agregar línea
          </button>
        </div>

        <div className="tarjeta" style={{ marginTop: 16, background: "var(--fondo)" }}>
          <table>
            <tbody>
              <tr>
                <td>Total gasto</td>
                <td className="num">{formatearVisual(gastoTotal)}</td>
              </tr>
              <tr>
                <td>IVA estimado{indicadorSeleccionado ? ` (${indicadorSeleccionado.codigo})` : ""}</td>
                <td className="num">{formatearVisual(ivaEstimado)}</td>
              </tr>
              <tr>
                <td>
                  <strong>Total CxP (partida abierta)</strong>
                </td>
                <td className="num">
                  <strong>{formatearVisual(totalEstimado)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: 16 }}>
          <button type="submit" className="primario" disabled={!puedeEnviar || enviando}>
            {enviando ? "Contabilizando…" : "Registrar y contabilizar factura"}
          </button>
        </div>
      </form>

      {facturaCreada && (
        <div className="tarjeta">
          <h2>Asiento generado — Factura #{facturaCreada.numero}</h2>
          <table>
            <thead>
              <tr>
                <th>Cuenta</th>
                <th className="num">Debe</th>
                <th className="num">Haber</th>
                <th>Partida</th>
              </tr>
            </thead>
            <tbody>
              {facturaCreada.lineas.map((linea) => (
                <tr key={linea.id}>
                  <td>{cuentasPorId.get(linea.cuentaId)?.nombre ?? linea.cuentaId}</td>
                  <td className="num">{linea.debe !== "0.00" ? formatearVisual(linea.debe) : ""}</td>
                  <td className="num">{linea.haber !== "0.00" ? formatearVisual(linea.haber) : ""}</td>
                  <td>
                    {linea.estadoPartida === "abierta" && (
                      <span className="etiqueta etiqueta-abierta">
                        Abierta · vence {linea.fechaVencimiento}
                      </span>
                    )}
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
