import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { env } from "./config/env.js";
import { registerErrorHandler } from "./plugins/error-handler.js";
import { createPool } from "./db/pool.js";
import { ContabilizacionService } from "./nucleo/contabilizacion.service.js";
import { registrarRutasCatalogos } from "./routes/catalogos.js";
import { registrarRutasDocumentos } from "./routes/documentos.js";
import { registrarRutasReportes } from "./routes/reportes.js";

const loggerOptions: FastifyServerOptions["logger"] =
  env.NODE_ENV === "development"
    ? { level: env.LOG_LEVEL, transport: { target: "pino-pretty" } }
    : { level: env.LOG_LEVEL };

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: loggerOptions });
  const pool = createPool();
  const contabilizacion = new ContabilizacionService(pool);

  registerErrorHandler(app);

  app.get("/health", async () => {
    return { status: "ok", timestamp: new Date().toISOString() };
  });

  app.get("/health/db", async () => {
    await pool.query("SELECT 1");
    return { status: "ok" };
  });

  registrarRutasCatalogos(app, { pool });
  registrarRutasDocumentos(app, { contabilizacion });
  registrarRutasReportes(app, { pool });

  app.addHook("onClose", async () => {
    await pool.end();
  });

  return app;
}
