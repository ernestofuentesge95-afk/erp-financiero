import type { Pool } from "pg";
import { aMonto, formatearMonto } from "../../nucleo/dinero.js";
import { resolverCuenta } from "../../nucleo/determinacion.js";
import { obtenerPartida } from "../../nucleo/partidas.js";
import {
  LineaInvalidaError,
  MontoAplicacionExcedeSaldoError,
  PartidaNoEncontradaError,
  PartidaYaCompensadaError,
} from "../../nucleo/errores.js";
import type { ContabilizacionService } from "../../nucleo/contabilizacion.service.js";
import type { Documento } from "../../nucleo/tipos.js";
import { resolverMonedaSociedad, resolverTipoDocumento } from "./util.js";

export interface RegistrarNotaCreditoInput {
  sociedadId: string;
  terceroId: string;
  fecha: string;
  referencia: string;
  /** Línea de la factura (u otra partida) que esta nota reduce. */
  lineaAbiertaId: string;
  monto: string;
  /** Operación que resuelve la cuenta de contrapartida (ej. devoluciones y
   * descuentos sobre compras) vía regla_determinacion_cuenta. */
  operacionContrapartida: string;
  creadoPor: string;
}

/**
 * Nota de crédito de proveedor: compensa (total o parcialmente) una partida
 * de CxP abierta existente. CxP (D) monto contra Contrapartida (H) monto.
 */
export class NotaCreditoProveedorService {
  constructor(
    private readonly pool: Pool,
    private readonly contabilizacion: ContabilizacionService,
  ) {}

  async registrarNotaCredito(input: RegistrarNotaCreditoInput): Promise<Documento> {
    const moneda = await resolverMonedaSociedad(this.pool, input.sociedadId);

    const partida = await obtenerPartida(this.pool, input.lineaAbiertaId);
    if (!partida) {
      throw new PartidaNoEncontradaError(input.lineaAbiertaId);
    }
    if (partida.terceroId !== input.terceroId) {
      throw new LineaInvalidaError(
        `La partida ${input.lineaAbiertaId} no pertenece al tercero ${input.terceroId}.`,
      );
    }
    if (partida.estadoPartida === "compensada" || partida.saldoAbierto.isZero()) {
      throw new PartidaYaCompensadaError(input.lineaAbiertaId);
    }
    const monto = aMonto(input.monto);
    if (monto.lessThanOrEqualTo(0)) {
      throw new LineaInvalidaError("El monto de la nota de crédito debe ser mayor a cero.");
    }
    if (monto.greaterThan(partida.saldoAbierto)) {
      throw new MontoAplicacionExcedeSaldoError(
        input.lineaAbiertaId,
        formatearMonto(monto),
        formatearMonto(partida.saldoAbierto),
      );
    }

    const cuentaContrapartidaId = await resolverCuenta(
      this.pool,
      input.sociedadId,
      "AP",
      input.operacionContrapartida,
    );
    const tipoDocumentoId = await resolverTipoDocumento(this.pool, "NC-P");

    const borrador = await this.contabilizacion.crearBorrador({
      sociedadId: input.sociedadId,
      tipoDocumentoId,
      fechaDocumento: input.fecha,
      fechaContabilizacion: input.fecha,
      moneda,
      referencia: input.referencia,
      descripcion: `Nota de crédito de proveedor ${input.referencia}`,
      moduloOrigen: "AP",
      documentoOrigenId: partida.documentoId,
      creadoPor: input.creadoPor,
      lineas: [
        {
          cuentaId: partida.cuentaId,
          debe: formatearMonto(monto),
          haber: "0",
          terceroId: input.terceroId,
          compensadaPorId: input.lineaAbiertaId,
        },
        { cuentaId: cuentaContrapartidaId, debe: "0", haber: formatearMonto(monto) },
      ],
    });
    const documento = await this.contabilizacion.contabilizar(borrador.id, input.creadoPor);
    await this.contabilizacion.recalcularEstadoPartida(input.lineaAbiertaId, input.creadoPor);
    return documento;
  }
}
