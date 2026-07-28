import type { FastifyError, FastifyInstance } from "fastify";
import { DomainError } from "../errors.js";

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | DomainError, request, reply) => {
    if (error instanceof DomainError) {
      reply.status(error.statusCode).send({
        error: error.code,
        message: error.message,
      });
      return;
    }

    if (error.validation) {
      reply.status(400).send({
        error: "VALIDATION_ERROR",
        message: error.message,
      });
      return;
    }

    request.log.error(error);
    reply.status(error.statusCode ?? 500).send({
      error: "INTERNAL_ERROR",
      message: "Ocurrió un error inesperado.",
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: "NOT_FOUND",
      message: `Ruta no encontrada: ${request.method} ${request.url}`,
    });
  });
}
