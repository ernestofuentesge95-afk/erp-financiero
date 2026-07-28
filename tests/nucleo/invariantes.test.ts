import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testPool } from "../helpers/db.js";
import { crearFixture, fechaEnPeriodoAbierto, type Fixture } from "../helpers/fixtures.js";
import { ContabilizacionService } from "../../src/nucleo/contabilizacion.service.js";
import {
  DocumentoDescuadradoError,
  LineaInvalidaError,
  PeriodoCerradoError,
} from "../../src/nucleo/errores.js";
import { balanceDeComprobacion } from "../../src/nucleo/reportes.js";

const USUARIO = "test@erp-financiero";

afterAll(async () => {
  await testPool.end();
});

/**
 * Los 9 invariantes de docs/01-modelo-datos-nucleo.md §7. Cada describe lleva
 * el número del invariante en el título para trazabilidad directa con el doc.
 */

describe("Invariante 1 — Partida doble (Σ debe_ml = Σ haber_ml)", () => {
  let fx: Fixture;
  let service: ContabilizacionService;

  beforeAll(async () => {
    fx = await crearFixture(testPool);
    service = new ContabilizacionService(testPool);
  });

  it("el servicio rechaza contabilizar un documento descuadrado", async () => {
    const borrador = await service.crearBorrador({
      sociedadId: fx.sociedadId,
      tipoDocumentoId: fx.tipoDocumentoAsId,
      fechaDocumento: fechaEnPeriodoAbierto(),
      fechaContabilizacion: fechaEnPeriodoAbierto(),
      moneda: "USD",
      creadoPor: USUARIO,
      lineas: [
        { cuentaId: fx.cuentas.caja, debe: "100.00", haber: "0" },
        { cuentaId: fx.cuentas.capital, debe: "0", haber: "90.00" },
      ],
    });

    await expect(service.contabilizar(borrador.id, USUARIO)).rejects.toBeInstanceOf(
      DocumentoDescuadradoError,
    );
  });

  it("la BD rechaza un UPDATE directo que intenta contabilizar un documento descuadrado", async () => {
    const borrador = await service.crearBorrador({
      sociedadId: fx.sociedadId,
      tipoDocumentoId: fx.tipoDocumentoAsId,
      fechaDocumento: fechaEnPeriodoAbierto(),
      fechaContabilizacion: fechaEnPeriodoAbierto(),
      moneda: "USD",
      creadoPor: USUARIO,
      lineas: [
        { cuentaId: fx.cuentas.caja, debe: "50.00", haber: "0" },
        { cuentaId: fx.cuentas.capital, debe: "0", haber: "40.00" },
      ],
    });

    await expect(
      testPool.query(
        `UPDATE documento SET estado = 'contabilizado', numero = 999999,
           periodo_id = $2, ejercicio_id = $3
         WHERE id = $1`,
        [borrador.id, fx.periodoAbiertoId, fx.ejercicioId],
      ),
    ).rejects.toThrow();
  });
});

describe("Invariante 2 — Período abierto", () => {
  let fx: Fixture;
  let service: ContabilizacionService;

  beforeAll(async () => {
    fx = await crearFixture(testPool);
    service = new ContabilizacionService(testPool);
  });

  it("el servicio rechaza contabilizar en un período cerrado", async () => {
    const periodo = await testPool.query<{ fecha_inicio: string }>(
      `SELECT fecha_inicio FROM periodo_contable WHERE id = $1`,
      [fx.periodoCerradoId],
    );
    const fechaEnPeriodoCerrado = periodo.rows[0]!.fecha_inicio;

    const borrador = await service.crearBorrador({
      sociedadId: fx.sociedadId,
      tipoDocumentoId: fx.tipoDocumentoAsId,
      fechaDocumento: fechaEnPeriodoCerrado,
      fechaContabilizacion: fechaEnPeriodoCerrado,
      moneda: "USD",
      creadoPor: USUARIO,
      lineas: [
        { cuentaId: fx.cuentas.caja, debe: "10.00", haber: "0" },
        { cuentaId: fx.cuentas.capital, debe: "0", haber: "10.00" },
      ],
    });

    await expect(service.contabilizar(borrador.id, USUARIO)).rejects.toBeInstanceOf(
      PeriodoCerradoError,
    );
  });
});

