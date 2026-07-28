/**
 * Fase 2 — Terceros y Cuentas por Pagar.
 * Tablas de docs/01-modelo-datos-nucleo.md §4-5 + las columnas de
 * linea_documento que se difirieron en Fase 1 (fecha_vencimiento,
 * compensada_por_id, estado_partida) + FK de tercero_id/centro_costo_id que
 * en Fase 1 existían sin FK porque estas tablas no existían todavía.
 *
 * Modelo de compensación de partidas abiertas (no está detallado 1:1 en el
 * doc, decisión de diseño para soportar pagos parciales múltiples contra una
 * misma partida con un solo campo compensada_por_id por línea):
 *   - estado_partida vive SOLO en la línea que ORIGINA la partida (p.ej. el
 *     haber de CxP de una factura): 'abierta' al nacer, 'compensada' cuando
 *     su saldo derivado llega a cero.
 *   - compensada_por_id vive SOLO en la línea que APLICA/compensa (pago o
 *     nota de crédito) y apunta a la línea de origen. Varias líneas de
 *     compensación pueden apuntar a la misma línea de origen (pagos
 *     parciales sucesivos) porque no es un campo UNIQUE.
 *   - El saldo abierto de una partida = su propio monto - suma de montos de
 *     todas las líneas cuyo compensada_por_id la referencia (invariante 8:
 *     siempre derivado, nunca una columna de saldo).
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE tercero (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      empresa_id BIGINT NOT NULL REFERENCES empresa(id),
      codigo TEXT NOT NULL,
      nombre TEXT NOT NULL,
      nit TEXT,
      es_cliente BOOLEAN NOT NULL DEFAULT false,
      es_proveedor BOOLEAN NOT NULL DEFAULT false,
      condicion_pago_dias INT NOT NULL DEFAULT 30,
      activo BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (empresa_id, codigo)
    );

    CREATE TABLE centro_costo (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      sociedad_id BIGINT NOT NULL REFERENCES sociedad(id),
      codigo TEXT NOT NULL,
      nombre TEXT NOT NULL,
      activo BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (sociedad_id, codigo)
    );

    CREATE TABLE indicador_impuesto (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      sociedad_id BIGINT NOT NULL REFERENCES sociedad(id),
      codigo TEXT NOT NULL,
      tasa NUMERIC(6, 4) NOT NULL CHECK (tasa >= 0),
      cuenta_iva_credito_id BIGINT REFERENCES cuenta(id),
      cuenta_iva_debito_id BIGINT REFERENCES cuenta(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (sociedad_id, codigo)
    );

    CREATE TABLE regla_determinacion_cuenta (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      sociedad_id BIGINT NOT NULL REFERENCES sociedad(id),
      modulo TEXT NOT NULL,
      operacion TEXT NOT NULL,
      condicion TEXT,
      cuenta_id BIGINT NOT NULL REFERENCES cuenta(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- COALESCE(condicion, '') para que la regla "default" (condicion NULL)
    -- también sea única por sociedad+modulo+operacion: NULL <> NULL en un
    -- UNIQUE normal permitiría duplicados silenciosos.
    CREATE UNIQUE INDEX ux_regla_determinacion_cuenta
      ON regla_determinacion_cuenta (sociedad_id, modulo, operacion, COALESCE(condicion, ''));

    ALTER TABLE linea_documento
      ADD CONSTRAINT linea_documento_tercero_id_fkey FOREIGN KEY (tercero_id) REFERENCES tercero(id),
      ADD CONSTRAINT linea_documento_centro_costo_id_fkey FOREIGN KEY (centro_costo_id) REFERENCES centro_costo(id),
      ADD COLUMN fecha_vencimiento DATE,
      ADD COLUMN compensada_por_id BIGINT REFERENCES linea_documento(id),
      ADD COLUMN estado_partida TEXT CHECK (estado_partida IN ('abierta', 'compensada')),
      ADD CONSTRAINT linea_documento_compensada_por_no_self CHECK (compensada_por_id IS NULL OR compensada_por_id <> id);

    CREATE OR REPLACE FUNCTION fn_linea_documento_before_write()
    RETURNS TRIGGER AS $$
    DECLARE
      v_estado_doc TEXT;
      v_cuenta RECORD;
    BEGIN
      SELECT estado INTO v_estado_doc FROM documento WHERE id = COALESCE(NEW.documento_id, OLD.documento_id);

      IF TG_OP = 'DELETE' THEN
        IF v_estado_doc IS NOT NULL AND v_estado_doc <> 'borrador' THEN
          RAISE EXCEPTION 'No se pueden modificar líneas de un documento en estado %', v_estado_doc
            USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
      END IF;

      -- Excepción explícita del modelo (docs/01 §3): en un documento ya
      -- contabilizado solo se permite marcar la compensación de una partida
      -- (estado_partida abierta -> compensada), nada más.
      IF TG_OP = 'UPDATE' AND v_estado_doc IS DISTINCT FROM 'borrador' THEN
        IF v_estado_doc <> 'contabilizado' THEN
          RAISE EXCEPTION 'No se pueden modificar líneas de un documento en estado %', v_estado_doc
            USING ERRCODE = '23514';
        END IF;
        IF (to_jsonb(NEW) - 'estado_partida') IS DISTINCT FROM (to_jsonb(OLD) - 'estado_partida') THEN
          RAISE EXCEPTION 'En un documento contabilizado solo se permite marcar la compensación (estado_partida) de una línea'
            USING ERRCODE = '23514';
        END IF;
        IF OLD.estado_partida IS DISTINCT FROM 'abierta' OR NEW.estado_partida IS DISTINCT FROM 'compensada' THEN
          RAISE EXCEPTION 'estado_partida solo puede transicionar de abierta a compensada'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END IF;

      -- A partir de aquí: INSERT, o UPDATE con el documento todavía en borrador.
      IF v_estado_doc IS DISTINCT FROM 'borrador' THEN
        RAISE EXCEPTION 'No se pueden modificar líneas de un documento en estado %', v_estado_doc
          USING ERRCODE = '23514';
      END IF;

      IF NEW.debe > 0 AND NEW.haber > 0 THEN
        RAISE EXCEPTION 'Una línea no puede tener debe y haber mayores a cero simultáneamente'
          USING ERRCODE = '23514';
      END IF;
      IF NEW.debe = 0 AND NEW.haber = 0 THEN
        RAISE EXCEPTION 'Una línea debe tener debe o haber mayor a cero' USING ERRCODE = '23514';
      END IF;

      SELECT permite_movimientos, activa, requiere_tercero, requiere_centro_costo, gestion_partidas_abiertas
        INTO v_cuenta
        FROM cuenta WHERE id = NEW.cuenta_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'La cuenta % no existe', NEW.cuenta_id USING ERRCODE = '23514';
      END IF;
      IF NOT v_cuenta.permite_movimientos THEN
        RAISE EXCEPTION 'La cuenta % no permite movimientos (es una cuenta de agrupación)', NEW.cuenta_id
          USING ERRCODE = '23514';
      END IF;
      IF NOT v_cuenta.activa THEN
        RAISE EXCEPTION 'La cuenta % está inactiva', NEW.cuenta_id USING ERRCODE = '23514';
      END IF;
      IF v_cuenta.requiere_tercero AND NEW.tercero_id IS NULL THEN
        RAISE EXCEPTION 'La cuenta % requiere tercero_id en la línea', NEW.cuenta_id USING ERRCODE = '23514';
      END IF;
      IF v_cuenta.requiere_centro_costo AND NEW.centro_costo_id IS NULL THEN
        RAISE EXCEPTION 'La cuenta % requiere centro_costo_id en la línea', NEW.cuenta_id USING ERRCODE = '23514';
      END IF;

      IF (NEW.estado_partida IS NOT NULL OR NEW.compensada_por_id IS NOT NULL OR NEW.fecha_vencimiento IS NOT NULL)
         AND NOT v_cuenta.gestion_partidas_abiertas THEN
        RAISE EXCEPTION 'La cuenta % no gestiona partidas abiertas (no admite fecha_vencimiento/estado_partida/compensada_por_id)', NEW.cuenta_id
          USING ERRCODE = '23514';
      END IF;
      IF NEW.estado_partida IS NOT NULL AND NEW.compensada_por_id IS NOT NULL THEN
        RAISE EXCEPTION 'Una línea no puede ser origen (estado_partida) y compensación (compensada_por_id) a la vez'
          USING ERRCODE = '23514';
      END IF;
      IF TG_OP = 'INSERT' AND NEW.estado_partida IS NOT NULL AND NEW.estado_partida <> 'abierta' THEN
        RAISE EXCEPTION 'Una línea nueva con estado_partida solo puede nacer abierta' USING ERRCODE = '23514';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    CREATE OR REPLACE FUNCTION fn_linea_documento_before_write()
    RETURNS TRIGGER AS $$
    DECLARE
      v_estado_doc TEXT;
      v_cuenta RECORD;
    BEGIN
      SELECT estado INTO v_estado_doc FROM documento WHERE id = COALESCE(NEW.documento_id, OLD.documento_id);

      IF TG_OP = 'DELETE' THEN
        IF v_estado_doc IS NOT NULL AND v_estado_doc <> 'borrador' THEN
          RAISE EXCEPTION 'No se pueden modificar líneas de un documento en estado %', v_estado_doc
            USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
      END IF;

      IF v_estado_doc IS DISTINCT FROM 'borrador' THEN
        RAISE EXCEPTION 'No se pueden modificar líneas de un documento en estado %', v_estado_doc
          USING ERRCODE = '23514';
      END IF;

      IF NEW.debe > 0 AND NEW.haber > 0 THEN
        RAISE EXCEPTION 'Una línea no puede tener debe y haber mayores a cero simultáneamente'
          USING ERRCODE = '23514';
      END IF;
      IF NEW.debe = 0 AND NEW.haber = 0 THEN
        RAISE EXCEPTION 'Una línea debe tener debe o haber mayor a cero' USING ERRCODE = '23514';
      END IF;

      SELECT permite_movimientos, activa, requiere_tercero, requiere_centro_costo
        INTO v_cuenta
        FROM cuenta WHERE id = NEW.cuenta_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'La cuenta % no existe', NEW.cuenta_id USING ERRCODE = '23514';
      END IF;
      IF NOT v_cuenta.permite_movimientos THEN
        RAISE EXCEPTION 'La cuenta % no permite movimientos (es una cuenta de agrupación)', NEW.cuenta_id
          USING ERRCODE = '23514';
      END IF;
      IF NOT v_cuenta.activa THEN
        RAISE EXCEPTION 'La cuenta % está inactiva', NEW.cuenta_id USING ERRCODE = '23514';
      END IF;
      IF v_cuenta.requiere_tercero AND NEW.tercero_id IS NULL THEN
        RAISE EXCEPTION 'La cuenta % requiere tercero_id en la línea', NEW.cuenta_id USING ERRCODE = '23514';
      END IF;
      IF v_cuenta.requiere_centro_costo AND NEW.centro_costo_id IS NULL THEN
        RAISE EXCEPTION 'La cuenta % requiere centro_costo_id en la línea', NEW.cuenta_id USING ERRCODE = '23514';
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    ALTER TABLE linea_documento
      DROP CONSTRAINT IF EXISTS linea_documento_compensada_por_no_self,
      DROP COLUMN IF EXISTS estado_partida,
      DROP COLUMN IF EXISTS compensada_por_id,
      DROP COLUMN IF EXISTS fecha_vencimiento,
      DROP CONSTRAINT IF EXISTS linea_documento_centro_costo_id_fkey,
      DROP CONSTRAINT IF EXISTS linea_documento_tercero_id_fkey;

    DROP TABLE IF EXISTS regla_determinacion_cuenta;
    DROP TABLE IF EXISTS indicador_impuesto;
    DROP TABLE IF EXISTS centro_costo;
    DROP TABLE IF EXISTS tercero;
  `);
};
