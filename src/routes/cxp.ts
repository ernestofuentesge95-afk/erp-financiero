import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { validarCuerpo } from "../http/validar.js";
import { DomainError } from "../errors.js";
import type { ContabilizacionService } from "../nucleo/contabilizacion.service.js";
import { FacturaProveedorService } from "../modulos/cxp/factura-proveedor.service.js";
import { PagoService } from "../modulos/cxp/pago.service.js";
import { NotaCreditoProveedorService } from "../modulos/cxp/nota-credito-proveedor.service.js";
import { antiguedadCxP, auxiliarProveedor, partidasAbiertasPorProveedor } from "../modulos/cxp/reportes.js";

const lineaFacturaSchema = z.object({
  operacion: z.string().min(1),
  monto: z.string(),
  centroCostoId: z.string().optional(),
  descripcion: z.string().optional(),
});

const registrarFacturaSchema = z.object({
  sociedadId: z.string().min(1),
  terceroId: z.string().min(1),
  fecha: z.string(),
  referencia: z.string().min(1),
  indicadorImpuestoCodigo: z.string().optional(),
  lineas: z.array(lineaFacturaSchema).min(1),
  creadoPor: z.string().min(1),
});

const aplicacionPagoSchema = z.object({
  lineaAbiertaId: z.string().min(1),
  monto: z.string(),
});

const registrarPagoSchema = z.object({
  sociedadId: z.string().min(1),
  terceroId: z.string().min(1),
  fecha: z.string(),
  referencia: z.string().optional(),
  aplicaciones: z.array(aplicacionPagoSchema).min(1),
  creadoPor: z.string().min(1),
});

const registrarNotaCreditoSchema = z.object({
  sociedadId: z.string().min(1),
  terceroId: z.string().min(1),
  fecha: z.string(),
  referencia: z.string().min(1),
  lineaAbiertaId: z.string().min(1),
  monto: z.string(),
  operacionContrapartida: z.string().min(1),
  creadoPor: z.string().min(1),
});

const auxiliarProveedorQuerySchema = z.object({
  sociedadId: z.string().min(1),
  terceroId: z.string().min(1),
  fechaDesde: z.string(),
  fechaHasta: z.string(),
});

const crearTerceroSchema = z.object({
  codigo: z.string().min(1),
  nombre: z.string().min(1),
  nit: z.string().optional(),
  esCliente: z.boolean().optional(),
  esProveedor: z.boolean().optional(),
  condicionPagoDias: z.number().int().nonnegative().optional(),
});

const crearCentroCostoSchema = z.object({
  codigo: z.string().min(1),
  nombre: z.string().min(1),
});

const crearIndicadorImpuestoSchema = z.object({
  codigo: z.string().min(1),
  tasa: z.number().min(0),
  cuentaIvaCreditoId: z.string().optional(),
  cuentaIvaDebitoId: z.string().optional(),
});

const crearReglaDeterminacionSchema = z.object({
  modulo: z.string().min(1),
  operacion: z.string().min(1),
  condicion: z.string().optional(),
  cuentaId: z.string().min(1),
});

