import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export interface FixtureCuentas {
  caja: string;
  capital: string;
  ventas: string;
  gastoOperacion: string;
  grupoActivo: string;
  inactiva: string;
  requiereTercero: string;
}

export interface Fixture {
  empresaId: string;
  sociedadId: string;
  planCuentasId: string;
  ejercicioId: string;
  periodoAbiertoId: string;
  periodoCerradoId: string;
  cuentas: FixtureCuentas;
  tipoDocumentoAsId: string;
  tipoDocumentoStId: string;
  terceroId: string;
}

export function codigo(prefijo: string): string {
  return `${prefijo}_${randomUUID().slice(0, 8)}`;
}

/** Catálogo compartido (tipo_documento es global): crea o reutiliza por código. */
export async function obtenerOCrearTipoDocumento(
  pool: Pool,
  tipoCodigo: string,
  nombre: string,
  moduloOrigen: string,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO tipo_documento (codigo, nombre, modulo_origen)
     VALUES ($1, $2, $3)
     ON CONFLICT (codigo) DO UPDATE SET codigo = EXCLUDED.codigo
     RETURNING id`,
    [tipoCodigo, nombre, moduloOrigen],
  );
  return result.rows[0]!.id;
}

/**
 * Crea una sociedad completa y lista para contabilizar: empresa, plan de
 * cuentas mínimo, ejercicio del año en curso con un período abierto (el que
 * cubre la fecha de hoy) y uno cerrado (el mes anterior), y los tipos de
 * documento AS/ST (catálogo compartido, se reutilizan si ya existen).
 */
export async function crearFixture(pool: Pool): Promise<Fixture> {
  const empresaResult = await pool.query<{ id: string }>(
    `INSERT INTO empresa (codigo, nombre) VALUES ($1, $2) RETURNING id`,
    [codigo("EMP"), "Empresa de prueba"],
  );
  const empresaId = empresaResult.rows[0]!.id;

  const planResult = await pool.query<{ id: string }>(
    `INSERT INTO plan_cuentas (codigo, nombre, es_plantilla) VALUES ($1, $2, false) RETURNING id`,
    [codigo("PLAN"), "Plan de prueba"],
  );
  const planCuentasId = planResult.rows[0]!.id;

  const sociedadResult = await pool.query<{ id: string }>(
    `INSERT INTO sociedad (empresa_id, codigo, nombre, pais, moneda_funcional, plan_cuentas_id)
     VALUES ($1, $2, $3, 'SV', 'USD', $4) RETURNING id`,
    [empresaId, codigo("SOC"), "Sociedad de prueba", planCuentasId],
  );
  const sociedadId = sociedadResult.rows[0]!.id;

  const crearCuenta = async (
    nombre: string,
    tipo: string,
    naturaleza: string,
    opciones: Partial<{
      permiteMovimientos: boolean;
      activa: boolean;
      requiereTercero: boolean;
      requiereCentroCosto: boolean;
    }> = {},
  ): Promise<string> => {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO cuenta (
         plan_cuentas_id, codigo, nombre, tipo, naturaleza,
         permite_movimientos, requiere_tercero, requiere_centro_costo, activa
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        planCuentasId,
        codigo("CTA"),
        nombre,
        tipo,
        naturaleza,
        opciones.permiteMovimientos ?? true,
        opciones.requiereTercero ?? false,
        opciones.requiereCentroCosto ?? false,
        opciones.activa ?? true,
      ],
    );
    return result.rows[0]!.id;
  };

  const cuentas: FixtureCuentas = {
    caja: await crearCuenta("Caja", "activo", "deudora"),
    capital: await crearCuenta("Capital social", "patrimonio", "acreedora"),
    ventas: await crearCuenta("Ventas", "ingreso", "acreedora"),
    gastoOperacion: await crearCuenta("Gastos de operación", "gasto", "deudora"),
    grupoActivo: await crearCuenta("Activo (grupo)", "activo", "deudora", {
      permiteMovimientos: false,
    }),
    inactiva: await crearCuenta("Cuenta inactiva", "activo", "deudora", {
      activa: false,
    }),
    requiereTercero: await crearCuenta("Cuentas por cobrar", "activo", "deudora", {
      requiereTercero: true,
    }),
  };

  const anio = new Date().getFullYear();
  const ejercicioResult = await pool.query<{ id: string }>(
    `INSERT INTO ejercicio_fiscal (sociedad_id, anio, fecha_inicio, fecha_fin, estado)
     VALUES ($1, $2, $3, $4, 'abierto') RETURNING id`,
    [sociedadId, anio, `${anio}-01-01`, `${anio}-12-31`],
  );
  const ejercicioId = ejercicioResult.rows[0]!.id;

  const hoy = new Date();
  const mesAbierto = hoy.getMonth() + 1;
  const mesCerrado = mesAbierto === 1 ? 2 : mesAbierto - 1;

  const crearPeriodo = async (numero: number, estado: "abierto" | "cerrado"): Promise<string> => {
    const inicio = new Date(Date.UTC(anio, numero - 1, 1));
    const fin = new Date(Date.UTC(anio, numero, 0));
    const result = await pool.query<{ id: string }>(
      `INSERT INTO periodo_contable (ejercicio_id, numero, fecha_inicio, fecha_fin, estado)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [
        ejercicioId,
        numero,
        inicio.toISOString().slice(0, 10),
        fin.toISOString().slice(0, 10),
        estado,
      ],
    );
    return result.rows[0]!.id;
  };

  const periodoAbiertoId = await crearPeriodo(mesAbierto, "abierto");
  const periodoCerradoId = await crearPeriodo(mesCerrado, "cerrado");

  const tipoDocumentoAsId = await obtenerOCrearTipoDocumento(pool, "AS", "Asiento manual", "GL");
  const tipoDocumentoStId = await obtenerOCrearTipoDocumento(pool, "ST", "Storno", "GL");

  const terceroResult = await pool.query<{ id: string }>(
    `INSERT INTO tercero (empresa_id, codigo, nombre, es_cliente, es_proveedor)
     VALUES ($1, $2, 'Tercero de prueba', true, true) RETURNING id`,
    [empresaId, codigo("TERC")],
  );
  const terceroId = terceroResult.rows[0]!.id;

  return {
    empresaId,
    sociedadId,
    planCuentasId,
    ejercicioId,
    periodoAbiertoId,
    periodoCerradoId,
    cuentas,
    tipoDocumentoAsId,
    tipoDocumentoStId,
    terceroId,
  };
}

export function fechaEnPeriodoAbierto(): string {
  return new Date().toISOString().slice(0, 10);
}
