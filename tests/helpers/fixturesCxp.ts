import type { Pool } from "pg";
import { codigo, crearFixture, obtenerOCrearTipoDocumento, type Fixture } from "./fixtures.js";

export interface FixtureCxP extends Fixture {
  terceroId: string;
  terceroInactivoId: string;
  centroCostoId: string;
  indicadorIvaId: string;
  cuentaCxpId: string;
  cuentaIvaCreditoId: string;
  cuentaGastoId: string;
  cuentaBancoId: string;
  cuentaContrapartidaNcId: string;
  tipoDocumentoFpId: string;
  tipoDocumentoNcpId: string;
  tipoDocumentoPgId: string;
}

/**
 * Extiende crearFixture() con lo que necesita el módulo de Cuentas por
 * Pagar: tercero proveedor, centro de costo, indicador de impuesto IVA 13%,
 * cuentas CxP/IVA-crédito/Gasto/Banco/Contrapartida-NC, y las reglas de
 * determinación de cuentas que las conectan (AP.CXP_DEFAULT,
 * AP.GASTO_OPERACION, AP.NC_CONTRAPARTIDA, BK.BANCO_DEFAULT) — así el
 * servicio nunca recibe un cuenta_id directamente, solo códigos de operación.
 */
export async function crearFixtureCxP(pool: Pool): Promise<FixtureCxP> {
  const fx = await crearFixture(pool);

  const crearCuenta = async (
    nombre: string,
    tipo: string,
    naturaleza: string,
    opciones: Partial<{ requiereTercero: boolean; gestionPartidasAbiertas: boolean }> = {},
  ): Promise<string> => {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO cuenta (
         plan_cuentas_id, codigo, nombre, tipo, naturaleza,
         requiere_tercero, gestion_partidas_abiertas
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        fx.planCuentasId,
        codigo("CTA"),
        nombre,
        tipo,
        naturaleza,
        opciones.requiereTercero ?? false,
        opciones.gestionPartidasAbiertas ?? false,
      ],
    );
    return result.rows[0]!.id;
  };

  const cuentaCxpId = await crearCuenta("Cuentas por pagar proveedores", "pasivo", "acreedora", {
    requiereTercero: true,
    gestionPartidasAbiertas: true,
  });
  const cuentaIvaCreditoId = await crearCuenta("IVA crédito fiscal", "activo", "deudora");
  const cuentaGastoId = await crearCuenta("Gastos de operación (CxP)", "gasto", "deudora");
  const cuentaBancoId = await crearCuenta("Banco", "activo", "deudora");
  const cuentaContrapartidaNcId = await crearCuenta(
    "Devoluciones y descuentos sobre compras",
    "gasto",
    "acreedora",
  );

  const terceroResult = await pool.query<{ id: string }>(
    `INSERT INTO tercero (empresa_id, codigo, nombre, es_proveedor, condicion_pago_dias)
     VALUES ($1, $2, 'Proveedor de prueba', true, 30) RETURNING id`,
    [fx.empresaId, codigo("PROV")],
  );
  const terceroId = terceroResult.rows[0]!.id;

  const terceroInactivoResult = await pool.query<{ id: string }>(
    `INSERT INTO tercero (empresa_id, codigo, nombre, es_proveedor, activo)
     VALUES ($1, $2, 'Proveedor inactivo', true, false) RETURNING id`,
    [fx.empresaId, codigo("PROV")],
  );
  const terceroInactivoId = terceroInactivoResult.rows[0]!.id;

  const centroCostoResult = await pool.query<{ id: string }>(
    `INSERT INTO centro_costo (sociedad_id, codigo, nombre) VALUES ($1, $2, 'Administración') RETURNING id`,
    [fx.sociedadId, codigo("CC")],
  );
  const centroCostoId = centroCostoResult.rows[0]!.id;

  const indicadorResult = await pool.query<{ id: string }>(
    `INSERT INTO indicador_impuesto (sociedad_id, codigo, tasa, cuenta_iva_credito_id)
     VALUES ($1, 'IVA13', 0.13, $2) RETURNING id`,
    [fx.sociedadId, cuentaIvaCreditoId],
  );
  const indicadorIvaId = indicadorResult.rows[0]!.id;

  const crearRegla = async (modulo: string, operacion: string, cuentaId: string): Promise<void> => {
    await pool.query(
      `INSERT INTO regla_determinacion_cuenta (sociedad_id, modulo, operacion, cuenta_id)
       VALUES ($1, $2, $3, $4)`,
      [fx.sociedadId, modulo, operacion, cuentaId],
    );
  };
  await crearRegla("AP", "AP.CXP_DEFAULT", cuentaCxpId);
  await crearRegla("AP", "AP.GASTO_OPERACION", cuentaGastoId);
  await crearRegla("AP", "AP.NC_CONTRAPARTIDA", cuentaContrapartidaNcId);
  await crearRegla("BK", "BK.BANCO_DEFAULT", cuentaBancoId);

  const tipoDocumentoFpId = await obtenerOCrearTipoDocumento(pool, "FP", "Factura de proveedor", "AP");
  const tipoDocumentoNcpId = await obtenerOCrearTipoDocumento(
    pool,
    "NC-P",
    "Nota de crédito de proveedor",
    "AP",
  );
  const tipoDocumentoPgId = await obtenerOCrearTipoDocumento(pool, "PG", "Pago emitido", "AP");

  return {
    ...fx,
    terceroId,
    terceroInactivoId,
    centroCostoId,
    indicadorIvaId,
    cuentaCxpId,
    cuentaIvaCreditoId,
    cuentaGastoId,
    cuentaBancoId,
    cuentaContrapartidaNcId,
    tipoDocumentoFpId,
    tipoDocumentoNcpId,
    tipoDocumentoPgId,
  };
}
