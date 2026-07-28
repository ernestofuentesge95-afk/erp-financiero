import type { Pool } from "pg";
import { DomainError } from "../../errors.js";

/** tipo_documento es un catálogo compartido poblado por el seed; si falta, es un problema de configuración, no de negocio. */
export async function resolverTipoDocumento(pool: Pool, codigo: string): Promise<string> {
  const result = await pool.query<{ id: string }>(`SELECT id FROM tipo_documento WHERE codigo = $1`, [
    codigo,
  ]);
  if (result.rowCount === 0) {
    throw new DomainError(
      "TIPO_DOCUMENTO_NO_CONFIGURADO",
      `No existe el tipo de documento '${codigo}'. Corre \`npm run seed\`.`,
      500,
    );
  }
  return result.rows[0]!.id;
}

export async function resolverMonedaSociedad(pool: Pool, sociedadId: string): Promise<string> {
  const result = await pool.query<{ moneda_funcional: string }>(
    `SELECT moneda_funcional FROM sociedad WHERE id = $1`,
    [sociedadId],
  );
  if (result.rowCount === 0) {
    throw new DomainError("SOCIEDAD_NO_ENCONTRADA", `No existe la sociedad ${sociedadId}.`, 404);
  }
  return result.rows[0]!.moneda_funcional;
}

export function sumarDias(fecha: string, dias: number): string {
  const fechaObj = new Date(`${fecha}T00:00:00Z`);
  fechaObj.setUTCDate(fechaObj.getUTCDate() + dias);
  return fechaObj.toISOString().slice(0, 10);
}
