import type { Pool } from "pg";
import { aMonto, formatearMonto } from "../../nucleo/dinero.js";
import { resolverCuenta, resolverIndicadorImpuesto } from "../../nucleo/determinacion.js";
import {
  FacturaDuplicadaError,
  LineaInvalidaError,
  TerceroInactivoError,
  TerceroNoEncontradoError,
} from "../../nucleo/errores.js";
import { DomainError } from "../../errors.js";
import type { ContabilizacionService } from "../../nucleo/contabilizacion.service.js";
import type { Documento, LineaInput } from "../../nucleo/tipos.js";
import { resolverMonedaSociedad, resolverTipoDocumento, sumarDias } from "./util.js";

export interface LineaFacturaInput {
  /** Operación de negocio (ej. "AP.GASTO_OPERACION") que resuelve la cuenta
   * de gasto vía regla_determinacion_cuenta — nunca un cuenta_id directo. */
  operacion: string;
  monto: string;
  centroCostoId?: string;
  descripcion?: string;
}

export interface RegistrarFacturaInput {
  sociedadId: string;
  terceroId: string;
  fecha: string;
  referencia: string;
  /** Código de indicador_impuesto (ej. "IVA13"); se omite si la compra es exenta. */
  indicadorImpuestoCodigo?: string;
  lineas: LineaFacturaInput[];
  creadoPor: string;
}

interface TerceroRow {
  es_proveedor: boolean;
  activo: boolean;
  condicion_pago_dias: number;
}

/**
 * Captura de factura de proveedor: Gasto (D) + IVA crédito (D) contra
 * CxP (H), con partida abierta y vencimiento. Quien la captura nunca elige
 * cuentas contables — todo sale de regla_determinacion_cuenta e
 * indicador_impuesto (CLAUDE.md regla 6).
 */
export class FacturaProveedorService {
  constructor(
    private readonly pool: Pool,
    private readonly contabilizacion: ContabilizacionService,
  ) {}

  async registrarFactura(input: RegistrarFacturaInput): Promise<Documento> {
    if (input.lineas.length === 0) {
      throw new LineaInvalidaError("La factura debe tener al menos una línea de gasto.");
    }

    const terceroResult = await this.pool.query<TerceroRow>(
      `SELECT es_proveedor, activo, condicion_pago_dias FROM tercero WHERE id = $1`,
      [input.terceroId],
    );
    if (terceroResult.rowCount === 0) {
      throw new TerceroNoEncontradoError(input.terceroId);
    }
    const tercero = terceroResult.rows[0]!;
    if (!tercero.es_proveedor) {
      throw new LineaInvalidaError(`El tercero ${input.terceroId} no está marcado como proveedor.`);
    }
    if (!tercero.activo) {
      throw new TerceroInactivoError(input.terceroId);
    }

    const moneda = await resolverMonedaSociedad(this.pool, input.sociedadId);
    const tipoDocumentoId = await resolverTipoDocumento(this.pool, "FP");

    // Una factura del mismo proveedor no puede capturarse dos veces con la
    // misma referencia. Un original anulado (storno) libera la referencia:
    // ya no representa una obligación activa duplicada. Se busca por la
    // línea de CxP (la que lleva tercero_id) porque documento no tiene
    // tercero_id propio.
    const duplicadaResult = await this.pool.query(
      `SELECT 1
       FROM documento d
       JOIN linea_documento ld ON ld.documento_id = d.id
       WHERE d.sociedad_id = $1 AND d.tipo_documento_id = $2 AND d.referencia = $3
         AND d.estado IN ('borrador', 'contabilizado')
         AND ld.tercero_id = $4
       LIMIT 1`,
      [input.sociedadId, tipoDocumentoId, input.referencia, input.terceroId],
    );
    if ((duplicadaResult.rowCount ?? 0) > 0) {
      throw new FacturaDuplicadaError(input.referencia);
    }

    const cuentaCxpId = await resolverCuenta(this.pool, input.sociedadId, "AP", "AP.CXP_DEFAULT");

    const lineas: LineaInput[] = [];
    let gastoTotal = aMonto(0);
    for (const linea of input.lineas) {
      const cuentaId = await resolverCuenta(this.pool, input.sociedadId, "AP", linea.operacion);
      const monto = aMonto(linea.monto);
      if (monto.lessThanOrEqualTo(0)) {
        throw new LineaInvalidaError(`El monto de la línea "${linea.operacion}" debe ser mayor a cero.`);
      }
      lineas.push({
        cuentaId,
        debe: formatearMonto(monto),
        haber: "0",
        centroCostoId: linea.centroCostoId,
        descripcion: linea.descripcion,
      });
      gastoTotal = gastoTotal.plus(monto);
    }

    let ivaMonto = aMonto(0);
    if (input.indicadorImpuestoCodigo) {
      const indicador = await resolverIndicadorImpuesto(
        this.pool,
        input.sociedadId,
        input.indicadorImpuestoCodigo,
      );
      if (!indicador.cuentaIvaCreditoId) {
        throw new DomainError(
          "INDICADOR_IMPUESTO_SIN_CUENTA",
          `El indicador '${indicador.codigo}' no tiene cuenta_iva_credito_id configurada.`,
          422,
        );
      }
      ivaMonto = gastoTotal.times(indicador.tasa).toDecimalPlaces(2);
      if (ivaMonto.greaterThan(0)) {
        lineas.push({ cuentaId: indicador.cuentaIvaCreditoId, debe: formatearMonto(ivaMonto), haber: "0" });
      }
    }

    const cxpMonto = gastoTotal.plus(ivaMonto);
    lineas.push({
      cuentaId: cuentaCxpId,
      debe: "0",
      haber: formatearMonto(cxpMonto),
      terceroId: input.terceroId,
      fechaVencimiento: sumarDias(input.fecha, tercero.condicion_pago_dias),
      estadoPartidaInicial: "abierta",
    });

    const borrador = await this.contabilizacion.crearBorrador({
      sociedadId: input.sociedadId,
      tipoDocumentoId,
      fechaDocumento: input.fecha,
      fechaContabilizacion: input.fecha,
      moneda,
      referencia: input.referencia,
      descripcion: `Factura de proveedor ${input.referencia}`,
      moduloOrigen: "AP",
      creadoPor: input.creadoPor,
      lineas,
    });

    return this.contabilizacion.contabilizar(borrador.id, input.creadoPor);
  }
}
