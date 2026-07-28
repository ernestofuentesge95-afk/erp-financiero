import type { Pool, PoolClient } from "pg";
import { IndicadorImpuestoNoEncontradoError, ReglaDeterminacionNoEncontradaError } from "./errores.js";

export interface IndicadorImpuesto {
  id: string;
  codigo: string;
  tasa: string;
  cuentaIvaCreditoId: string | null;
  cuentaIvaDebitoId: string | null;
}

interface ReglaRow {
  cuenta_id: string;
}

interface IndicadorRow {
  id: string;
  codigo: string;
  tasa: string;
  cuenta_iva_credito_id: string | null;
  cuenta_iva_debito_id: string | null;
}

/**
 * Traduce una operación de negocio a una cuenta contable vía
 * regla_determinacion_cuenta (CLAUDE.md regla 6: los módulos operativos no
 * conocen números de cuenta). `condicion` es un discriminador opcional
 * (p.ej. categoría de proveedor); por ahora los módulos solo usan la regla
 * "default" (condicion NULL).
 */
export async function resolverCuenta(
  client: Pool | PoolClient,
  sociedadId: string,
  modulo: string,
  operacion: string,
  condicion: string | null = null,
): Promise<string> {
  const result = await client.query<ReglaRow>(
    `SELECT cuenta_id FROM regla_determinacion_cuenta
     WHERE sociedad_id = $1 AND modulo = $2 AND operacion = $3
       AND condicion IS NOT DISTINCT FROM $4
     LIMIT 1`,
    [sociedadId, modulo, operacion, condicion],
  );
  if (result.rowCount === 0) {
    throw new ReglaDeterminacionNoEncontradaError(modulo, operacion);
  }
  return result.rows[0]!.cuenta_id;
}

export async function resolverIndicadorImpuesto(
  client: Pool | PoolClient,
  sociedadId: string,
  codigo: string,
): Promise<IndicadorImpuesto> {
  const result = await client.query<IndicadorRow>(
    `SELECT id, codigo, tasa, cuenta_iva_credito_id, cuenta_iva_debito_id
     FROM indicador_impuesto WHERE sociedad_id = $1 AND codigo = $2`,
    [sociedadId, codigo],
  );
  if (result.rowCount === 0) {
    throw new IndicadorImpuestoNoEncontradoError(codigo);
  }
  const row = result.rows[0]!;
  return {
    id: row.id,
    codigo: row.codigo,
    tasa: row.tasa,
    cuentaIvaCreditoId: row.cuenta_iva_credito_id,
    cuentaIvaDebitoId: row.cuenta_iva_debito_id,
  };
}
