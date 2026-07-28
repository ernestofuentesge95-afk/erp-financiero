import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testPool } from "../helpers/db.js";
import { crearFixtureCxP, type FixtureCxP } from "../helpers/fixturesCxp.js";
import { fechaEnPeriodoAbierto } from "../helpers/fixtures.js";
import { ContabilizacionService } from "../../src/nucleo/contabilizacion.service.js";
import {
  IndicadorImpuestoNoEncontradoError,
  LineaInvalidaError,
  MontoAplicacionExcedeSaldoError,
  PartidaYaCompensadaError,
  ReglaDeterminacionNoEncontradaError,
  TerceroInactivoError,
} from "../../src/nucleo/errores.js";
import { FacturaProveedorService } from "../../src/modulos/cxp/factura-proveedor.service.js";
import { PagoService } from "../../src/modulos/cxp/pago.service.js";
import { NotaCreditoProveedorService } from "../../src/modulos/cxp/nota-credito-proveedor.service.js";
import { antiguedadCxP, partidasAbiertasPorProveedor } from "../../src/modulos/cxp/reportes.js";

const USUARIO = "test-cxp@erp-financiero";

afterAll(async () => {
  await testPool.end();
});

function crearServicios() {
  const contabilizacion = new ContabilizacionService(testPool);
  return {
    contabilizacion,
    facturas: new FacturaProveedorService(testPool, contabilizacion),
    pagos: new PagoService(testPool, contabilizacion),
    notasCredito: new NotaCreditoProveedorService(testPool, contabilizacion),
  };
}

describe("FacturaProveedorService", () => {
  let fx: FixtureCxP;
  let servicios: ReturnType<typeof crearServicios>;

  beforeAll(async () => {
    fx = await crearFixtureCxP(testPool);
    servicios = crearServicios();
  });

  it("genera Gasto (D) + IVA crédito (D) contra CxP (H), resolviendo cuentas 100% por regla/indicador", async () => {
    const factura = await servicios.facturas.registrarFactura({
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
      fecha: fechaEnPeriodoAbierto(),
      referencia: "FACT-0001",
      indicadorImpuestoCodigo: "IVA13",
      lineas: [{ operacion: "AP.GASTO_OPERACION", monto: "1000.00", centroCostoId: fx.centroCostoId }],
      creadoPor: USUARIO,
    });

    expect(factura.estado).toBe("contabilizado");
    expect(factura.lineas).toHaveLength(3);

    const lineaGasto = factura.lineas.find((l) => l.cuentaId === fx.cuentaGastoId)!;
    expect(lineaGasto.debe).toBe("1000.00");
    expect(lineaGasto.centroCostoId).toBe(fx.centroCostoId);

    const lineaIva = factura.lineas.find((l) => l.cuentaId === fx.cuentaIvaCreditoId)!;
    expect(lineaIva.debe).toBe("130.00");

    const lineaCxp = factura.lineas.find((l) => l.cuentaId === fx.cuentaCxpId)!;
    expect(lineaCxp.haber).toBe("1130.00");
    expect(lineaCxp.terceroId).toBe(fx.terceroId);
  });

  it("la partida de CxP nace abierta con vencimiento = fecha + condicion_pago_dias del tercero", async () => {
    const fecha = fechaEnPeriodoAbierto();
    const factura = await servicios.facturas.registrarFactura({
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
      fecha,
      referencia: "FACT-0002",
      lineas: [{ operacion: "AP.GASTO_OPERACION", monto: "200.00" }],
      creadoPor: USUARIO,
    });

    const lineaCxp = factura.lineas.find((l) => l.cuentaId === fx.cuentaCxpId)!;
    expect(lineaCxp.estadoPartida).toBe("abierta");
    const vencimientoEsperado = new Date(fecha);
    vencimientoEsperado.setUTCDate(vencimientoEsperado.getUTCDate() + 30);
    expect(lineaCxp.fechaVencimiento).toBe(vencimientoEsperado.toISOString().slice(0, 10));
  });

  it("sin indicador de impuesto no genera línea de IVA", async () => {
    const factura = await servicios.facturas.registrarFactura({
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
      fecha: fechaEnPeriodoAbierto(),
      referencia: "FACT-0003",
      lineas: [{ operacion: "AP.GASTO_OPERACION", monto: "50.00" }],
      creadoPor: USUARIO,
    });
    expect(factura.lineas).toHaveLength(2);
    const lineaCxp = factura.lineas.find((l) => l.cuentaId === fx.cuentaCxpId)!;
    expect(lineaCxp.haber).toBe("50.00");
  });

  it("rechaza un proveedor inactivo", async () => {
    await expect(
      servicios.facturas.registrarFactura({
        sociedadId: fx.sociedadId,
        terceroId: fx.terceroInactivoId,
        fecha: fechaEnPeriodoAbierto(),
        referencia: "FACT-0004",
        lineas: [{ operacion: "AP.GASTO_OPERACION", monto: "10.00" }],
        creadoPor: USUARIO,
      }),
    ).rejects.toBeInstanceOf(TerceroInactivoError);
  });

  it("rechaza una operación sin regla_determinacion_cuenta configurada", async () => {
    await expect(
      servicios.facturas.registrarFactura({
        sociedadId: fx.sociedadId,
        terceroId: fx.terceroId,
        fecha: fechaEnPeriodoAbierto(),
        referencia: "FACT-0005",
        lineas: [{ operacion: "AP.OPERACION_INEXISTENTE", monto: "10.00" }],
        creadoPor: USUARIO,
      }),
    ).rejects.toBeInstanceOf(ReglaDeterminacionNoEncontradaError);
  });

  it("rechaza un indicador de impuesto inexistente", async () => {
    await expect(
      servicios.facturas.registrarFactura({
        sociedadId: fx.sociedadId,
        terceroId: fx.terceroId,
        fecha: fechaEnPeriodoAbierto(),
        referencia: "FACT-0006",
        indicadorImpuestoCodigo: "NO_EXISTE",
        lineas: [{ operacion: "AP.GASTO_OPERACION", monto: "10.00" }],
        creadoPor: USUARIO,
      }),
    ).rejects.toBeInstanceOf(IndicadorImpuestoNoEncontradoError);
  });
});

