import type { Pool, PoolClient } from "pg";
import { DomainError } from "../errors.js";
import { aMonto, formatearMonto, formatearTipoCambio, sumar } from "./dinero.js";
import {
  DocumentoDescuadradoError,
  DocumentoNoEncontradoError,
  EstadoInvalidoError,
  LineaInvalidaError,
  PartidaNoEncontradaError,
  PeriodoCerradoError,
  PeriodoNoEncontradoError,
} from "./errores.js";
import { obtenerPartida } from "./partidas.js";
import type {
  CrearBorradorInput,
  Documento,
  EstadoDocumento,
  EstadoPartida,
  LineaDocumento,
  LineaInput,
} from "./tipos.js";

interface DocumentoRow {
  id: string;
  sociedad_id: string;
  tipo_documento_id: string;
  numero: string | null;
  ejercicio_id: string | null;
  fecha_documento: string;
  fecha_contabilizacion: string;
  periodo_id: string | null;
  moneda: string;
  tipo_cambio: string;
  referencia: string | null;
  descripcion: string | null;
  estado: EstadoDocumento;
  documento_origen_id: string | null;
  modulo_origen: string;
  created_by: string;
  created_at: string;
  contabilizado_por: string | null;
  contabilizado_at: string | null;
}

interface LineaRow {
  id: string;
  documento_id: string;
  numero_linea: number;
  cuenta_id: string;
  debe: string;
  haber: string;
  debe_ml: string;
  haber_ml: string;
  tercero_id: string | null;
  centro_costo_id: string | null;
  descripcion: string | null;
  fecha_vencimiento: string | null;
  compensada_por_id: string | null;
  estado_partida: EstadoPartida | null;
}

interface CuentaRow {
  id: string;
  permite_movimientos: boolean;
  activa: boolean;
  requiere_tercero: boolean;
  requiere_centro_costo: boolean;
  gestion_partidas_abiertas: boolean;
}

function mapLinea(row: LineaRow): LineaDocumento {
  return {
    id: row.id,
    documentoId: row.documento_id,
    numeroLinea: row.numero_linea,
    cuentaId: row.cuenta_id,
    debe: row.debe,
    haber: row.haber,
    debeMl: row.debe_ml,
    haberMl: row.haber_ml,
    terceroId: row.tercero_id,
    centroCostoId: row.centro_costo_id,
    descripcion: row.descripcion,
    fechaVencimiento: row.fecha_vencimiento,
    compensadaPorId: row.compensada_por_id,
    estadoPartida: row.estado_partida,
  };
}

function mapDocumento(row: DocumentoRow, lineas: LineaDocumento[]): Documento {
  return {
    id: row.id,
    sociedadId: row.sociedad_id,
    tipoDocumentoId: row.tipo_documento_id,
    numero: row.numero,
    ejercicioId: row.ejercicio_id,
    fechaDocumento: row.fecha_documento,
    fechaContabilizacion: row.fecha_contabilizacion,
    periodoId: row.periodo_id,
    moneda: row.moneda,
    tipoCambio: row.tipo_cambio,
    referencia: row.referencia,
    descripcion: row.descripcion,
    estado: row.estado,
    documentoOrigenId: row.documento_origen_id,
    moduloOrigen: row.modulo_origen,
    createdBy: row.created_by,
    createdAt: row.created_at,
    contabilizadoPor: row.contabilizado_por,
    contabilizadoAt: row.contabilizado_at,
    lineas,
  };
}

function validarLineasEstructura(lineas: LineaInput[]): void {
  if (lineas.length < 2) {
    throw new LineaInvalidaError("Un documento debe tener al menos 2 líneas.");
  }
  lineas.forEach((linea, index) => {
    const debe = aMonto(linea.debe);
    const haber = aMonto(linea.haber);
    if (debe.isNegative() || haber.isNegative()) {
      throw new LineaInvalidaError(
        `Línea ${index + 1}: debe y haber deben ser mayores o iguales a cero.`,
      );
    }
    if (debe.greaterThan(0) === haber.greaterThan(0)) {
      throw new LineaInvalidaError(
        `Línea ${index + 1}: exactamente uno de debe/haber debe ser mayor a cero.`,
      );
    }
  });
}

