import { DomainError } from "../errors.js";

export class DocumentoNoEncontradoError extends DomainError {
  constructor(id: string) {
    super("DOCUMENTO_NO_ENCONTRADO", `No existe el documento ${id}.`, 404);
  }
}

export class EstadoInvalidoError extends DomainError {
  constructor(esperado: string, actual: string) {
    super(
      "ESTADO_INVALIDO",
      `Se esperaba un documento en estado '${esperado}' pero está en estado '${actual}'.`,
      409,
    );
  }
}

export class LineaInvalidaError extends DomainError {
  constructor(mensaje: string) {
    super("LINEA_INVALIDA", mensaje, 422);
  }
}

export class DocumentoDescuadradoError extends DomainError {
  constructor(sumaDebe: string, sumaHaber: string) {
    super(
      "DOCUMENTO_DESCUADRADO",
      `El documento no cuadra: suma debe (${sumaDebe}) distinta de suma haber (${sumaHaber}).`,
      422,
    );
  }
}

export class PeriodoNoEncontradoError extends DomainError {
  constructor(fecha: string) {
    super(
      "PERIODO_NO_ENCONTRADO",
      `No existe un período contable que cubra la fecha ${fecha} para esta sociedad.`,
      422,
    );
  }
}

export class PeriodoCerradoError extends DomainError {
  constructor(periodoId: string) {
    super(
      "PERIODO_CERRADO",
      `El período ${periodoId} está cerrado; no se puede contabilizar ni anular en él.`,
      422,
    );
  }
}

export class TerceroNoEncontradoError extends DomainError {
  constructor(id: string) {
    super("TERCERO_NO_ENCONTRADO", `No existe el tercero ${id}.`, 404);
  }
}

export class TerceroInactivoError extends DomainError {
  constructor(id: string) {
    super("TERCERO_INACTIVO", `El tercero ${id} está inactivo.`, 422);
  }
}

export class ReglaDeterminacionNoEncontradaError extends DomainError {
  constructor(modulo: string, operacion: string) {
    super(
      "REGLA_DETERMINACION_NO_ENCONTRADA",
      `No hay una regla_determinacion_cuenta configurada para módulo '${modulo}', operación '${operacion}'.`,
      422,
    );
  }
}

export class IndicadorImpuestoNoEncontradoError extends DomainError {
  constructor(codigo: string) {
    super(
      "INDICADOR_IMPUESTO_NO_ENCONTRADO",
      `No existe el indicador_impuesto '${codigo}' para esta sociedad.`,
      422,
    );
  }
}

export class PartidaNoEncontradaError extends DomainError {
  constructor(lineaId: string) {
    super(
      "PARTIDA_NO_ENCONTRADA",
      `No existe una partida abierta con línea ${lineaId} (o la cuenta no gestiona partidas abiertas).`,
      404,
    );
  }
}

export class PartidaYaCompensadaError extends DomainError {
  constructor(lineaId: string) {
    super("PARTIDA_YA_COMPENSADA", `La partida ${lineaId} ya está totalmente compensada.`, 409);
  }
}

export class MontoAplicacionExcedeSaldoError extends DomainError {
  constructor(lineaId: string, monto: string, saldoAbierto: string) {
    super(
      "MONTO_APLICACION_EXCEDE_SALDO",
      `El monto aplicado (${monto}) a la partida ${lineaId} excede su saldo abierto (${saldoAbierto}).`,
      422,
    );
  }
}

export class FacturaDuplicadaError extends DomainError {
  constructor(referencia: string) {
    super(
      "FACTURA_DUPLICADA",
      `Ya existe una factura con referencia '${referencia}' registrada para este proveedor.`,
      409,
    );
  }
}
