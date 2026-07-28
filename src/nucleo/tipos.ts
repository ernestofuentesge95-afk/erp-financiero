export type EstadoDocumento = "borrador" | "contabilizado" | "anulado";

export interface LineaInput {
  cuentaId: string;
  debe: string;
  haber: string;
  terceroId?: string;
  centroCostoId?: string;
  descripcion?: string;
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
