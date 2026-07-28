import type { Pool } from "pg";
import { aMonto, formatearMonto } from "../../nucleo/dinero.js";
import type { EstadoPartida } from "../../nucleo/tipos.js";

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

export interface PartidasAbiertasInput {
  sociedadId: string;
  terceroId?: string;
  /** Fecha de referencia para calcular diasVencido; por defecto, hoy. */
  fechaCorte?: string;
}

interface FilaPartida {
  linea_id: string;
  documento_id: string;
  referencia: string | null;
  tercero_id: string;
  fecha_documento: string;
  fecha_vencimiento: string | null;
  monto_original: string;
  monto_compensado: string;
}

function diasEntre(fechaVencimiento: string, fechaCorte: string): number {
  const venc = new Date(`${fechaVencimiento}T00:00:00Z`).getTime();
  const corte = new Date(`${fechaCorte}T00:00:00Z`).getTime();
  return Math.round((corte - venc) / 86_400_000);
}

function hoyIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Partidas abiertas de CxP (cuentas pasivo con gestion_partidas_abiertas):
 * saldo 100% derivado de linea_documento (invariante 8), nunca de una tabla
 * de saldos. Solo cuentas tipo 'pasivo' — así no mezcla con partidas de CxC
 * (Fase 3), que comparten la misma mecánica de compensación sobre cuentas
 * tipo 'activo'.
 */
