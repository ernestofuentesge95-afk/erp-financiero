import { createPool } from "./pool.js";

/**
 * Datos semilla idempotentes (ON CONFLICT DO UPDATE ... RETURNING id, para
 * poder recuperar el id incluso cuando la fila ya existía). Uso: npm run seed.
 *
 * Nota sobre nombres: el código de tipo_documento 'AP' (asiento de apertura)
 * y el código de módulo_origen 'AP' (Cuentas por Pagar) coinciden por texto
 * pero son columnas y catálogos distintos — ambigüedad heredada de
 * docs/01-modelo-datos-nucleo.md §3, no un error de este script.
 */

const pool = createPool();

async function upsertPlanCuentas(codigo: string, nombre: string, esPlantilla: boolean): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO plan_cuentas (codigo, nombre, es_plantilla)
     VALUES ($1, $2, $3)
     ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre
     RETURNING id`,
    [codigo, nombre, esPlantilla],
  );
  return result.rows[0]!.id;
}

interface CuentaSemilla {
  codigo: string;
  nombre: string;
  tipo: "activo" | "pasivo" | "patrimonio" | "ingreso" | "gasto";
  naturaleza: "deudora" | "acreedora";
  padre?: string;
  permiteMovimientos?: boolean;
  requiereTercero?: boolean;
  requiereCentroCosto?: boolean;
  gestionPartidasAbiertas?: boolean;
}

async function upsertCuenta(
  planCuentasId: string,
  cuenta: CuentaSemilla,
  idsPorCodigo: Map<string, string>,
): Promise<void> {
  const cuentaPadreId = cuenta.padre ? (idsPorCodigo.get(cuenta.padre) ?? null) : null;
  const result = await pool.query<{ id: string }>(
    `INSERT INTO cuenta (
       plan_cuentas_id, codigo, nombre, tipo, naturaleza, cuenta_padre_id,
       permite_movimientos, requiere_tercero, requiere_centro_costo, gestion_partidas_abiertas
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (plan_cuentas_id, codigo) DO UPDATE SET nombre = EXCLUDED.nombre
     RETURNING id`,
    [
      planCuentasId,
      cuenta.codigo,
      cuenta.nombre,
      cuenta.tipo,
      cuenta.naturaleza,
      cuentaPadreId,
      cuenta.permiteMovimientos ?? true,
      cuenta.requiereTercero ?? false,
      cuenta.requiereCentroCosto ?? false,
      cuenta.gestionPartidasAbiertas ?? false,
    ],
  );
  idsPorCodigo.set(cuenta.codigo, result.rows[0]!.id);
}

// Plantilla de plan de cuentas para pyme salvadoreña. Cuentas de grupo
// (permiteMovimientos: false) agrupan para reportes; las hojas reciben
// movimientos. No pretende ser un catálogo fiscal exhaustivo, es la base
// mínima para operar Fase 1-3.
const PLAN_CUENTAS_SV_PYME: CuentaSemilla[] = [
  // Activo
  { codigo: "1", nombre: "Activo", tipo: "activo", naturaleza: "deudora", permiteMovimientos: false },
  { codigo: "11", nombre: "Activo corriente", tipo: "activo", naturaleza: "deudora", padre: "1", permiteMovimientos: false },
  { codigo: "1101", nombre: "Caja general", tipo: "activo", naturaleza: "deudora", padre: "11" },
  { codigo: "1102", nombre: "Bancos", tipo: "activo", naturaleza: "deudora", padre: "11", gestionPartidasAbiertas: true },
  { codigo: "1103", nombre: "Cuentas por cobrar clientes", tipo: "activo", naturaleza: "deudora", padre: "11", requiereTercero: true, gestionPartidasAbiertas: true },
  { codigo: "1104", nombre: "IVA crédito fiscal", tipo: "activo", naturaleza: "deudora", padre: "11" },
  { codigo: "1105", nombre: "Inventario de mercadería", tipo: "activo", naturaleza: "deudora", padre: "11" },
  { codigo: "1106", nombre: "Gastos pagados por anticipado", tipo: "activo", naturaleza: "deudora", padre: "11" },
  { codigo: "12", nombre: "Activo no corriente", tipo: "activo", naturaleza: "deudora", padre: "1", permiteMovimientos: false },
  { codigo: "1201", nombre: "Mobiliario y equipo", tipo: "activo", naturaleza: "deudora", padre: "12" },
  { codigo: "1202", nombre: "Equipo de cómputo", tipo: "activo", naturaleza: "deudora", padre: "12" },
  { codigo: "1203", nombre: "Depreciación acumulada", tipo: "activo", naturaleza: "acreedora", padre: "12" },

  // Pasivo
  { codigo: "2", nombre: "Pasivo", tipo: "pasivo", naturaleza: "acreedora", permiteMovimientos: false },
  { codigo: "21", nombre: "Pasivo corriente", tipo: "pasivo", naturaleza: "acreedora", padre: "2", permiteMovimientos: false },
  { codigo: "2101", nombre: "Cuentas por pagar proveedores", tipo: "pasivo", naturaleza: "acreedora", padre: "21", requiereTercero: true, gestionPartidasAbiertas: true },
  { codigo: "2102", nombre: "IVA débito fiscal", tipo: "pasivo", naturaleza: "acreedora", padre: "21" },
  { codigo: "2103", nombre: "IVA por pagar", tipo: "pasivo", naturaleza: "acreedora", padre: "21" },
  { codigo: "2104", nombre: "Sueldos y salarios por pagar", tipo: "pasivo", naturaleza: "acreedora", padre: "21" },
  { codigo: "2105", nombre: "Préstamos bancarios a corto plazo", tipo: "pasivo", naturaleza: "acreedora", padre: "21" },

  // Patrimonio
  { codigo: "3", nombre: "Patrimonio", tipo: "patrimonio", naturaleza: "acreedora", permiteMovimientos: false },
  { codigo: "3101", nombre: "Capital social", tipo: "patrimonio", naturaleza: "acreedora", padre: "3" },
  { codigo: "3102", nombre: "Utilidades retenidas", tipo: "patrimonio", naturaleza: "acreedora", padre: "3" },
  { codigo: "3103", nombre: "Resultado del ejercicio", tipo: "patrimonio", naturaleza: "acreedora", padre: "3" },

  // Ingreso
  { codigo: "4", nombre: "Ingreso", tipo: "ingreso", naturaleza: "acreedora", permiteMovimientos: false },
  { codigo: "4101", nombre: "Ventas", tipo: "ingreso", naturaleza: "acreedora", padre: "4" },
  { codigo: "4102", nombre: "Otros ingresos", tipo: "ingreso", naturaleza: "acreedora", padre: "4" },

  // Gasto
  { codigo: "5", nombre: "Gasto", tipo: "gasto", naturaleza: "deudora", permiteMovimientos: false },
  { codigo: "5101", nombre: "Costo de ventas", tipo: "gasto", naturaleza: "deudora", padre: "5" },
  { codigo: "51", nombre: "Gastos de operación", tipo: "gasto", naturaleza: "deudora", padre: "5", permiteMovimientos: false },
  { codigo: "5201", nombre: "Sueldos y salarios", tipo: "gasto", naturaleza: "deudora", padre: "51", requiereCentroCosto: true },
  { codigo: "5202", nombre: "Alquileres", tipo: "gasto", naturaleza: "deudora", padre: "51", requiereCentroCosto: true },
  { codigo: "5203", nombre: "Servicios básicos", tipo: "gasto", naturaleza: "deudora", padre: "51", requiereCentroCosto: true },
  { codigo: "5204", nombre: "Depreciaciones", tipo: "gasto", naturaleza: "deudora", padre: "51", requiereCentroCosto: true },
  { codigo: "5205", nombre: "Gastos financieros", tipo: "gasto", naturaleza: "deudora", padre: "51" },
  { codigo: "5206", nombre: "Gastos generales", tipo: "gasto", naturaleza: "deudora", padre: "51", requiereCentroCosto: true },
  { codigo: "5207", nombre: "Devoluciones y descuentos sobre compras", tipo: "gasto", naturaleza: "acreedora", padre: "51" },
];

const TIPOS_DOCUMENTO: Array<{ codigo: string; nombre: string; moduloOrigen: string }> = [
  { codigo: "AS", nombre: "Asiento manual", moduloOrigen: "GL" },
  { codigo: "FP", nombre: "Factura de proveedor", moduloOrigen: "AP" },
  { codigo: "NC-P", nombre: "Nota de crédito de proveedor", moduloOrigen: "AP" },
  { codigo: "PG", nombre: "Pago emitido", moduloOrigen: "AP" },
  { codigo: "FC", nombre: "Factura a cliente", moduloOrigen: "AR" },
  { codigo: "NC-C", nombre: "Nota de crédito a cliente", moduloOrigen: "AR" },
  { codigo: "CB", nombre: "Cobro recibido", moduloOrigen: "AR" },
  { codigo: "CB-AJ", nombre: "Ajuste bancario", moduloOrigen: "BK" },
  { codigo: "ST", nombre: "Storno", moduloOrigen: "GL" },
  { codigo: "AP", nombre: "Asiento de apertura", moduloOrigen: "GL" },
  { codigo: "CI", nombre: "Asiento de cierre", moduloOrigen: "GL" },
];

async function upsertTipoDocumento(codigo: string, nombre: string, moduloOrigen: string): Promise<void> {
  await pool.query(
    `INSERT INTO tipo_documento (codigo, nombre, modulo_origen)
     VALUES ($1, $2, $3)
     ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, modulo_origen = EXCLUDED.modulo_origen`,
    [codigo, nombre, moduloOrigen],
  );
}

async function upsertIndicadorImpuesto(
  sociedadId: string,
  codigo: string,
  tasa: number,
  cuentaIvaCreditoId: string | null,
  cuentaIvaDebitoId: string | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO indicador_impuesto (sociedad_id, codigo, tasa, cuenta_iva_credito_id, cuenta_iva_debito_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (sociedad_id, codigo) DO UPDATE SET
       tasa = EXCLUDED.tasa,
       cuenta_iva_credito_id = EXCLUDED.cuenta_iva_credito_id,
       cuenta_iva_debito_id = EXCLUDED.cuenta_iva_debito_id`,
    [sociedadId, codigo, tasa, cuentaIvaCreditoId, cuentaIvaDebitoId],
  );
}