describe("Invariante 3 — Inmutabilidad (documento contabilizado)", () => {
  let fx: Fixture;
  let service: ContabilizacionService;

  beforeAll(async () => {
    fx = await crearFixture(testPool);
    service = new ContabilizacionService(testPool);
  });

  it("la BD rechaza un UPDATE directo a un documento contabilizado", async () => {
    const borrador = await service.crearBorrador({
      sociedadId: fx.sociedadId,
      tipoDocumentoId: fx.tipoDocumentoAsId,
      fechaDocumento: fechaEnPeriodoAbierto(),
      fechaContabilizacion: fechaEnPeriodoAbierto(),
      moneda: "USD",
      creadoPor: USUARIO,
      lineas: [
        { cuentaId: fx.cuentas.caja, debe: "25.00", haber: "0" },
        { cuentaId: fx.cuentas.capital, debe: "0", haber: "25.00" },
      ],
    });
    const contabilizado = await service.contabilizar(borrador.id, USUARIO);
    expect(contabilizado.estado).toBe("contabilizado");

    await expect(
      testPool.query(`UPDATE documento SET descripcion = 'hackeado' WHERE id = $1`, [
        contabilizado.id,
      ]),
    ).rejects.toThrow();
  });

  it("la BD rechaza un DELETE directo a un documento contabilizado", async () => {
    const borrador = await service.crearBorrador({
      sociedadId: fx.sociedadId,
      tipoDocumentoId: fx.tipoDocumentoAsId,
      fechaDocumento: fechaEnPeriodoAbierto(),
      fechaContabilizacion: fechaEnPeriodoAbierto(),
      moneda: "USD",
      creadoPor: USUARIO,
      lineas: [
        { cuentaId: fx.cuentas.caja, debe: "5.00", haber: "0" },
        { cuentaId: fx.cuentas.capital, debe: "0", haber: "5.00" },
      ],
    });
    const contabilizado = await service.contabilizar(borrador.id, USUARIO);

    await expect(
      testPool.query(`DELETE FROM documento WHERE id = $1`, [contabilizado.id]),
    ).rejects.toThrow();
  });

  it("un documento en borrador sí puede eliminarse", async () => {
    const borrador = await service.crearBorrador({
      sociedadId: fx.sociedadId,
      tipoDocumentoId: fx.tipoDocumentoAsId,
      fechaDocumento: fechaEnPeriodoAbierto(),
      fechaContabilizacion: fechaEnPeriodoAbierto(),
      moneda: "USD",
      creadoPor: USUARIO,
      lineas: [
        { cuentaId: fx.cuentas.caja, debe: "5.00", haber: "0" },
        { cuentaId: fx.cuentas.capital, debe: "0", haber: "5.00" },
      ],
    });

    await expect(
      testPool.query(`DELETE FROM documento WHERE id = $1`, [borrador.id]),
    ).resolves.not.toThrow();
  });
});