export async function partidasAbiertasPorProveedor(
  pool: Pool,
  input: PartidasAbiertasInput,
): Promise<PartidaAbiertaReporte[]> {
  const fechaCorte = input.fechaCorte ?? hoyIso();
  const params: string[] = [input.sociedadId];
  let sql = `
    SELECT ld.id AS linea_id, ld.documento_id, d.referencia, ld.tercero_id,
           d.fecha_documento, ld.fecha_vencimiento,
           GREATEST(ld.debe_ml, ld.haber_ml) AS monto_original,
           COALESCE((
             SELECT SUM(GREATEST(c.debe_ml, c.haber_ml))
             FROM linea_documento c
             JOIN documento cd ON cd.id = c.documento_id
             WHERE c.compensada_por_id = ld.id AND cd.estado = 'contabilizado'
           ), 0) AS monto_compensado
    FROM linea_documento ld
    JOIN documento d ON d.id = ld.documento_id
    JOIN cuenta cu ON cu.id = ld.cuenta_id
    WHERE d.estado = 'contabilizado'
      AND d.sociedad_id = $1
      AND ld.estado_partida = 'abierta'
      AND cu.gestion_partidas_abiertas = true
      AND cu.tipo = 'pasivo'
  `;
  if (input.terceroId) {
    params.push(input.terceroId);
    sql += ` AND ld.tercero_id = $${params.length}`;
  }
  sql += " ORDER BY ld.fecha_vencimiento NULLS LAST, ld.id";

  const result = await pool.query<FilaPartida>(sql, params);

  return result.rows
    .map((row) => {
      const montoOriginal = aMonto(row.monto_original);
      const saldoAbierto = montoOriginal.minus(row.monto_compensado);
      return {
        lineaId: row.linea_id,
        documentoId: row.documento_id,
        documentoReferencia: row.referencia,
        terceroId: row.tercero_id,
        fechaDocumento: row.fecha_documento,
        fechaVencimiento: row.fecha_vencimiento,
        montoOriginal: formatearMonto(montoOriginal),
        saldoAbierto: formatearMonto(saldoAbierto),
        diasVencido: row.fecha_vencimiento ? diasEntre(row.fecha_vencimiento, fechaCorte) : 0,
      };
    })
    .filter((partida) => Number(partida.saldoAbierto) !== 0);
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

export interface AntiguedadCxPInput {
  sociedadId: string;
  fechaCorte?: string;
}

function bucketDe(diasVencido: number): NombreBucketAntiguedad {
  if (diasVencido <= 30) return "0-30";
  if (diasVencido <= 60) return "31-60";
  if (diasVencido <= 90) return "61-90";
  return "+90";
}

/** Antigüedad de saldos CxP por proveedor, en buckets 0-30/31-60/61-90/+90. */
export async function antiguedadCxP(pool: Pool, input: AntiguedadCxPInput): Promise<AntiguedadProveedor[]> {
  const partidas = await partidasAbiertasPorProveedor(pool, {
    sociedadId: input.sociedadId,
    fechaCorte: input.fechaCorte,
  });
  if (partidas.length === 0) {
    return [];
  }

  const terceroIds = [...new Set(partidas.map((p) => p.terceroId))];
  const nombresResult = await pool.query<{ id: string; nombre: string }>(
    `SELECT id, nombre FROM tercero WHERE id = ANY($1::bigint[])`,
    [terceroIds],
  );
  const nombresPorId = new Map(nombresResult.rows.map((row) => [row.id, row.nombre]));

  const porProveedor = new Map<string, AntiguedadProveedor>();
  for (const partida of partidas) {
    let fila = porProveedor.get(partida.terceroId);
    if (!fila) {
      fila = {
        terceroId: partida.terceroId,
        terceroNombre: nombresPorId.get(partida.terceroId) ?? partida.terceroId,
        buckets: [
          { bucket: "0-30", monto: "0.00" },
          { bucket: "31-60", monto: "0.00" },
          { bucket: "61-90", monto: "0.00" },
          { bucket: "+90", monto: "0.00" },
        ],
        total: "0.00",
      };
      porProveedor.set(partida.terceroId, fila);
    }
    const bucketFila = fila.buckets.find((b) => b.bucket === bucketDe(partida.diasVencido))!;
    bucketFila.monto = formatearMonto(aMonto(bucketFila.monto).plus(partida.saldoAbierto));
    fila.total = formatearMonto(aMonto(fila.total).plus(partida.saldoAbierto));
  }

  return [...porProveedor.values()];
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
  /** Solo presente en la línea origen de una partida (factura, NC); null en pagos. */
  estadoPartida: EstadoPartida | null;
}

export interface AuxiliarProveedorInput {
  sociedadId: string;
  terceroId: string;
  fechaDesde: string;
  fechaHasta: string;
}

export interface AuxiliarProveedorResultado {
  movimientos: MovimientoAuxiliarProveedor[];
  saldoFinal: string;
}

interface FilaAuxiliar {
  linea_id: string;
  documento_id: string;
  numero: string | null;
  tipo_documento_codigo: string;
  referencia: string | null;
  fecha_documento: string;
  debe_ml: string;
  haber_ml: string;
  estado_partida: EstadoPartida | null;
}

/**
 * Auxiliar de proveedor (estado de cuenta): todos los movimientos de CxP de
 * un proveedor en un rango de fechas — facturas, notas de crédito y pagos,
 * incluidas las partidas ya compensadas — con saldo corriente acumulado.
 * 100% derivado de linea_documento, igual que partidasAbiertasPorProveedor,
 * solo que aquí no se filtra por estado_partida ni se neta por partida: cada
 * línea es su propia fila con su propio cargo/abono. Incluye documentos
 * `anulado` además de `contabilizado` por la misma razón que
 * balanceDeComprobacion (núcleo/reportes.ts): un storno no borra el
 * original, lo compensa con líneas espejo, y ambos lados deben contar para
 * que el saldo acumulado sea correcto.
 *
 * Orden cronológico: por fecha_documento y luego por d.id (PK autoincremental
 * compartida por toda la tabla documento), nunca por d.numero — numero es
 * correlativo POR tipo_documento (invariante 7), así que una factura #2 y un
 * pago #1 del mismo día no dicen nada sobre cuál pasó primero.
 */
export async function auxiliarProveedor(
  pool: Pool,
  input: AuxiliarProveedorInput,
): Promise<AuxiliarProveedorResultado> {
  const result = await pool.query<FilaAuxiliar>(
    `SELECT ld.id AS linea_id, d.id AS documento_id, d.numero, td.codigo AS tipo_documento_codigo,
            d.referencia, d.fecha_documento, ld.debe_ml, ld.haber_ml, ld.estado_partida
     FROM linea_documento ld
     JOIN documento d ON d.id = ld.documento_id
     JOIN cuenta cu ON cu.id = ld.cuenta_id
     JOIN tipo_documento td ON td.id = d.tipo_documento_id
     WHERE d.sociedad_id = $1
       AND ld.tercero_id = $2
       AND d.estado IN ('contabilizado', 'anulado')
       AND cu.gestion_partidas_abiertas = true
       AND cu.tipo = 'pasivo'
       AND d.fecha_documento BETWEEN $3 AND $4
     ORDER BY d.fecha_documento, d.id, ld.numero_linea`,
    [input.sociedadId, input.terceroId, input.fechaDesde, input.fechaHasta],
  );

  let saldo = aMonto(0);
  const movimientos: MovimientoAuxiliarProveedor[] = result.rows.map((row) => {
    saldo = saldo.plus(row.haber_ml).minus(row.debe_ml);
    return {
      lineaId: row.linea_id,
      documentoId: row.documento_id,
      fecha: row.fecha_documento,
      tipoDocumento: row.tipo_documento_codigo,
      numero: row.numero,
      referencia: row.referencia,
      cargo: formatearMonto(row.debe_ml),
      abono: formatearMonto(row.haber_ml),
      saldoAcumulado: formatearMonto(saldo),
      estadoPartida: row.estado_partida,
    };
  });

  return { movimientos, saldoFinal: formatearMonto(saldo) };
}