describe("PagoService — compensación de partidas abiertas", () => {
  let fx: FixtureCxP;
  let servicios: ReturnType<typeof crearServicios>;

  beforeAll(async () => {
    fx = await crearFixtureCxP(testPool);
    servicios = crearServicios();
  });

  it("un pago parcial deja la partida abierta por el saldo restante", async () => {
    const factura = await servicios.facturas.registrarFactura({
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
      fecha: fechaEnPeriodoAbierto(),
      referencia: "FACT-PAGO-1",
      indicadorImpuestoCodigo: "IVA13",
      lineas: [{ operacion: "AP.GASTO_OPERACION", monto: "1000.00" }],
      creadoPor: USUARIO,
    });
    const lineaCxp = factura.lineas.find((l) => l.cuentaId === fx.cuentaCxpId)!;

    const resultadoPago = await servicios.pagos.registrarPago({
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
      fecha: fechaEnPeriodoAbierto(),
      aplicaciones: [{ lineaAbiertaId: lineaCxp.id, monto: "500.00" }],
      creadoPor: USUARIO,
    });

    expect(resultadoPago.documento.estado).toBe("contabilizado");
    const lineaBanco = resultadoPago.documento.lineas.find((l) => l.cuentaId === fx.cuentaBancoId)!;
    expect(lineaBanco.haber).toBe("500.00");
    const lineaCxpPago = resultadoPago.documento.lineas.find((l) => l.cuentaId === fx.cuentaCxpId)!;
    expect(lineaCxpPago.debe).toBe("500.00");
    expect(lineaCxpPago.compensadaPorId).toBe(lineaCxp.id);

    const partida = resultadoPago.partidas.find((p) => p.lineaId === lineaCxp.id)!;
    expect(partida.saldoAbierto).toBe("630.00");
    expect(partida.estadoPartida).toBe("abierta");
  });

  it("el segundo pago por el saldo restante compensa la partida por completo", async () => {
    const factura = await servicios.facturas.registrarFactura({
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
      fecha: fechaEnPeriodoAbierto(),
      referencia: "FACT-PAGO-2",
      indicadorImpuestoCodigo: "IVA13",
      lineas: [{ operacion: "AP.GASTO_OPERACION", monto: "1000.00" }],
      creadoPor: USUARIO,
    });
    const lineaCxp = factura.lineas.find((l) => l.cuentaId === fx.cuentaCxpId)!;

    await servicios.pagos.registrarPago({
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
      fecha: fechaEnPeriodoAbierto(),
      aplicaciones: [{ lineaAbiertaId: lineaCxp.id, monto: "500.00" }],
      creadoPor: USUARIO,
    });

    const segundoPago = await servicios.pagos.registrarPago({
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
      fecha: fechaEnPeriodoAbierto(),
      aplicaciones: [{ lineaAbiertaId: lineaCxp.id, monto: "630.00" }],
      creadoPor: USUARIO,
    });

    const partida = segundoPago.partidas.find((p) => p.lineaId === lineaCxp.id)!;
    expect(partida.saldoAbierto).toBe("0.00");
    expect(partida.estadoPartida).toBe("compensada");
  });

  it("rechaza una aplicación que excede el saldo abierto", async () => {
    const factura = await servicios.facturas.registrarFactura({
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
      fecha: fechaEnPeriodoAbierto(),
      referencia: "FACT-PAGO-3",
      lineas: [{ operacion: "AP.GASTO_OPERACION", monto: "100.00" }],
      creadoPor: USUARIO,
    });
    const lineaCxp = factura.lineas.find((l) => l.cuentaId === fx.cuentaCxpId)!;

    await expect(
      servicios.pagos.registrarPago({
        sociedadId: fx.sociedadId,
        terceroId: fx.terceroId,
        fecha: fechaEnPeriodoAbierto(),
        aplicaciones: [{ lineaAbiertaId: lineaCxp.id, monto: "999.00" }],
        creadoPor: USUARIO,
      }),
    ).rejects.toBeInstanceOf(MontoAplicacionExcedeSaldoError);
  });

  it("rechaza pagar una partida ya compensada", async () => {
    const factura = await servicios.facturas.registrarFactura({
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
      fecha: fechaEnPeriodoAbierto(),
      referencia: "FACT-PAGO-4",
      lineas: [{ operacion: "AP.GASTO_OPERACION", monto: "100.00" }],
      creadoPor: USUARIO,
    });
    const lineaCxp = factura.lineas.find((l) => l.cuentaId === fx.cuentaCxpId)!;

    await servicios.pagos.registrarPago({
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
      fecha: fechaEnPeriodoAbierto(),
      aplicaciones: [{ lineaAbiertaId: lineaCxp.id, monto: "100.00" }],
      creadoPor: USUARIO,
    });

    await expect(
      servicios.pagos.registrarPago({
        sociedadId: fx.sociedadId,
        terceroId: fx.terceroId,
        fecha: fechaEnPeriodoAbierto(),
        aplicaciones: [{ lineaAbiertaId: lineaCxp.id, monto: "1.00" }],
        creadoPor: USUARIO,
      }),
    ).rejects.toBeInstanceOf(PartidaYaCompensadaError);
  });
});

