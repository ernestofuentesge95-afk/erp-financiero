import type { Pool, PoolClient } from "pg";
import { Decimal } from "decimal.js";
import type { EstadoPartida } from "./tipos.js";

export interface PartidaAbierta {
  lineaId: string;
  documentoId: string;
  cuentaId: string;
  terceroId: string | null;
  fechaVencimiento: string | null;
  estadoPartida: EstadoPartida;
  montoOriginal: Decimal;
  montoCompensado: Decimal;
  saldoAbierto: Decimal;
}

interface PartidaRow {
  linea_id: string;
  documento_id: string;
  cuenta_id: string;
  tercero_id: string | null;
  fecha_vencimiento: string | null;
  estado_partida: EstadoPartida;
  monto_original: string;
  monto_compensado: string;
}

/**
 * Lee una partida abierta (línea origen: factura, NC, etc.) y su saldo
 * derivado — invariante 8, nunca se guarda un saldo. El saldo = su propio
 * monto (debe_ml o haber_ml, el que sea > 0) menos la suma de los montos de
 * todas las líneas que la compensan (linea_documento.compensada_por_id
 * apuntando a esta), sobre documentos ya contabilizados.
 */
export async function obtenerPartida(
  client: Pool | PoolClient,
  lineaId: string,
): Promise<PartidaAbierta | null> {
  const result = await client.query<PartidaRow>(
    `SELECT ld.id AS linea_id, ld.documento_id, ld.cuenta_id, ld.tercero_id,
            ld.fecha_vencimiento, ld.estado_partida,
            GREATEST(ld.debe_ml, ld.haber_ml) AS monto_original,
            COALESCE((
              SELECT SUM(GREATEST(c.debe_ml, c.haber_ml))
              FROM linea_documento c
              JOIN documento cd ON cd.id = c.documento_id
              WHERE c.compensada_por_id = ld.id AND cd.estado = 'contabilizado'
            ), 0) AS monto_compensado
     FROM linea_documento ld
     JOIN documento d ON d.id = ld.documento_id
     WHERE ld.id = $1 AND d.estado = 'contabilizado' AND ld.estado_partida IS NOT NULL`,
    [lineaId],
  );

  if (result.rowCount === 0) {
    return null;
  }
  const row = result.rows[0]!;
  const montoOriginal = new Decimal(row.monto_original);
  const montoCompensado = new Decimal(row.monto_compensado);
  return {
    lineaId: row.linea_id,
    documentoId: row.documento_id,
    cuentaId: row.cuenta_id,
    terceroId: row.tercero_id,
    fechaVencimiento: row.fecha_vencimiento,
    estadoPartida: row.estado_partida,
    montoOriginal,
    montoCompensado,
    saldoAbierto: montoOriginal.minus(montoCompensado),
  };
}
