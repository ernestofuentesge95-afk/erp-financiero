import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { env } from "./config/env.js";
import { registerErrorHandler } from "./plugins/error-handler.js";
import { createPool } from "./db/pool.js";

const loggerOptions: FastifyServerOptions["logger"] =
  env.NODE_ENV === "development"
    ? { level: env.LOG_LEVEL, transport: { target: "pino-pretty" } }
    : { level: env.LOG_LEVEL };

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: loggerOptions });
  const pool = createPool();

  registerErrorHandler(app);

  app.get("/health", async () => {
    return { status: "ok", timestamp: new Date().toISOString() };
  });

  app.get("/health/db", async () => {
    await pool.query("SELECT 1");
    return { status: "ok" };
  });

  app.addHook("onClose", async () => {
    await pool.end();
  });

  return app;
}
