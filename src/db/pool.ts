import { Pool } from "pg";
import { env } from "../config/env.js";

export function createPool(): Pool {
  return new Pool({
    connectionString: env.DATABASE_URL,
  });
}
