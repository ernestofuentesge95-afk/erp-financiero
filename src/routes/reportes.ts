import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { DomainError } from "../errors.js";
import { balanceDeComprobacion } from "../nucleo/reportes.js";

const balanceQuerySchema = z.object({
  sociedadId: z.string().min(1),
  fechaDesde: z.string(),
  fechaHasta: z.string(),
});

export function registrarRutasReportes(app: FastifyInstance, deps: { pool: Pool }): void {
  const { pool } = deps;

  app.get("/reportes/balance-comprobacion", async (request) => {
    const resultado = balanceQuerySchema.safeParse(request.query);
    if (!resultado.success) {
      throw new DomainError(
        "VALIDACION",
        resultado.error.issues.map((i) => i.message).join("; "),
        400,
      );
    }
    return balanceDeComprobacion(pool, resultado.data);
  });
}