describe("NotaCreditoProveedorService", () => {
  let fx: FixtureCxP;
  let servicios: ReturnType<typeof crearServicios>;

  beforeAll(async () => {
    fx = await crearFixtureCxP(testPool);
    servicios = crearServicios();
  });

  it("reduce el saldo abierto de una factura", async () => {
    const factura = await servicios.facturas.registrarFactura({
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
      fecha: fechaEnPeriodoAbierto(),
      referencia: "FACT-NC-1",
      lineas: [{ operacion: "AP.GASTO_OPERACION", monto: "300.00" }],
      creadoPor: USUARIO,
    });
    const lineaCxp = factura.lineas.find((l) => l.cuentaId === fx.cuentaCxpId)!;

    const nc = await servicios.notasCredito.registrarNotaCredito({
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
      fecha: fechaEnPeriodoAbierto(),
      referencia: "NC-0001",
      lineaAbiertaId: lineaCxp.id,
      monto: "50.00",
      operacionContrapartida: "AP.NC_CONTRAPARTIDA",
      creadoPor: USUARIO,
    });

    expect(nc.estado).toBe("contabilizado");
    const lineaContrapartida = nc.lineas.find((l) => l.cuentaId === fx.cuentaContrapartidaNcId)!;
    expect(lineaContrapartida.haber).toBe("50.00");

    const [partida] = await partidasAbiertasPorProveedor(testPool, {
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
    }).then((partidas) => partidas.filter((p) => p.lineaId === lineaCxp.id));
    expect(partida!.saldoAbierto).toBe("250.00");
  });
});

