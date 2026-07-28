import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { validarCuerpo } from "../http/validar.js";
import { DocumentoNoEncontradoError } from "../nucleo/errores.js";
import type { ContabilizacionService } from "../nucleo/contabilizacion.service.js";

const lineaSchema = z.object({
  cuentaId: z.string().min(1),
  debe: z.string(),
  haber: z.string(),
  terceroId: z.string().optional(),
  centroCostoId: z.string().optional(),
  descripcion: z.string().optional(),
});

const crearBorradorSchema = z.object({
  sociedadId: z.string().min(1),
  tipoDocumentoId: z.string().min(1),
  fechaDocumento: z.string(),
  fechaContabilizacion: z.string(),
  moneda: z.string().length(3),
  tipoCambio: z.string().optional(),
  referencia: z.string().optional(),
  descripcion: z.string().optional(),
  moduloOrigen: z.string().optional(),
  creadoPor: z.string().min(1),
  lineas: z.array(lineaSchema).min(2),
});

const usuarioSchema = z.object({ usuario: z.string().min(1) });
const stornoSchema = z.object({ usuario: z.string().min(1), motivo: z.string().min(1) });

export function registrarRutasDocumentos(
  app: FastifyInstance,
  deps: { contabilizacion: ContabilizacionService },
): void {
  const { contabilizacion } = deps;

  app.post("/documentos", async (request, reply) => {
    const body = validarCuerpo(crearBorradorSchema, request.body);
    const documento = await contabilizacion.crearBorrador(body);
    reply.status(201);
    return documento;
  });

  app.get("/documentos/:id", async (request) => {
    const { id } = request.params as { id: string };
    const documento = await contabilizacion.obtener(id);
    if (!documento) {
      throw new DocumentoNoEncontradoError(id);
    }
    return documento;
  });

  app.post("/documentos/:id/contabilizar", async (request) => {
    const { id } = request.params as { id: string };
    const { usuario } = validarCuerpo(usuarioSchema, request.body);
    return contabilizacion.contabilizar(id, usuario);
  });

  app.post("/documentos/:id/storno", async (request) => {
    const { id } = request.params as { id: string };
    const { usuario, motivo } = validarCuerpo(stornoSchema, request.body);
    return contabilizacion.stornar(id, motivo, usuario);
  });
}
