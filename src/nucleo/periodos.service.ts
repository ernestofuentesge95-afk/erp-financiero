import type { Pool } from "pg";
import { DomainError } from "../errors.js";

export class PeriodoNoEncontradoIdError extends DomainError {
  constructor(id: string) {
    super("PERIODO_NO_ENCONTRADO", `No existe el período ${id}.`, 404);
  }
}

interface PeriodoRow {
  id: string;
  ejercicio_id: string;
  numero: number;
  fecha_inicio: string;
  fecha_fin: string;
  estado: "abierto" | "cerrado";
}

async function cambiarEstadoPeriodo(
  pool: Pool,
  periodoId: string,
  nuevoEstado: "abierto" | "cerrado",
  usuario: string,
  accion: "ABRIR_PERIODO" | "CERRAR_PERIODO",
): Promise<PeriodoRow> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<PeriodoRow>(
      `UPDATE periodo_contable SET estado = $2 WHERE id = $1 RETURNING *`,
      [periodoId, nuevoEstado],
    );
    if (result.rowCount === 0) {
      throw new PeriodoNoEncontradoIdError(periodoId);
    }
    const periodo = result.rows[0]!;
    await client.query(
      `INSERT INTO audit_log (usuario, accion, entidad, entidad_id, snapshot) VALUES ($1, $2, 'periodo_contable', $3, $4)`,
      [usuario, accion, periodoId, JSON.stringify(periodo)],
    );
    await client.query("COMMIT");
    return periodo;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Cerrar/abrir período: acción explícita y auditada (CLAUDE.md regla 4 y 10). */
export async function cerrarPeriodo(pool: Pool, periodoId: string, usuario: string): Promise<PeriodoRow> {
  return cambiarEstadoPeriodo(pool, periodoId, "cerrado", usuario, "CERRAR_PERIODO");
}

export async function abrirPeriodo(pool: Pool, periodoId: string, usuario: string): Promise<PeriodoRow> {
  return cambiarEstadoPeriodo(pool, periodoId, "abierto", usuario, "ABRIR_PERIODO");
}
