import type { Pool } from "pg";
import { aMonto, formatearMonto } from "../../nucleo/dinero.js";

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