describe("Invariante 4 — Storno exacto", () => {
  let fx: Fixture;
  let service: ContabilizacionService;

  beforeAll(async () => {
    fx = await crearFixture(testPool);
    service = new ContabilizacionService(testPool);
  });

  it("produce líneas espejo exactas, vincula ambos documentos y el efecto neto es cero", async () => {
    const borrador = await service.crearBorrador({
      sociedadId: fx.sociedadId,
      tipoDocumentoId: fx.tipoDocumentoAsId,
      fechaDocumento: fechaEnPeriodoAbierto(),
      fechaContabilizacion: fechaEnPeriodoAbierto(),
      moneda: "USD",
      creadoPor: USUARIO,
      lineas: [
        { cuentaId: fx.cuentas.caja, debe: "200.00", haber: "0" },
        { cuentaId: fx.cuentas.ventas, debe: "0", haber: "200.00" },
      ],
    });
    const original = await service.contabilizar(borrador.id, USUARIO);

    const storno = await service.stornar(original.id, "Prueba de storno", USUARIO);

    expect(storno.documentoOrigenId).toBe(original.id);
    expect(storno.estado).toBe("contabilizado");
    expect(storno.lineas).toHaveLength(2);

    const lineaCajaOriginal = original.lineas.find((l) => l.cuentaId === fx.cuentas.caja)!;
    const lineaCajaStorno = storno.lineas.find((l) => l.cuentaId === fx.cuentas.caja)!;
    expect(lineaCajaStorno.debe).toBe("0.00");
    expect(lineaCajaStorno.haber).toBe(lineaCajaOriginal.debe);

    const lineaVentasOriginal = original.lineas.find((l) => l.cuentaId === fx.cuentas.ventas)!;
    const lineaVentasStorno = storno.lineas.find((l) => l.cuentaId === fx.cuentas.ventas)!;
    expect(lineaVentasStorno.haber).toBe("0.00");
    expect(lineaVentasStorno.debe).toBe(lineaVentasOriginal.haber);

    const originalActualizado = await service.obtener(original.id);
    expect(originalActualizado?.estado).toBe("anulado");

    const efectoNeto = await testPool.query<{ neto: string }>(
      `SELECT COALESCE(SUM(debe_ml) - SUM(haber_ml), 0) AS neto
       FROM linea_documento ld
       JOIN documento d ON d.id = ld.documento_id
       WHERE d.estado IN ('contabilizado', 'anulado') AND ld.cuenta_id = $1`,
      [fx.cuentas.caja],
    );
    expect(Number(efectoNeto.rows[0]!.neto)).toBe(0);
  });
});

describe("Invariante 5 — Cuentas imputables", () => {
  let fx: Fixture;
  let service: ContabilizacionService;

  beforeAll(async () => {
    fx = await crearFixture(testPool);
    service = new ContabilizacionService(testPool);
  });

  it("el servicio rechaza una línea contra una cuenta de agrupación (permite_movimientos=false)", async () => {
    await expect(
      service.crearBorrador({
        sociedadId: fx.sociedadId,
        tipoDocumentoId: fx.tipoDocumentoAsId,
        fechaDocumento: fechaEnPeriodoAbierto(),
        fechaContabilizacion: fechaEnPeriodoAbierto(),
        moneda: "USD",
        creadoPor: USUARIO,
        lineas: [
          { cuentaId: fx.cuentas.grupoActivo, debe: "10.00", haber: "0" },
          { cuentaId: fx.cuentas.capital, debe: "0", haber: "10.00" },
        ],
      }),
    ).rejects.toBeInstanceOf(LineaInvalidaError);
  });

  it("el servicio rechaza una línea contra una cuenta inactiva", async () => {
    await expect(
      service.crearBorrador({
        sociedadId: fx.sociedadId,
        tipoDocumentoId: fx.tipoDocumentoAsId,
        fechaDocumento: fechaEnPeriodoAbierto(),
        fechaContabilizacion: fechaEnPeriodoAbierto(),
        moneda: "USD",
        creadoPor: USUARIO,
        lineas: [
          { cuentaId: fx.cuentas.inactiva, debe: "10.00", haber: "0" },
          { cuentaId: fx.cuentas.capital, debe: "0", haber: "10.00" },
        ],
      }),
    ).rejects.toBeInstanceOf(LineaInvalidaError);
  });

  it("la BD rechaza un INSERT directo de línea contra una cuenta de agrupación", async () => {
    const borrador = await service.crearBorrador({
      sociedadId: fx.sociedadId,
      tipoDocumentoId: fx.tipoDocumentoAsId,
      fechaDocumento: fechaEnPeriodoAbierto(),
      fechaContabilizacion: fechaEnPeriodoAbierto(),
      moneda: "USD",
      creadoPor: USUARIO,
      lineas: [
        { cuentaId: fx.cuentas.caja, debe: "10.00", haber: "0" },
        { cuentaId: fx.cuentas.capital, debe: "0", haber: "10.00" },
      ],
    });

    await expect(
      testPool.query(
        `INSERT INTO linea_documento (documento_id, numero_linea, cuenta_id, debe, haber, debe_ml, haber_ml)
         VALUES ($1, 999, $2, 5.00, 0, 5.00, 0)`,
        [borrador.id, fx.cuentas.grupoActivo],
      ),
    ).rejects.toThrow();
  });
});

