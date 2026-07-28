import { afterAll, describe, expect, it } from "vitest";
import { testPool } from "../helpers/db.js";
import { crearFixtureCxP, type FixtureCxP } from "../helpers/fixturesCxp.js";
import { fechaEnPeriodoAbierto } from "../helpers/fixtures.js";
import { ContabilizacionService } from "../../src/nucleo/contabilizacion.service.js";
import { FacturaProveedorService } from "../../src/modulos/cxp/factura-proveedor.service.js";
import { PagoService } from "../../src/modulos/cxp/pago.service.js";
import { auxiliarProveedor, partidasAbiertasPorProveedor } from "../../src/modulos/cxp/reportes.js";

const USUARIO = "test-auxiliar@erp-financiero";

afterAll(async () => {
  await testPool.end();
});

function crearServicios() {
  const contabilizacion = new ContabilizacionService(testPool);
  return {
    facturas: new FacturaProveedorService(testPool, contabilizacion),
    pagos: new PagoService(testPool, contabilizacion),
  };
}

function rangoAnioCompleto(): { fechaDesde: string; fechaHasta: string } {
  const anio = new Date().getFullYear();
  return { fechaDesde: `${anio}-01-01`, fechaHasta: `${anio}-12-31` };
}

// Cada test crea su propio proveedor (crearFixtureCxP) para que el saldo del
// auxiliar y el de partidas abiertas se puedan comparar sin arrastrar
// movimientos de otros tests sobre el mismo tercero.

describe("auxiliarProveedor", () => {
  it("el saldo final coincide con la suma de partidas abiertas, con partida parcialmente pagada", async () => {
    const fx: FixtureCxP = await crearFixtureCxP(testPool);
    const servicios = crearServicios();

    const factura = await servicios.facturas.registrarFactura({
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
      fecha: fechaEnPeriodoAbierto(),
      referencia: "FACT-AUX-1",
      lineas: [{ operacion: "AP.GASTO_OPERACION", monto: "1000.00" }],
      creadoPor: USUARIO,
    });
    const lineaCxp = factura.lineas.find((l) => l.cuentaId === fx.cuentaCxpId)!;

    await servicios.pagos.registrarPago({
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
      fecha: fechaEnPeriodoAbierto(),
      aplicaciones: [{ lineaAbiertaId: lineaCxp.id, monto: "400.00" }],
      creadoPor: USUARIO,
    });

    const { fechaDesde, fechaHasta } = rangoAnioCompleto();
    const auxiliar = await auxiliarProveedor(testPool, {
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
      fechaDesde,
      fechaHasta,
    });
    const partidas = await partidasAbiertasPorProveedor(testPool, {
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
    });
    const saldoPorPartidas = partidas.reduce((acc, p) => acc + Number(p.saldoAbierto), 0);

    expect(Number(auxiliar.saldoFinal)).toBeCloseTo(saldoPorPartidas, 2);
    expect(Number(auxiliar.saldoFinal)).toBeCloseTo(600, 2);
  });

  it("una factura pagada por completo muestra el historial completo con saldo cero", async () => {
    const fx: FixtureCxP = await crearFixtureCxP(testPool);
    const servicios = crearServicios();

    const factura = await servicios.facturas.registrarFactura({
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
      fecha: fechaEnPeriodoAbierto(),
      referencia: "FACT-AUX-2",
      lineas: [{ operacion: "AP.GASTO_OPERACION", monto: "300.00" }],
      creadoPor: USUARIO,
    });
    const lineaCxp = factura.lineas.find((l) => l.cuentaId === fx.cuentaCxpId)!;

    await servicios.pagos.registrarPago({
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
      fecha: fechaEnPeriodoAbierto(),
      referencia: "PAGO-AUX-2",
      aplicaciones: [{ lineaAbiertaId: lineaCxp.id, monto: "300.00" }],
      creadoPor: USUARIO,
    });

    const { fechaDesde, fechaHasta } = rangoAnioCompleto();
    const auxiliar = await auxiliarProveedor(testPool, {
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
      fechaDesde,
      fechaHasta,
    });

    expect(auxiliar.movimientos).toHaveLength(2);

    const movFactura = auxiliar.movimientos.find((m) => m.tipoDocumento === "FP")!;
    expect(movFactura.referencia).toBe("FACT-AUX-2");
    expect(movFactura.abono).toBe("300.00");
    expect(movFactura.cargo).toBe("0.00");
    expect(movFactura.estadoPartida).toBe("compensada");

    const movPago = auxiliar.movimientos.find((m) => m.tipoDocumento === "PG")!;
    expect(movPago.cargo).toBe("300.00");
    expect(movPago.abono).toBe("0.00");
    expect(movPago.estadoPartida).toBeNull();

    expect(auxiliar.saldoFinal).toBe("0.00");

    const partidas = await partidasAbiertasPorProveedor(testPool, {
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
    });
    expect(partidas.some((p) => p.lineaId === lineaCxp.id)).toBe(false);
  });

  it("el saldo corriente se acumula movimiento a movimiento en orden cronológico", async () => {
    const fx: FixtureCxP = await crearFixtureCxP(testPool);
    const servicios = crearServicios();

    const facturaA = await servicios.facturas.registrarFactura({
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
      fecha: fechaEnPeriodoAbierto(),
      referencia: "FACT-AUX-3A",
      lineas: [{ operacion: "AP.GASTO_OPERACION", monto: "200.00" }],
      creadoPor: USUARIO,
    });
    await servicios.facturas.registrarFactura({
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
      fecha: fechaEnPeriodoAbierto(),
      referencia: "FACT-AUX-3B",
      lineas: [{ operacion: "AP.GASTO_OPERACION", monto: "50.00" }],
      creadoPor: USUARIO,
    });
    const lineaA = facturaA.lineas.find((l) => l.cuentaId === fx.cuentaCxpId)!;
    await servicios.pagos.registrarPago({
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
      fecha: fechaEnPeriodoAbierto(),
      aplicaciones: [{ lineaAbiertaId: lineaA.id, monto: "120.00" }],
      creadoPor: USUARIO,
    });

    const { fechaDesde, fechaHasta } = rangoAnioCompleto();
    const auxiliar = await auxiliarProveedor(testPool, {
      sociedadId: fx.sociedadId,
      terceroId: fx.terceroId,
      fechaDesde,
      fechaHasta,
    });

    expect(auxiliar.movimientos.map((m) => Number(m.saldoAcumulado))).toEqual([200, 250, 130]);
  });
});
