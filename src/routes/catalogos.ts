import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { validarCuerpo } from "../http/validar.js";
import { abrirPeriodo, cerrarPeriodo } from "../nucleo/periodos.service.js";

const crearEmpresaSchema = z.object({
  codigo: z.string().min(1),
  nombre: z.string().min(1),
});

const crearSociedadSchema = z.object({
  codigo: z.string().min(1),
  nombre: z.string().min(1),
  nit: z.string().optional(),
  pais: z.string().length(2),
  monedaFuncional: z.string().length(3),
  planCuentasId: z.string().min(1),
});

const crearPlanCuentasSchema = z.object({
  codigo: z.string().min(1),
  nombre: z.string().min(1),
  esPlantilla: z.boolean().optional(),
});

const crearCuentaSchema = z.object({
  codigo: z.string().min(1),
  nombre: z.string().min(1),
  tipo: z.enum(["activo", "pasivo", "patrimonio", "ingreso", "gasto"]),
  naturaleza: z.enum(["deudora", "acreedora"]),
  cuentaPadreId: z.string().optional(),
  permiteMovimientos: z.boolean().optional(),
  requiereTercero: z.boolean().optional(),
  requiereCentroCosto: z.boolean().optional(),
  gestionPartidasAbiertas: z.boolean().optional(),
});

const usuarioQuerySchema = z.object({ usuario: z.string().min(1) });

export function registrarRutasCatalogos(app: FastifyInstance, deps: { pool: Pool }): void {
  const { pool } = deps;

  app.get("/tipos-documento", async () => {
    const result = await pool.query(`SELECT * FROM tipo_documento ORDER BY codigo`);
    return result.rows;
  });

  app.get("/empresas", async () => {
    const result = await pool.query(`SELECT * FROM empresa ORDER BY codigo`);
    return result.rows;
  });

  app.post("/empresas", async (request, reply) => {
    const body = validarCuerpo(crearEmpresaSchema, request.body);
    const result = await pool.query(
      `INSERT INTO empresa (codigo, nombre) VALUES ($1, $2) RETURNING *`,
      [body.codigo, body.nombre],
    );
    reply.status(201);
    return result.rows[0];
  });

  app.get("/planes-cuenta", async () => {
    const result = await pool.query(`SELECT * FROM plan_cuentas ORDER BY codigo`);
    return result.rows;
  });

  app.post("/planes-cuenta", async (request, reply) => {
    const body = validarCuerpo(crearPlanCuentasSchema, request.body);
    const result = await pool.query(
      `INSERT INTO plan_cuentas (codigo, nombre, es_plantilla) VALUES ($1, $2, $3) RETURNING *`,
      [body.codigo, body.nombre, body.esPlantilla ?? false],
    );
    reply.status(201);
    return result.rows[0];
  });

  app.get("/planes-cuenta/:id/cuentas", async (request) => {
    const { id } = request.params as { id: string };
    const result = await pool.query(
      `SELECT * FROM cuenta WHERE plan_cuentas_id = $1 ORDER BY codigo`,
      [id],
    );
    return result.rows;
  });

  app.post("/planes-cuenta/:id/cuentas", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = validarCuerpo(crearCuentaSchema, request.body);
    const result = await pool.query(
      `INSERT INTO cuenta (
         plan_cuentas_id, codigo, nombre, tipo, naturaleza, cuenta_padre_id,
         permite_movimientos, requiere_tercero, requiere_centro_costo, gestion_partidas_abiertas
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        id,
        body.codigo,
        body.nombre,
        body.tipo,
        body.naturaleza,
        body.cuentaPadreId ?? null,
        body.permiteMovimientos ?? true,
        body.requiereTercero ?? false,
        body.requiereCentroCosto ?? false,
        body.gestionPartidasAbiertas ?? false,
      ],
    );
    reply.status(201);
    return result.rows[0];
  });

  app.get("/empresas/:id/sociedades", async (request) => {
    const { id } = request.params as { id: string };
    const result = await pool.query(`SELECT * FROM sociedad WHERE empresa_id = $1 ORDER BY codigo`, [id]);
    return result.rows;
  });

  app.post("/empresas/:id/sociedades", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = validarCuerpo(crearSociedadSchema, request.body);
    const result = await pool.query(
      `INSERT INTO sociedad (empresa_id, codigo, nombre, nit, pais, moneda_funcional, plan_cuentas_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [id, body.codigo, body.nombre, body.nit ?? null, body.pais, body.monedaFuncional, body.planCuentasId],
    );
    reply.status(201);
    return result.rows[0];
  });

  app.get("/sociedades/:id/ejercicios", async (request) => {
    const { id } = request.params as { id: string };
    const result = await pool.query(
      `SELECT * FROM ejercicio_fiscal WHERE sociedad_id = $1 ORDER BY anio`,
      [id],
    );
    return result.rows;
  });

  app.get("/ejercicios/:id/periodos", async (request) => {
    const { id } = request.params as { id: string };
    const result = await pool.query(
      `SELECT * FROM periodo_contable WHERE ejercicio_id = $1 ORDER BY numero`,
      [id],
    );
    return result.rows;
  });

  app.post("/periodos/:id/cerrar", async (request) => {
    const { id } = request.params as { id: string };
    const { usuario } = validarCuerpo(usuarioQuerySchema, request.body);
    return cerrarPeriodo(pool, id, usuario);
  });

  app.post("/periodos/:id/abrir", async (request) => {
    const { id } = request.params as { id: string };
    const { usuario } = validarCuerpo(usuarioQuerySchema, request.body);
    return abrirPeriodo(pool, id, usuario);
  });
}
