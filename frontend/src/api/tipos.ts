/**
 * Formas de datos de la API. Dos convenciones conviven en el backend:
 * - snake_case: rutas CRUD crudas sobre catálogos (empresa, sociedad,
 *   tercero, centro_costo, cuenta, indicador_impuesto, regla_determinacion).
 * - camelCase: todo lo que devuelve ContabilizacionService (Documento,
 *   LineaDocumento) y los reportes de src/modulos/cxp/reportes.ts.
 */

export interface Empresa {
  id: string;
  codigo: string;
  nombre: string;
  activa: boolean;
}

export interface Sociedad {
  id: string;
  empresa_id: string;
  codigo: string;
  nombre: string;
  nit: string | null;
  pais: string;
  moneda_funcional: string;
  plan_cuentas_id: string;
}

export interface Tercero {
  id: string;
  empresa_id: string;
  codigo: string;
  nombre: string;
  nit: string | null;
  es_cliente: boolean;
  es_proveedor: boolean;
  condicion_pago_dias: number;
  activo: boolean;
}

export interface CentroCosto {
  id: string;
  sociedad_id: string;
  codigo: string;
  nombre: string;
  activo: boolean;
}

export interface IndicadorImpuesto {
  id: string;
  sociedad_id: string;
  codigo: string;
  tasa: string;
  cuenta_iva_credito_id: string | null;
  cuenta_iva_debito_id: string | null;
}

export interface ReglaDeterminacionCuenta {
  id: string;
  sociedad_id: string;
  modulo: string;
  operacion: string;
  condicion: string | null;
  cuenta_id: string;
}

export interface Cuenta {
  id: string;
  plan_cuentas_id: string;
  codigo: string;
  nombre: string;
  tipo: "activo" | "pasivo" | "patrimonio" | "ingreso" | "gasto";
  naturaleza: "deudora" | "acreedora";
  cuenta_padre_id: string | null;
  permite_movimientos: boolean;
  requiere_tercero: boolean;
  requiere_centro_costo: boolean;
  gestion_partidas_abiertas: boolean;
  activa: boolean;
}

export type EstadoDocumento = "borrador" | "contabilizado" | "anulado";
export type EstadoPartida = "abierta" | "compensada";

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
  fechaDocumento: string;
  fechaContabilizacion: string;
  moneda: string;
  referencia: string | null;
  descripcion: string | null;
  estado: EstadoDocumento;
  documentoOrigenId: string | null;
  moduloOrigen: string;
  lineas: LineaDocumento[];
}

export interface LineaFacturaInput {
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
  indicadorImpuestoCodigo?: string;
  lineas: LineaFacturaInput[];
  creadoPor: string;
}

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

export interface PartidaAbiertaReporte {
  lineaId: string;
  documentoId: string;
  documentoReferencia: string | null;
  terceroId: string;
  fechaDocumento: string;
  fechaVencimiento: string | null;
  montoOriginal: string;
  saldoAbierto: string;
  diasVencido: number;
}

export type NombreBucketAntiguedad = "0-30" | "31-60" | "61-90" | "+90";

export interface BucketAntiguedad {
  bucket: NombreBucketAntiguedad;
  monto: string;
}

export interface AntiguedadProveedor {
  terceroId: string;
  terceroNombre: string;
  buckets: BucketAntiguedad[];
  total: string;
}

export interface MovimientoAuxiliarProveedor {
  lineaId: string;
  documentoId: string;
  fecha: string;
  tipoDocumento: string;
  numero: string | null;
  referencia: string | null;
  cargo: string;
  abono: string;
  saldoAcumulado: string;
  estadoPartida: EstadoPartida | null;
}

export interface AuxiliarProveedorResultado {
  movimientos: MovimientoAuxiliarProveedor[];
  saldoFinal: string;
}