describe("Invariante 6 — Campos obligatorios condicionales (tercero / centro de costo)", () => {
  let fx: Fixture;
  let service: ContabilizacionService;

  beforeAll(async () => {
    fx = await crearFixture(testPool);
    service = new ContabilizacionService(testPool);
  });

  it("el servicio rechaza una línea sin tercero cuando la cuenta lo requiere", async () => {
    await expect(
      service.crearBorrador({
        sociedadId: fx.sociedadId,
        tipoDocumentoId: fx.tipoDocumentoAsId,
        fechaDocumento: fechaEnPeriodoAbierto(),
        fechaContabilizacion: fechaEnPeriodoAbierto(),
        moneda: "USD",
        creadoPor: USUARIO,
        lineas: [
          { cuentaId: fx.cuentas.requiereTercero, debe: "10.00", haber: "0" },
          { cuentaId: fx.cuentas.ventas, debe: "0", haber: "10.00" },
        ],
      }),
    ).rejects.toBeInstanceOf(LineaInvalidaError);
  });

  it("acepta la línea cuando sí trae tercero_id", async () => {
    const borrador = await service.crearBorrador({
      sociedadId: fx.sociedadId,
      tipoDocumentoId: fx.tipoDocumentoAsId,
      fechaDocumento: fechaEnPeriodoAbierto(),
      fechaContabilizacion: fechaEnPeriodoAbierto(),
      moneda: "USD",
      creadoPor: USUARIO,
      lineas: [
        { cuentaId: fx.cuentas.requiereTercero, debe: "10.00", haber: "0", terceroId: "1" },
        { cuentaId: fx.cuentas.ventas, debe: "0", haber: "10.00" },
      ],
    });
    expect(borrador.lineas).toHaveLength(2);
  });
});

describe("Invariante 7 — Numeración correlativa sin huecos", () => {
  let fx: Fixture;
  let service: ContabilizacionService;

  beforeAll(async () => {
    fx = await crearFixture(testPool);
    service = new ContabilizacionService(testPool);
  });

  it("asigna números consecutivos y un intento fallido no consume número", async () => {
    const crear = () =>
      service.crearBorrador({
        sociedadId: fx.sociedadId,
        tipoDocumentoId: fx.tipoDocumentoAsId,
        fechaDocumento: fechaEnPeriodoAbierto(),
        fechaContabilizacion: fechaEnPeriodoAbierto(),
        moneda: "USD",
        creadoPor: USUARIO,
        lineas: [
          { cuentaId: fx.cuentas.caja, debe: "1.00", haber: "0" },
          { cuentaId: fx.cuentas.capital, debe: "0", haber: "1.00" },
        ],
      });

    const doc1 = await service.contabilizar((await crear()).id, USUARIO);

    const borradorDescuadrado = await service.crearBorrador({
      sociedadId: fx.sociedadId,
      tipoDocumentoId: fx.tipoDocumentoAsId,
      fechaDocumento: fechaEnPeriodoAbierto(),
      fechaContabilizacion: fechaEnPeriodoAbierto(),
      moneda: "USD",
      creadoPor: USUARIO,
      lineas: [
        { cuentaId: fx.cuentas.caja, debe: "1.00", haber: "0" },
        { cuentaId: fx.cuentas.capital, debe: "0", haber: "2.00" },
      ],
    });
    await expect(service.contabilizar(borradorDescuadrado.id, USUARIO)).rejects.toThrow();

    const doc2 = await service.contabilizar((await crear()).id, USUARIO);
    const doc3 = await service.contabilizar((await crear()).id, USUARIO);

    expect(Number(doc2.numero)).toBe(Number(doc1.numero) + 1);
    expect(Number(doc3.numero)).toBe(Number(doc2.numero) + 1);
  });
});