export function registrarRutasCxP(
  app: FastifyInstance,
  deps: { pool: Pool; contabilizacion: ContabilizacionService },
): void {
  const { pool, contabilizacion } = deps;
  const facturas = new FacturaProveedorService(pool, contabilizacion);
  const pagos = new PagoService(pool, contabilizacion);
  const notasCredito = new NotaCreditoProveedorService(pool, contabilizacion);

  app.post("/cxp/facturas", async (request, reply) => {
    const body = validarCuerpo(registrarFacturaSchema, request.body);
    const documento = await facturas.registrarFactura(body);
    reply.status(201);
    return documento;
  });

  app.post("/cxp/pagos", async (request, reply) => {
    const body = validarCuerpo(registrarPagoSchema, request.body);
    const resultado = await pagos.registrarPago(body);
    reply.status(201);
    return resultado;
  });

  app.post("/cxp/notas-credito", async (request, reply) => {
    const body = validarCuerpo(registrarNotaCreditoSchema, request.body);
    const documento = await notasCredito.registrarNotaCredito(body);
    reply.status(201);
    return documento;
  });

  app.get("/cxp/partidas-abiertas", async (request) => {
    const query = request.query as { sociedadId?: string; terceroId?: string; fechaCorte?: string };
    if (!query.sociedadId) {
      return [];
    }
    return partidasAbiertasPorProveedor(pool, {
      sociedadId: query.sociedadId,
      terceroId: query.terceroId,
      fechaCorte: query.fechaCorte,
    });
  });

  app.get("/cxp/antiguedad", async (request) => {
    const query = request.query as { sociedadId?: string; fechaCorte?: string };
    if (!query.sociedadId) {
      return [];
    }
    return antiguedadCxP(pool, { sociedadId: query.sociedadId, fechaCorte: query.fechaCorte });
  });

  app.get("/cxp/auxiliar-proveedor", async (request) => {
    const resultado = auxiliarProveedorQuerySchema.safeParse(request.query);
    if (!resultado.success) {
      throw new DomainError(
        "VALIDACION",
        resultado.error.issues.map((i) => i.message).join("; "),
        400,
      );
    }
    return auxiliarProveedor(pool, resultado.data);
  });

  app.get("/empresas/:id/terceros", async (request) => {
    const { id } = request.params as { id: string };
    const result = await pool.query(`SELECT * FROM tercero WHERE empresa_id = $1 ORDER BY codigo`, [id]);
    return result.rows;
  });

  app.post("/empresas/:id/terceros", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = validarCuerpo(crearTerceroSchema, request.body);
    const result = await pool.query(
      `INSERT INTO tercero (empresa_id, codigo, nombre, nit, es_cliente, es_proveedor, condicion_pago_dias)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        id,
        body.codigo,
        body.nombre,
        body.nit ?? null,
        body.esCliente ?? false,
        body.esProveedor ?? false,
        body.condicionPagoDias ?? 30,
      ],
    );
    reply.status(201);
    return result.rows[0];
  });

  app.get("/sociedades/:id/centros-costo", async (request) => {
    const { id } = request.params as { id: string };
    const result = await pool.query(`SELECT * FROM centro_costo WHERE sociedad_id = $1 ORDER BY codigo`, [
      id,
    ]);
    return result.rows;
  });

  app.post("/sociedades/:id/centros-costo", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = validarCuerpo(crearCentroCostoSchema, request.body);
    const result = await pool.query(
      `INSERT INTO centro_costo (sociedad_id, codigo, nombre) VALUES ($1, $2, $3) RETURNING *`,
      [id, body.codigo, body.nombre],
    );
    reply.status(201);
    return result.rows[0];
  });

  app.get("/sociedades/:id/indicadores-impuesto", async (request) => {
    const { id } = request.params as { id: string };
    const result = await pool.query(
      `SELECT * FROM indicador_impuesto WHERE sociedad_id = $1 ORDER BY codigo`,
      [id],
    );
    return result.rows;
  });

  app.post("/sociedades/:id/indicadores-impuesto", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = validarCuerpo(crearIndicadorImpuestoSchema, request.body);
    const result = await pool.query(
      `INSERT INTO indicador_impuesto (sociedad_id, codigo, tasa, cuenta_iva_credito_id, cuenta_iva_debito_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, body.codigo, body.tasa, body.cuentaIvaCreditoId ?? null, body.cuentaIvaDebitoId ?? null],
    );
    reply.status(201);
    return result.rows[0];
  });

  app.get("/sociedades/:id/reglas-determinacion", async (request) => {
    const { id } = request.params as { id: string };
    const result = await pool.query(
      `SELECT * FROM regla_determinacion_cuenta WHERE sociedad_id = $1 ORDER BY modulo, operacion`,
      [id],
    );
    return result.rows;
  });

  app.post("/sociedades/:id/reglas-determinacion", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = validarCuerpo(crearReglaDeterminacionSchema, request.body);
    const result = await pool.query(
      `INSERT INTO regla_determinacion_cuenta (sociedad_id, modulo, operacion, condicion, cuenta_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, body.modulo, body.operacion, body.condicion ?? null, body.cuentaId],
    );
    reply.status(201);
    return result.rows[0];
  });
}
