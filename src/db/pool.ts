import { Pool, types } from "pg";
import { env } from "../config/env.js";

// date / timestamp / timestamptz: devolver el string crudo de Postgres en
// vez de un JS Date. Evita corrimientos de huso horario y mantiene una
// única representación (string) para fechas en toda la capa de dominio.
// NUMERIC y BIGINT ya vienen como string por defecto en node-postgres
// (regla 9 de CLAUDE.md: nunca float para dinero).
const identidad = (valor: string): string => valor;
types.setTypeParser(1082, identidad); // date
types.setTypeParser(1114, identidad); // timestamp
types.setTypeParser(1184, identidad); // timestamptz

export function createPool(): Pool {
  return new Pool({
    connectionString: env.DATABASE_URL,
  });
}