describe("Reportes CxP", () => {
  let fx: FixtureCxP;
  let servicios: ReturnType<typeof crearServicios>;

  beforeAll(async () => {
    fx = await crearFixtureCxP(testPool);
    servicios = crearServicios();
  });

  it("partidasAbiertasPorProveedor solo lista partidas con saldo distinto de cero", async () => {
    const factura = await servicios.facturas.registrarFactura({
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
      fecha: fechaEnPeriodoAbierto(),
      referencia: "FACT-REP-1",
      lineas: [{ operacion: "AP.GASTO_OPERACION", monto: "400.00" }],
      creadoPor: USUARIO,
    });
    const lineaCxp = factura.lineas.find((l) => l.cuentaId === fx.cuentaCxpId)!;

    let partidas = await partidasAbiertasPorProveedor(testPool, {
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
    });
    expect(partidas.some((p) => p.lineaId === lineaCxp.id)).toBe(true);

    await servicios.pagos.registrarPago({
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
      fecha: fechaEnPeriodoAbierto(),
      aplicaciones: [{ lineaAbiertaId: lineaCxp.id, monto: "400.00" }],
      creadoPor: USUARIO,
    });

    partidas = await partidasAbiertasPorProveedor(testPool, {
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
    });
    expect(partidas.some((p) => p.lineaId === lineaCxp.id)).toBe(false);
  });

  it("antiguedadCxP agrupa el saldo del proveedor en buckets", async () => {
    await servicios.facturas.registrarFactura({
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
      fecha: fechaEnPeriodoAbierto(),
      referencia: "FACT-REP-2",
      lineas: [{ operacion: "AP.GASTO_OPERACION", monto: "150.00" }],
      creadoPor: USUARIO,
    });

    const antiguedad = await antiguedadCxP(testPool, { sociedadId: fx.sociedadId });
    const filaProveedor = antiguedad.find((a) => a.terceroId === fx.terceroId)!;
    expect(filaProveedor).toBeDefined();
    expect(Number(filaProveedor.total)).toBeGreaterThanOrEqual(150);
    const bucket030 = filaProveedor.buckets.find((b) => b.bucket === "0-30")!;
    expect(Number(bucket030.monto)).toBeGreaterThanOrEqual(150);
  });
});

describe("E2E — criterio exacto del plan (Fase 2)", () => {
  let fx: FixtureCxP;
  let servicios: ReturnType<typeof crearServicios>;

  beforeAll(async () => {
    fx = await crearFixtureCxP(testPool);
    servicios = crearServicios();
  });

  it("factura $1,130 (gasto $1,000 + IVA $130) → pago parcial $500 → partida abierta $630 → pago $630 → partida compensada, saldo del proveedor = 0", async () => {
    const factura = await servicios.facturas.registrarFactura({
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
      fecha: fechaEnPeriodoAbierto(),
      referencia: "FACT-E2E",
      indicadorImpuestoCodigo: "IVA13",
      lineas: [{ operacion: "AP.GASTO_OPERACION", monto: "1000.00", centroCostoId: fx.centroCostoId }],
      creadoPor: USUARIO,
    });
    const lineaCxp = factura.lineas.find((l) => l.cuentaId === fx.cuentaCxpId)!;
    expect(lineaCxp.haber).toBe("1130.00");

    const pago1 = await servicios.pagos.registrarPago({
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
      fecha: fechaEnPeriodoAbierto(),
      referencia: "Pago parcial 1",
      aplicaciones: [{ lineaAbiertaId: lineaCxp.id, monto: "500.00" }],
      creadoPor: USUARIO,
    });
    const partidaTrasPago1 = pago1.partidas.find((p) => p.lineaId === lineaCxp.id)!;
    expect(partidaTrasPago1.saldoAbierto).toBe("630.00");
    expect(partidaTrasPago1.estadoPartida).toBe("abierta");

    const pago2 = await servicios.pagos.registrarPago({
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
      fecha: fechaEnPeriodoAbierto(),
      referencia: "Pago final",
      aplicaciones: [{ lineaAbiertaId: lineaCxp.id, monto: "630.00" }],
      creadoPor: USUARIO,
    });
    const partidaTrasPago2 = pago2.partidas.find((p) => p.lineaId === lineaCxp.id)!;
    expect(partidaTrasPago2.saldoAbierto).toBe("0.00");
    expect(partidaTrasPago2.estadoPartida).toBe("compensada");

    const partidasAbiertas = await partidasAbiertasPorProveedor(testPool, {
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
    });
    const saldoProveedor = partidasAbiertas
      .filter((p) => p.terceroId === fx.terceroId)
      .reduce((acc, p) => acc + Number(p.saldoAbierto), 0);
    expect(saldoProveedor).toBe(0);
  });
});

describe("ContabilizacionService — validación de partidas abiertas (defensa en profundidad)", () => {
  let fx: FixtureCxP;

  beforeAll(async () => {
    fx = await crearFixtureCxP(testPool);
  });

  it("rechaza estado_partida en una cuenta sin gestion_partidas_abiertas", async () => {
    const contabilizacion = new ContabilizacionService(testPool);
    await expect(
      contabilizacion.crearBorrador({
        sociedadId: fx.sociedadId,
        tipoDocumentoId: fx.tipoDocumentoAsId,
        fechaDocumento: fechaEnPeriodoAbierto(),
        fechaContabilizacion: fechaEnPeriodoAbierto(),
        moneda: "USD",
        creadoPor: USUARIO,
        lineas: [
          { cuentaId: fx.cuentaGastoId, debe: "10.00", haber: "0", estadoPartidaInicial: "abierta" },
          { cuentaId: fx.cuentas.capital, debe: "0", haber: "10.00" },
        ],
      }),
    ).rejects.toBeInstanceOf(LineaInvalidaError);
  });
});
