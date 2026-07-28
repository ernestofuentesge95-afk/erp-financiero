import type { ZodType } from "zod";
import { DomainError } from "../errors.js";

export function validarCuerpo<T>(schema: ZodType<T>, datos: unknown): T {
  const resultado = schema.safeParse(datos);
  if (!resultado.success) {
    throw new DomainError("VALIDACION", resultado.error.issues.map((i) => i.message).join("; "), 400);
  }
  return resultado.data;
}
