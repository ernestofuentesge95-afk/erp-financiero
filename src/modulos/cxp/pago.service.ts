import type { Pool } from "pg";
import { aMonto, formatearMonto } from "../../nucleo/dinero.js";
import { resolverCuenta } from "../../nucleo/determinacion.js";
import { obtenerPartida, type PartidaAbierta } from "../../nucleo/partidas.js";
import {
  LineaInvalidaError,
  MontoAplicacionExcedeSaldoError,
  PartidaNoEncontradaError,
  PartidaYaCompensadaError,
} from "../../nucleo/errores.js";
import type { ContabilizacionService } from "../../nucleo/contabilizacion.service.js";
import type { Documento, EstadoPartida, LineaInput } from "../../nucleo/tipos.js";
import { resolverMonedaSociedad, resolverTipoDocumento } from "./util.js";

export interface AplicacionPagoInput {
  lineaAbiertaId: string;
  monto: string;
}

export interface RegistrarPagoInput {
  sociedadId: string;
  terceroId: string;
  fecha: string;
  referencia?: string;
  aplicaciones: AplicacionPagoInput[];
  creadoPor: string;
}

export interface SaldoPartidaResultado {
  lineaId: string;
  saldoAbierto: string;
  estadoPartida: EstadoPartida;
}

export interface ResultadoPago {
  documento: Documento;
  partidas: SaldoPartidaResultado[];
}

/**
 * Pago total o parcial a proveedor: CxP (D) contra Banco (H) +
 * compensación de partidas abiertas (clearing). Puede pagar total o
 * parcialmente una o varias partidas en un mismo pago; cada partida validada
 * contra su saldo derivado antes de tocar el ledger.
 */
export class PagoService {
  constructor(
    private readonly pool: Pool,
    private readonly contabilizacion: ContabilizacionService,
  ) {}

  async registrarPago(input: RegistrarPagoInput): Promise<ResultadoPago> {
    if (input.aplicaciones.length === 0) {
      throw new LineaInvalidaError("El pago debe aplicar contra al menos una partida abierta.");
    }

    const moneda = await resolverMonedaSociedad(this.pool, input.sociedadId);
    const cuentaBancoId = await resolverCuenta(this.pool, input.sociedadId, "BK", "BK.BANCO_DEFAULT");
    const tipoDocumentoId = await resolverTipoDocumento(this.pool, "PG");

    const validadas: Array<{ aplicacion: AplicacionPagoInput; partida: PartidaAbierta }> = [];
    const lineas: LineaInput[] = [];
    let montoTotal = aMonto(0);

    for (const aplicacion of input.aplicaciones) {
      const partida = await obtenerPartida(this.pool, aplicacion.lineaAbiertaId);
      if (!partida) {
        throw new PartidaNoEncontradaError(aplicacion.lineaAbiertaId);
      }
      if (partida.terceroId !== input.terceroId) {
        throw new LineaInvalidaError(
          `La partida ${aplicacion.lineaAbiertaId} no pertenece al tercero ${input.terceroId}.`,
        );
      }
      if (partida.estadoPartida === "compensada" || partida.saldoAbierto.isZero()) {
        throw new PartidaYaCompensadaError(aplicacion.lineaAbiertaId);
      }
      const monto = aMonto(aplicacion.monto);
      if (monto.lessThanOrEqualTo(0)) {
        throw new LineaInvalidaError(
          `El monto aplicado a la partida ${aplicacion.lineaAbiertaId} debe ser mayor a cero.`,
        );
      }
      if (monto.greaterThan(partida.saldoAbierto)) {
        throw new MontoAplicacionExcedeSaldoError(
          aplicacion.lineaAbiertaId,
          formatearMonto(monto),
          formatearMonto(partida.saldoAbierto),
        );
      }

      validadas.push({ aplicacion, partida });
      lineas.push({
        cuentaId: partida.cuentaId,
        debe: formatearMonto(monto),
        haber: "0",
        terceroId: input.terceroId,
        compensadaPorId: aplicacion.lineaAbiertaId,
      });
      montoTotal = montoTotal.plus(monto);
    }

    lineas.push({ cuentaId: cuentaBancoId, debe: "0", haber: formatearMonto(montoTotal) });

    const borrador = await this.contabilizacion.crearBorrador({
      sociedadId: input.sociedadId,
      tipoDocumentoId,
      fechaDocumento: input.fecha,
      fechaContabilizacion: input.fecha,
      moneda,
      referencia: input.referencia,
      descripcion: "Pago a proveedor",
      moduloOrigen: "AP",
      documentoOrigenId: validadas.length === 1 ? validadas[0]!.partida.documentoId : undefined,
      creadoPor: input.creadoPor,
      lineas,
    });
    const documento = await this.contabilizacion.contabilizar(borrador.id, input.creadoPor);

    const partidas: SaldoPartidaResultado[] = [];
    for (const { aplicacion } of validadas) {
      const resultado = await this.contabilizacion.recalcularEstadoPartida(
        aplicacion.lineaAbiertaId,
        input.creadoPor,
      );
      partidas.push({ lineaId: aplicacion.lineaAbiertaId, ...resultado });
    }

    return { documento, partidas };
  }
}
