import type { Pool } from "pg";
import { aMonto, formatearMonto } from "./dinero.js";

export interface SaldoCuenta {
  cuentaId: string;
  codigo: string;
  nombre: string;
  debe: string;
  haber: string;
  saldo: string;
}

export interface BalanceDeComprobacionInput {
  sociedadId: string;
  fechaDesde: string;
  fechaHasta: string;
}

interface FilaSaldo {
  cuenta_id: string;
  codigo: string;
  nombre: string;
  debe: string;
  haber: string;
}

/**
 * Balance de comprobación: débitos, créditos y saldo por cuenta, calculado
 * 100% desde `linea_documento` (invariante 8: no existe ninguna tabla de
 * saldos que sea fuente de verdad). Incluye documentos `anulado` además de
 * `contabilizado`: un storno no borra el original, lo compensa con líneas
 * espejo — si excluyéramos `anulado` el balance quedaría descuadrado en el
 * efecto del storno (invariante 4).
 */
export async function balanceDeComprobacion(
  pool: Pool,
  input: BalanceDeComprobacionInput,
): Promise<SaldoCuenta[]> {
  const result = await pool.query<FilaSaldo>(
    `SELECT c.id AS cuenta_id, c.codigo, c.nombre,
            COALESCE(SUM(ld.debe_ml), 0) AS debe,
            COALESCE(SUM(ld.haber_ml), 0) AS haber
     FROM cuenta c
     LEFT JOIN linea_documento ld ON ld.cuenta_id = c.id
     LEFT JOIN documento d ON d.id = ld.documento_id
       AND d.estado IN ('contabilizado', 'anulado')
       AND d.sociedad_id = $1
       AND d.fecha_contabilizacion BETWEEN $2 AND $3
     WHERE c.plan_cuentas_id = (SELECT plan_cuentas_id FROM sociedad WHERE id = $1)
     GROUP BY c.id, c.codigo, c.nombre
     HAVING COALESCE(SUM(ld.debe_ml), 0) <> 0 OR COALESCE(SUM(ld.haber_ml), 0) <> 0
     ORDER BY c.codigo`,
    [input.sociedadId, input.fechaDesde, input.fechaHasta],
  );

  return result.rows.map((row) => ({
    cuentaId: row.cuenta_id,
    codigo: row.codigo,
    nombre: row.nombre,
    debe: formatearMonto(row.debe),
    haber: formatearMonto(row.haber),
    saldo: formatearMonto(aMonto(row.debe).minus(row.haber)),
  }));
}