describe("Invariante 8 — Saldos derivados (no hay tabla de saldos como fuente de verdad)", () => {
  let fx: Fixture;
  let service: ContabilizacionService;

  beforeAll(async () => {
    fx = await crearFixture(testPool);
    service = new ContabilizacionService(testPool);
  });

  it("no existe ninguna tabla que almacene saldos de cuenta", async () => {
    const result = await testPool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name ILIKE '%saldo%'`,
    );
    expect(result.rows).toHaveLength(0);
  });

  it("el balance de comprobación refleja los documentos contabilizados sin caché intermedia", async () => {
    const fecha = fechaEnPeriodoAbierto();
    const antes = await balanceDeComprobacion(testPool, {
      sociedadId: fx.sociedadId,
      fechaDesde: fecha,
      fechaHasta: fecha,
    });
    const saldoCajaAntes =
      antes.find((s) => s.cuentaId === fx.cuentas.caja)?.saldo ?? "0.00";

    const borrador = await service.crearBorrador({
      sociedadId: fx.sociedadId,
      tipoDocumentoId: fx.tipoDocumentoAsId,
      fechaDocumento: fecha,
      fechaContabilizacion: fecha,
      moneda: "USD",
      creadoPor: USUARIO,
      lineas: [
        { cuentaId: fx.cuentas.caja, debe: "77.00", haber: "0" },
        { cuentaId: fx.cuentas.capital, debe: "0", haber: "77.00" },
      ],
    });
    await service.contabilizar(borrador.id, USUARIO);

    const despues = await balanceDeComprobacion(testPool, {
      sociedadId: fx.sociedadId,
      fechaDesde: fecha,
      fechaHasta: fecha,
    });
    const saldoCajaDespues = despues.find((s) => s.cuentaId === fx.cuentas.caja)!.saldo;

    expect(Number(saldoCajaDespues) - Number(saldoCajaAntes)).toBeCloseTo(77, 2);
  });
});

describe("Invariante 9 — Punto único de escritura (solo ContabilizacionService)", () => {
  let fx: Fixture;

  beforeAll(async () => {
    fx = await crearFixture(testPool);
  });

  it("la BD rechaza un INSERT directo de un documento que nace contabilizado", async () => {
    await expect(
      testPool.query(
        `INSERT INTO documento (
           sociedad_id, tipo_documento_id, fecha_documento, fecha_contabilizacion,
           moneda, estado, created_by
         ) VALUES ($1, $2, $3, $3, 'USD', 'contabilizado', $4)`,
        [fx.sociedadId, fx.tipoDocumentoAsId, fechaEnPeriodoAbierto(), USUARIO],
      ),
    ).rejects.toThrow();
  });

  it("la BD rechaza un INSERT directo de línea contra un documento ya contabilizado", async () => {
    const service = new ContabilizacionService(testPool);
    const borrador = await service.crearBorrador({
      sociedadId: fx.sociedadId,
      tipoDocumentoId: fx.tipoDocumentoAsId,
      fechaDocumento: fechaEnPeriodoAbierto(),
      fechaContabilizacion: fechaEnPeriodoAbierto(),
      moneda: "USD",
      creadoPor: USUARIO,
      lineas: [
        { cuentaId: fx.cuentas.caja, debe: "10.00", haber: "0" },
        { cuentaId: fx.cuentas.capital, debe: "0", haber: "10.00" },
      ],
    });
    const contabilizado = await service.contabilizar(borrador.id, USUARIO);

    await expect(
      testPool.query(
        `INSERT INTO linea_documento (documento_id, numero_linea, cuenta_id, debe, haber, debe_ml, haber_ml)
         VALUES ($1, 999, $2, 1.00, 0, 1.00, 0)`,
        [contabilizado.id, fx.cuentas.caja],
      ),
    ).rejects.toThrow();
  });
});

describe("E2E — asiento manual de 3 líneas: crear, contabilizar, stornar", () => {
  let fx: Fixture;
  let service: ContabilizacionService;

  beforeAll(async () => {
    fx = await crearFixture(testPool);
    service = new ContabilizacionService(testPool);
  });

  it("crea, contabiliza, cuadra el balance, storna y el balance vuelve al estado previo", async () => {
    const fecha = fechaEnPeriodoAbierto();

    const balanceInicial = await balanceDeComprobacion(testPool, {
      sociedadId: fx.sociedadId,
      fechaDesde: fecha,
      fechaHasta: fecha,
    });
    const totalDebeInicial = balanceInicial.reduce((acc, s) => acc + Number(s.debe), 0);

    const borrador = await service.crearBorrador({
      sociedadId: fx.sociedadId,
      tipoDocumentoId: fx.tipoDocumentoAsId,
      fechaDocumento: fecha,
      fechaContabilizacion: fecha,
      moneda: "USD",
      descripcion: "Compra de mercadería al contado con gasto de flete",
      creadoPor: USUARIO,
      lineas: [
        { cuentaId: fx.cuentas.gastoOperacion, debe: "150.00", haber: "0" },
        { cuentaId: fx.cuentas.ventas, debe: "0", haber: "100.00" },
        { cuentaId: fx.cuentas.caja, debe: "0", haber: "50.00" },
      ],
    });
    expect(borrador.estado).toBe("borrador");
    expect(borrador.numero).toBeNull();

    const contabilizado = await service.contabilizar(borrador.id, USUARIO);
    expect(contabilizado.estado).toBe("contabilizado");
    expect(contabilizado.numero).not.toBeNull();
    expect(contabilizado.periodoId).toBe(fx.periodoAbiertoId);

    const balanceContabilizado = await balanceDeComprobacion(testPool, {
      sociedadId: fx.sociedadId,
      fechaDesde: fecha,
      fechaHasta: fecha,
    });
    const totalDebe = balanceContabilizado.reduce((acc, s) => acc + Number(s.debe), 0);
    const totalHaber = balanceContabilizado.reduce((acc, s) => acc + Number(s.haber), 0);
    expect(totalDebe).toBeCloseTo(totalHaber, 2);
    expect(totalDebe - totalDebeInicial).toBeCloseTo(150, 2);

    const storno = await service.stornar(contabilizado.id, "Reversa de prueba e2e", USUARIO);
    expect(storno.lineas).toHaveLength(3);

    const balanceFinal = await balanceDeComprobacion(testPool, {
      sociedadId: fx.sociedadId,
      fechaDesde: fecha,
      fechaHasta: fecha,
    });
    const totalDebeFinal = balanceFinal.reduce((acc, s) => acc + Number(s.debe), 0);
    expect(totalDebeFinal - totalDebeInicial).toBeCloseTo(300, 2);

    const saldoGastoFinal = balanceFinal.find(
      (s) => s.cuentaId === fx.cuentas.gastoOperacion,
    )!.saldo;
    expect(Number(saldoGastoFinal)).toBeCloseTo(0, 2);
    const saldoVentasFinal = balanceFinal.find((s) => s.cuentaId === fx.cuentas.ventas)!.saldo;
    expect(Number(saldoVentasFinal)).toBeCloseTo(0, 2);
    const saldoCajaFinal = balanceFinal.find((s) => s.cuentaId === fx.cuentas.caja)!.saldo;
    expect(Number(saldoCajaFinal)).toBeCloseTo(0, 2);
  });
});