async function upsertReglaDeterminacionCuenta(
  sociedadId: string,
  modulo: string,
  operacion: string,
  cuentaId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO regla_determinacion_cuenta (sociedad_id, modulo, operacion, condicion, cuenta_id)
     VALUES ($1, $2, $3, NULL, $4)
     ON CONFLICT (sociedad_id, modulo, operacion, COALESCE(condicion, ''))
     DO UPDATE SET cuenta_id = EXCLUDED.cuenta_id`,
    [sociedadId, modulo, operacion, cuentaId],
  );
}

async function seedSociedadDemo(planCuentasId: string, idsPorCodigo: Map<string, string>): Promise<void> {
  const empresaResult = await pool.query<{ id: string }>(
    `INSERT INTO empresa (codigo, nombre)
     VALUES ('DEMO', 'Empresa Demo, S.A. de C.V.')
     ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre
     RETURNING id`,
  );
  const empresaId = empresaResult.rows[0]!.id;

  const sociedadResult = await pool.query<{ id: string }>(
    `INSERT INTO sociedad (empresa_id, codigo, nombre, nit, pais, moneda_funcional, plan_cuentas_id)
     VALUES ($1, 'SV01', 'Empresa Demo, S.A. de C.V.', '0614-000000-000-0', 'SV', 'USD', $2)
     ON CONFLICT (empresa_id, codigo) DO UPDATE SET nombre = EXCLUDED.nombre
     RETURNING id`,
    [empresaId, planCuentasId],
  );
  const sociedadId = sociedadResult.rows[0]!.id;

  const anio = 2026;
  const ejercicioResult = await pool.query<{ id: string }>(
    `INSERT INTO ejercicio_fiscal (sociedad_id, anio, fecha_inicio, fecha_fin, estado)
     VALUES ($1, $2, $3, $4, 'abierto')
     ON CONFLICT (sociedad_id, anio) DO UPDATE SET estado = EXCLUDED.estado
     RETURNING id`,
    [sociedadId, anio, `${anio}-01-01`, `${anio}-12-31`],
  );
  const ejercicioId = ejercicioResult.rows[0]!.id;

  for (let numero = 1; numero <= 12; numero += 1) {
    const inicio = new Date(Date.UTC(anio, numero - 1, 1));
    const fin = new Date(Date.UTC(anio, numero, 0));
    await pool.query(
      `INSERT INTO periodo_contable (ejercicio_id, numero, fecha_inicio, fecha_fin, estado)
       VALUES ($1, $2, $3, $4, 'abierto')
       ON CONFLICT (ejercicio_id, numero) DO NOTHING`,
      [ejercicioId, numero, inicio.toISOString().slice(0, 10), fin.toISOString().slice(0, 10)],
    );
  }
  // Período 13 (ajustes de cierre): mismas fechas que el cierre del
  // ejercicio; se asigna explícitamente en el proceso de cierre (Fase 6),
  // nunca por búsqueda de fecha (ver ContabilizacionService).
  await pool.query(
    `INSERT INTO periodo_contable (ejercicio_id, numero, fecha_inicio, fecha_fin, estado)
     VALUES ($1, 13, $2, $2, 'abierto')
     ON CONFLICT (ejercicio_id, numero) DO NOTHING`,
    [ejercicioId, `${anio}-12-31`],
  );

  // IVA 13% El Salvador.
  await upsertIndicadorImpuesto(
    sociedadId,
    "IVA13",
    0.13,
    idsPorCodigo.get("1104")!,
    idsPorCodigo.get("2102")!,
  );
  await upsertIndicadorImpuesto(sociedadId, "EXENTO", 0, null, null);

  // Reglas de determinación de cuentas AP default: quien captura una
  // factura o pago nunca elige cuenta_id, solo estos códigos de operación.
  await upsertReglaDeterminacionCuenta(sociedadId, "AP", "AP.CXP_DEFAULT", idsPorCodigo.get("2101")!);
  await upsertReglaDeterminacionCuenta(sociedadId, "BK", "BK.BANCO_DEFAULT", idsPorCodigo.get("1102")!);
  await upsertReglaDeterminacionCuenta(
    sociedadId,
    "AP",
    "AP.NC_CONTRAPARTIDA",
    idsPorCodigo.get("5207")!,
  );
  await upsertReglaDeterminacionCuenta(sociedadId, "AP", "AP.GASTO_OPERACION", idsPorCodigo.get("5206")!);
  await upsertReglaDeterminacionCuenta(sociedadId, "AP", "AP.GASTO_SUELDOS", idsPorCodigo.get("5201")!);
  await upsertReglaDeterminacionCuenta(sociedadId, "AP", "AP.GASTO_ALQUILER", idsPorCodigo.get("5202")!);
  await upsertReglaDeterminacionCuenta(sociedadId, "AP", "AP.GASTO_SERVICIOS", idsPorCodigo.get("5203")!);

  await pool.query(
    `INSERT INTO centro_costo (sociedad_id, codigo, nombre)
     VALUES ($1, 'ADM', 'Administración')
     ON CONFLICT (sociedad_id, codigo) DO UPDATE SET nombre = EXCLUDED.nombre`,
    [sociedadId],
  );

  const proveedorResult = await pool.query<{ id: string }>(
    `INSERT INTO tercero (empresa_id, codigo, nombre, nit, es_proveedor, condicion_pago_dias)
     VALUES ($1, 'PROV001', 'Proveedor Demo, S.A. de C.V.', '0614-111111-111-1', true, 30)
     ON CONFLICT (empresa_id, codigo) DO UPDATE SET nombre = EXCLUDED.nombre
     RETURNING id`,
    [empresaId],
  );

  console.log(`Sociedad demo: empresa=${empresaId} sociedad=${sociedadId} ejercicio ${anio}=${ejercicioId}`);
  console.log(`Proveedor demo: ${proveedorResult.rows[0]!.id}`);
}

async function main(): Promise<void> {
  const planCuentasId = await upsertPlanCuentas("SV_PYME", "Plan de cuentas — pyme El Salvador", true);
  console.log(`Plan de cuentas SV_PYME: ${planCuentasId}`);

  const idsPorCodigo = new Map<string, string>();
  for (const cuenta of PLAN_CUENTAS_SV_PYME) {
    await upsertCuenta(planCuentasId, cuenta, idsPorCodigo);
  }
  console.log(`Cuentas creadas/actualizadas: ${idsPorCodigo.size}`);

  for (const tipo of TIPOS_DOCUMENTO) {
    await upsertTipoDocumento(tipo.codigo, tipo.nombre, tipo.moduloOrigen);
  }
  console.log(`Tipos de documento creados/actualizados: ${TIPOS_DOCUMENTO.length}`);

  await seedSociedadDemo(planCuentasId, idsPorCodigo);

  await pool.end();
  console.log("Seed completo.");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