async function validarCuentas(client: PoolClient, lineas: LineaInput[]): Promise<void> {
  const ids = [...new Set(lineas.map((l) => l.cuentaId))];
  const result = await client.query<CuentaRow>(
    `SELECT id, permite_movimientos, activa, requiere_tercero, requiere_centro_costo, gestion_partidas_abiertas
     FROM cuenta WHERE id = ANY($1::bigint[])`,
    [ids],
  );
  const cuentasPorId = new Map(result.rows.map((row) => [row.id, row]));

  lineas.forEach((linea, index) => {
    const cuenta = cuentasPorId.get(linea.cuentaId);
    if (!cuenta) {
      throw new LineaInvalidaError(`Línea ${index + 1}: la cuenta ${linea.cuentaId} no existe.`);
    }
    if (!cuenta.permite_movimientos) {
      throw new LineaInvalidaError(
        `Línea ${index + 1}: la cuenta ${linea.cuentaId} no permite movimientos (es una cuenta de agrupación).`,
      );
    }
    if (!cuenta.activa) {
      throw new LineaInvalidaError(`Línea ${index + 1}: la cuenta ${linea.cuentaId} está inactiva.`);
    }
    if (cuenta.requiere_tercero && !linea.terceroId) {
      throw new LineaInvalidaError(
        `Línea ${index + 1}: la cuenta ${linea.cuentaId} requiere tercero_id.`,
      );
    }
    if (cuenta.requiere_centro_costo && !linea.centroCostoId) {
      throw new LineaInvalidaError(
        `Línea ${index + 1}: la cuenta ${linea.cuentaId} requiere centro_costo_id.`,
      );
    }
    const usaPartidasAbiertas =
      linea.estadoPartidaInicial !== undefined ||
      linea.compensadaPorId !== undefined ||
      linea.fechaVencimiento !== undefined;
    if (usaPartidasAbiertas && !cuenta.gestion_partidas_abiertas) {
      throw new LineaInvalidaError(
        `Línea ${index + 1}: la cuenta ${linea.cuentaId} no gestiona partidas abiertas.`,
      );
    }
    if (linea.estadoPartidaInicial !== undefined && linea.compensadaPorId !== undefined) {
      throw new LineaInvalidaError(
        `Línea ${index + 1}: una línea no puede ser origen y compensación de partida a la vez.`,
      );
    }
  });
}

/**
 * Determina el período contable abierto que cubre `fecha` para `sociedadId`.
 * Solo mira períodos 1-12: el período 13 (ajustes de cierre) se asigna
 * explícitamente en el proceso de cierre (Fase 6), nunca por fecha.
 */
async function buscarPeriodoAbierto(
  client: PoolClient,
  sociedadId: string,
  fecha: string,
): Promise<{ periodoId: string; ejercicioId: string }> {
  const result = await client.query<{
    periodo_id: string;
    periodo_estado: string;
    ejercicio_id: string;
  }>(
    `SELECT pc.id AS periodo_id, pc.estado AS periodo_estado, pc.ejercicio_id
     FROM periodo_contable pc
     JOIN ejercicio_fiscal ej ON ej.id = pc.ejercicio_id
     WHERE ej.sociedad_id = $1
       AND pc.numero BETWEEN 1 AND 12
       AND $2::date BETWEEN pc.fecha_inicio AND pc.fecha_fin
     LIMIT 1`,
    [sociedadId, fecha],
  );

  if (result.rowCount === 0) {
    throw new PeriodoNoEncontradoError(fecha);
  }
  const row = result.rows[0]!;
  if (row.periodo_estado !== "abierto") {
    throw new PeriodoCerradoError(row.periodo_id);
  }
  return { periodoId: row.periodo_id, ejercicioId: row.ejercicio_id };
}

