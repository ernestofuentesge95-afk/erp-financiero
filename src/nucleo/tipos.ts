export type EstadoDocumento = "borrador" | "contabilizado" | "anulado";
export type EstadoPartida = "abierta" | "compensada";

export interface LineaInput {
  cuentaId: string;
  debe: string;
  haber: string;
  terceroId?: string;
  centroCostoId?: string;
  descripcion?: string;
  /** Vencimiento de la partida (solo cuentas con gestion_partidas_abiertas). */
  fechaVencimiento?: string;
  /** Marca esta línea como el ORIGEN de una partida abierta nueva (p.ej. el
   * haber de CxP de una factura). Solo puede ser 'abierta' al crearse. */
  estadoPartidaInicial?: "abierta";
  /** Marca esta línea como una COMPENSACIÓN que aplica contra la partida
   * abierta `lineaId`. No se puede combinar con estadoPartidaInicial. */
  compensadaPorId?: string;
}

export interface CrearBorradorInput {
  sociedadId: string;
  tipoDocumentoId: string;
  fechaDocumento: string;
  fechaContabilizacion: string;
  moneda: string;
  tipoCambio?: string;
  referencia?: string;
  descripcion?: string;
  moduloOrigen?: string;
  documentoOrigenId?: string;
  creadoPor: string;
  lineas: LineaInput[];
}

export interface LineaDocumento {
  id: string;
  documentoId: string;
  numeroLinea: number;
  cuentaId: string;
  debe: string;
  haber: string;
  debeMl: string;
  haberMl: string;
  terceroId: string | null;
  centroCostoId: string | null;
  descripcion: string | null;
  fechaVencimiento: string | null;
  compensadaPorId: string | null;
  estadoPartida: EstadoPartida | null;
}

export interface Documento {
  id: string;
  sociedadId: string;
  tipoDocumentoId: string;
  numero: string | null;
  ejercicioId: string | null;
  fechaDocumento: string;
  fechaContabilizacion: string;
  periodoId: string | null;
  moneda: string;
  tipoCambio: string;
  referencia: string | null;
  descripcion: string | null;
  estado: EstadoDocumento;
  documentoOrigenId: string | null;
  moduloOrigen: string;
  createdBy: string;
  createdAt: string;
  contabilizadoPor: string | null;
  contabilizadoAt: string | null;
  lineas: LineaDocumento[];
}
