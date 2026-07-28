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