/** Numeración correlativa sin huecos: el UPDATE bloquea la fila hasta commit/rollback. */
async function asignarNumero(
  client: PoolClient,
  sociedadId: string,
  tipoDocumentoId: string,
  ejercicioId: string,
): Promise<string> {
  await client.query(
    `INSERT INTO secuencia_documento (sociedad_id, tipo_documento_id, ejercicio_id, ultimo_numero)
     VALUES ($1, $2, $3, 0)
     ON CONFLICT (sociedad_id, tipo_documento_id, ejercicio_id) DO NOTHING`,
    [sociedadId, tipoDocumentoId, ejercicioId],
  );
  const result = await client.query<{ ultimo_numero: string }>(
    `UPDATE secuencia_documento SET ultimo_numero = ultimo_numero + 1
     WHERE sociedad_id = $1 AND tipo_documento_id = $2 AND ejercicio_id = $3
     RETURNING ultimo_numero`,
    [sociedadId, tipoDocumentoId, ejercicioId],
  );
  return result.rows[0]!.ultimo_numero;
}

async function registrarAuditoria(
  client: PoolClient,
  usuario: string,
  accion: string,
  entidad: string,
  entidadId: string,
  snapshot: unknown,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log (usuario, accion, entidad, entidad_id, snapshot) VALUES ($1, $2, $3, $4, $5)`,
    [usuario, accion, entidad, entidadId, JSON.stringify(snapshot)],
  );
}

/**
 * Único punto de escritura al ledger (invariante 9). Ningún otro módulo debe
 * insertar en `documento` / `linea_documento`; la BD lo refuerza con
 * triggers (fn_documento_before_write / fn_linea_documento_before_write),
 * este servicio con las validaciones tipadas de negocio.
 */
export class ContabilizacionService {
  constructor(private readonly pool: Pool) {}

  async crearBorrador(input: CrearBorradorInput): Promise<Documento> {
    validarLineasEstructura(input.lineas);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await validarCuentas(client, input.lineas);

      const tipoCambio = formatearTipoCambio(input.tipoCambio ?? "1");

      const docResult = await client.query<DocumentoRow>(
        `INSERT INTO documento (
           sociedad_id, tipo_documento_id, fecha_documento, fecha_contabilizacion,
           moneda, tipo_cambio, referencia, descripcion, documento_origen_id,
           modulo_origen, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING *`,
        [
          input.sociedadId,
          input.tipoDocumentoId,
          input.fechaDocumento,
          input.fechaContabilizacion,
          input.moneda,
          tipoCambio,
          input.referencia ?? null,
          input.descripcion ?? null,
          input.documentoOrigenId ?? null,
          input.moduloOrigen ?? "GL",
          input.creadoPor,
        ],
      );
      const documentoRow = docResult.rows[0]!;

      const lineas: LineaDocumento[] = [];
      for (const [index, linea] of input.lineas.entries()) {
        const debe = formatearMonto(linea.debe);
        const haber = formatearMonto(linea.haber);
        const debeMl = formatearMonto(aMonto(linea.debe).times(tipoCambio));
        const haberMl = formatearMonto(aMonto(linea.haber).times(tipoCambio));

        const lineaResult = await client.query<LineaRow>(
          `INSERT INTO linea_documento (
             documento_id, numero_linea, cuenta_id, debe, haber, debe_ml, haber_ml,
             tercero_id, centro_costo_id, descripcion,
             fecha_vencimiento, compensada_por_id, estado_partida
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           RETURNING *`,
          [
            documentoRow.id,
            index + 1,
            linea.cuentaId,
            debe,
            haber,
            debeMl,
            haberMl,
            linea.terceroId ?? null,
            linea.centroCostoId ?? null,
            linea.descripcion ?? null,
            linea.fechaVencimiento ?? null,
            linea.compensadaPorId ?? null,
            linea.estadoPartidaInicial ?? null,
          ],
        );
        lineas.push(mapLinea(lineaResult.rows[0]!));
      }

      await client.query("COMMIT");
      return mapDocumento(documentoRow, lineas);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async contabilizar(documentoId: string, usuario: string): Promise<Documento> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const docResult = await client.query<DocumentoRow>(
        `SELECT * FROM documento WHERE id = $1 FOR UPDATE`,
        [documentoId],
      );
      if (docResult.rowCount === 0) {
        throw new DocumentoNoEncontradoError(documentoId);
      }
      const documentoRow = docResult.rows[0]!;
      if (documentoRow.estado !== "borrador") {
        throw new EstadoInvalidoError("borrador", documentoRow.estado);
      }

      const lineasResult = await client.query<LineaRow>(
        `SELECT * FROM linea_documento WHERE documento_id = $1 ORDER BY numero_linea`,
        [documentoId],
      );
      const lineas = lineasResult.rows.map(mapLinea);

      const sumaDebe = sumar(lineas.map((l) => l.debe));
      const sumaHaber = sumar(lineas.map((l) => l.haber));
      if (!sumaDebe.equals(sumaHaber)) {
        throw new DocumentoDescuadradoError(formatearMonto(sumaDebe), formatearMonto(sumaHaber));
      }
      const sumaDebeMl = sumar(lineas.map((l) => l.debeMl));
      const sumaHaberMl = sumar(lineas.map((l) => l.haberMl));
      if (!sumaDebeMl.equals(sumaHaberMl)) {
        throw new DocumentoDescuadradoError(
          formatearMonto(sumaDebeMl),
          formatearMonto(sumaHaberMl),
        );
      }

      const { periodoId, ejercicioId } = await buscarPeriodoAbierto(
        client,
        documentoRow.sociedad_id,
        documentoRow.fecha_contabilizacion,
      );
      const numero = await asignarNumero(
        client,
        documentoRow.sociedad_id,
        documentoRow.tipo_documento_id,
        ejercicioId,
      );

      const actualizadoResult = await client.query<DocumentoRow>(
        `UPDATE documento
         SET numero = $2, periodo_id = $3, ejercicio_id = $4,
             estado = 'contabilizado', contabilizado_por = $5, contabilizado_at = now()
         WHERE id = $1
         RETURNING *`,
        [documentoId, numero, periodoId, ejercicioId, usuario],
      );
      const actualizado = actualizadoResult.rows[0]!;

      await registrarAuditoria(client, usuario, "CONTABILIZAR", "documento", documentoId, actualizado);

      await client.query("COMMIT");
      return mapDocumento(actualizado, lineas);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async stornar(documentoId: string, motivo: string, usuario: string): Promise<Documento> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const origResult = await client.query<DocumentoRow>(
        `SELECT * FROM documento WHERE id = $1 FOR UPDATE`,
        [documentoId],
      );
      if (origResult.rowCount === 0) {
        throw new DocumentoNoEncontradoError(documentoId);
      }
      const original = origResult.rows[0]!;
      if (original.estado !== "contabilizado") {
        throw new EstadoInvalidoError("contabilizado", original.estado);
      }

      const lineasOrigResult = await client.query<LineaRow>(
        `SELECT * FROM linea_documento WHERE documento_id = $1 ORDER BY numero_linea`,
        [documentoId],
      );

      const tipoStResult = await client.query<{ id: string }>(
        `SELECT id FROM tipo_documento WHERE codigo = 'ST'`,
      );
      if (tipoStResult.rowCount === 0) {
        throw new DomainError(
          "TIPO_DOCUMENTO_NO_CONFIGURADO",
          "No existe el tipo de documento 'ST' (storno). Corre `npm run seed`.",
          500,
        );
      }
      const tipoStId = tipoStResult.rows[0]!.id;

      const hoy = new Date().toISOString().slice(0, 10);

      const stornoResult = await client.query<DocumentoRow>(
        `INSERT INTO documento (
           sociedad_id, tipo_documento_id, fecha_documento, fecha_contabilizacion,
           moneda, tipo_cambio, referencia, descripcion, documento_origen_id,
           modulo_origen, created_by
         ) VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          original.sociedad_id,
          tipoStId,
          hoy,
          original.moneda,
          original.tipo_cambio,
          original.referencia,
          `Storno: ${motivo}`,
          original.id,
          original.modulo_origen,
          usuario,
        ],
      );
      const storno = stornoResult.rows[0]!;

      const lineasStorno: LineaDocumento[] = [];
      for (const [index, lineaOrig] of lineasOrigResult.rows.entries()) {
        const lineaResult = await client.query<LineaRow>(
          `INSERT INTO linea_documento (
             documento_id, numero_linea, cuenta_id, debe, haber, debe_ml, haber_ml,
             tercero_id, centro_costo_id, descripcion
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *`,
          [
            storno.id,
            index + 1,
            lineaOrig.cuenta_id,
            lineaOrig.haber,
            lineaOrig.debe,
            lineaOrig.haber_ml,
            lineaOrig.debe_ml,
            lineaOrig.tercero_id,
            lineaOrig.centro_costo_id,
            lineaOrig.descripcion,
          ],
        );
        lineasStorno.push(mapLinea(lineaResult.rows[0]!));
      }

      const { periodoId, ejercicioId } = await buscarPeriodoAbierto(
        client,
        original.sociedad_id,
        hoy,
      );
      const numero = await asignarNumero(client, original.sociedad_id, tipoStId, ejercicioId);

      const stornoContabilizadoResult = await client.query<DocumentoRow>(
        `UPDATE documento
         SET numero = $2, periodo_id = $3, ejercicio_id = $4,
             estado = 'contabilizado', contabilizado_por = $5, contabilizado_at = now()
         WHERE id = $1
         RETURNING *`,
        [storno.id, numero, periodoId, ejercicioId, usuario],
      );
      const stornoContabilizado = stornoContabilizadoResult.rows[0]!;

      await client.query(`UPDATE documento SET estado = 'anulado' WHERE id = $1`, [documentoId]);

      await registrarAuditoria(client, usuario, "STORNO", "documento", storno.id, {
        motivo,
        documentoOrigenId: documentoId,
        ...stornoContabilizado,
      });
      await registrarAuditoria(client, usuario, "ANULAR", "documento", documentoId, {
        motivo,
        stornoId: storno.id,
      });

      await client.query("COMMIT");
      return mapDocumento(stornoContabilizado, lineasStorno);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Recalcula el saldo derivado de una partida abierta (invariante 8: nunca
   * se guarda un saldo, se deriva de linea_documento) y, si llegó a cero, la
   * marca 'compensada' — la única escritura permitida en un documento ya
   * contabilizado (ver fn_linea_documento_before_write). Lo llaman
   * PagoService y NotaCreditoProveedorService después de contabilizar la
   * línea que aplica contra la partida.
   */
  async recalcularEstadoPartida(
    lineaAbiertaId: string,
    usuario: string,
  ): Promise<{ saldoAbierto: string; estadoPartida: EstadoPartida }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      const partida = await obtenerPartida(client, lineaAbiertaId);
      if (!partida) {
        throw new PartidaNoEncontradaError(lineaAbiertaId);
      }

      let estadoPartida = partida.estadoPartida;
      if (partida.estadoPartida === "abierta" && partida.saldoAbierto.isZero()) {
        await client.query(`UPDATE linea_documento SET estado_partida = 'compensada' WHERE id = $1`, [
          lineaAbiertaId,
        ]);
        await registrarAuditoria(client, usuario, "COMPENSAR_PARTIDA", "linea_documento", lineaAbiertaId, {
          montoOriginal: formatearMonto(partida.montoOriginal),
          montoCompensado: formatearMonto(partida.montoCompensado),
        });
        estadoPartida = "compensada";
      }

      await client.query("COMMIT");
      return { saldoAbierto: formatearMonto(partida.saldoAbierto), estadoPartida };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async obtener(documentoId: string): Promise<Documento | null> {
    const docResult = await this.pool.query<DocumentoRow>(`SELECT * FROM documento WHERE id = $1`, [
      documentoId,
    ]);
    if (docResult.rowCount === 0) {
      return null;
    }
    const lineasResult = await this.pool.query<LineaRow>(
      `SELECT * FROM linea_documento WHERE documento_id = $1 ORDER BY numero_linea`,
      [documentoId],
    );
    return mapDocumento(docResult.rows[0]!, lineasResult.rows.map(mapLinea));
  }
}
