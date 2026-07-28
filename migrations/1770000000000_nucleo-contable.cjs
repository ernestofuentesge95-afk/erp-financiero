/**
 * Fase 1 — Núcleo contable (el ledger).
 * Tablas de docs/01-modelo-datos-nucleo.md + triggers de protección exigidos
 * por CLAUDE.md regla 8 (inmutabilidad y partida doble se refuerzan en BD).
 *
 * tercero_id / centro_costo_id en linea_documento se agregan aquí como
 * columnas sin FK (las tablas tercero/centro_costo llegan en Fase 2) para
 * poder cumplir y testear el invariante 6 desde ya. fecha_vencimiento,
 * compensada_por_id y estado_partida (gestión de partidas abiertas) se
 * difieren a Fase 2 porque ningún invariante de Fase 1 los requiere.
 */

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE plan_cuentas (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      codigo TEXT NOT NULL UNIQUE,
      nombre TEXT NOT NULL,
      es_plantilla BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE empresa (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      codigo TEXT NOT NULL UNIQUE,
      nombre TEXT NOT NULL,
      activa BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE sociedad (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      empresa_id BIGINT NOT NULL REFERENCES empresa(id),
      codigo TEXT NOT NULL,
      nombre TEXT NOT NULL,
      nit TEXT,
      pais TEXT NOT NULL,
      moneda_funcional TEXT NOT NULL,
      plan_cuentas_id BIGINT NOT NULL REFERENCES plan_cuentas(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (empresa_id, codigo)
    );

    CREATE TABLE cuenta (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      plan_cuentas_id BIGINT NOT NULL REFERENCES plan_cuentas(id),
      codigo TEXT NOT NULL,
      nombre TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK (tipo IN ('activo', 'pasivo', 'patrimonio', 'ingreso', 'gasto')),
      naturaleza TEXT NOT NULL CHECK (naturaleza IN ('deudora', 'acreedora')),
      cuenta_padre_id BIGINT REFERENCES cuenta(id),
      permite_movimientos BOOLEAN NOT NULL DEFAULT true,
      requiere_tercero BOOLEAN NOT NULL DEFAULT false,
      requiere_centro_costo BOOLEAN NOT NULL DEFAULT false,
      gestion_partidas_abiertas BOOLEAN NOT NULL DEFAULT false,
      activa BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (plan_cuentas_id, codigo)
    );

    CREATE TABLE ejercicio_fiscal (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      sociedad_id BIGINT NOT NULL REFERENCES sociedad(id),
      anio INT NOT NULL,
      fecha_inicio DATE NOT NULL,
      fecha_fin DATE NOT NULL,
      estado TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'cerrado')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (sociedad_id, anio),
      CHECK (fecha_fin > fecha_inicio)
    );

    CREATE TABLE periodo_contable (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      ejercicio_id BIGINT NOT NULL REFERENCES ejercicio_fiscal(id),
      numero INT NOT NULL CHECK (numero BETWEEN 1 AND 13),
      fecha_inicio DATE NOT NULL,
      fecha_fin DATE NOT NULL,
      estado TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'cerrado')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (ejercicio_id, numero),
      CHECK (fecha_fin >= fecha_inicio)
    );

    CREATE TABLE tipo_documento (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      codigo TEXT NOT NULL UNIQUE,
      nombre TEXT NOT NULL,
      modulo_origen TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE secuencia_documento (
      sociedad_id BIGINT NOT NULL REFERENCES sociedad(id),
      tipo_documento_id BIGINT NOT NULL REFERENCES tipo_documento(id),
      ejercicio_id BIGINT NOT NULL REFERENCES ejercicio_fiscal(id),
      ultimo_numero BIGINT NOT NULL DEFAULT 0,
      PRIMARY KEY (sociedad_id, tipo_documento_id, ejercicio_id)
    );

    CREATE TABLE documento (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      sociedad_id BIGINT NOT NULL REFERENCES sociedad(id),
      tipo_documento_id BIGINT NOT NULL REFERENCES tipo_documento(id),
      numero BIGINT,
      ejercicio_id BIGINT REFERENCES ejercicio_fiscal(id),
      fecha_documento DATE NOT NULL,
      fecha_contabilizacion DATE NOT NULL,
      periodo_id BIGINT REFERENCES periodo_contable(id),
      moneda TEXT NOT NULL,
      tipo_cambio NUMERIC(15, 6) NOT NULL DEFAULT 1,
      referencia TEXT,
      descripcion TEXT,
      estado TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'contabilizado', 'anulado')),
      documento_origen_id BIGINT REFERENCES documento(id),
      modulo_origen TEXT NOT NULL DEFAULT 'GL',
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      contabilizado_por TEXT,
      contabilizado_at TIMESTAMPTZ
    );

    CREATE UNIQUE INDEX ux_documento_numero
      ON documento (sociedad_id, tipo_documento_id, ejercicio_id, numero)
      WHERE numero IS NOT NULL;

    CREATE TABLE linea_documento (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      documento_id BIGINT NOT NULL REFERENCES documento(id) ON DELETE CASCADE,
      numero_linea INT NOT NULL,
      cuenta_id BIGINT NOT NULL REFERENCES cuenta(id),
      debe NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (debe >= 0),
      haber NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (haber >= 0),
      debe_ml NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (debe_ml >= 0),
      haber_ml NUMERIC(15, 2) NOT NULL DEFAULT 0 CHECK (haber_ml >= 0),
      tercero_id BIGINT,
      centro_costo_id BIGINT,
      descripcion TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (documento_id, numero_linea)
    );

    CREATE TABLE audit_log (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      usuario TEXT NOT NULL,
      accion TEXT NOT NULL,
      entidad TEXT NOT NULL,
      entidad_id BIGINT NOT NULL,
      snapshot JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- ------------------------------------------------------------------
    -- Trigger: documento — nace en borrador, es inmutable una vez
    -- contabilizado (solo permite la transición a anulado sin tocar
    -- ningún otro campo), y valida cuadre + período abierto al
    -- contabilizar. Un solo trigger para evitar depender del orden de
    -- ejecución entre varios triggers BEFORE UPDATE.
    -- ------------------------------------------------------------------
    CREATE OR REPLACE FUNCTION fn_documento_before_write()
    RETURNS TRIGGER AS $$
    DECLARE
      v_num_lineas INT;
      v_suma_debe NUMERIC(15, 2);
      v_suma_haber NUMERIC(15, 2);
      v_suma_debe_ml NUMERIC(15, 2);
      v_suma_haber_ml NUMERIC(15, 2);
      v_periodo_estado TEXT;
    BEGIN
      IF TG_OP = 'DELETE' THEN
        IF OLD.estado <> 'borrador' THEN
          RAISE EXCEPTION 'No se puede eliminar un documento en estado %', OLD.estado
            USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
      END IF;

      IF TG_OP = 'INSERT' THEN
        IF NEW.estado <> 'borrador' THEN
          RAISE EXCEPTION 'Todo documento debe crearse en estado borrador (punto único de escritura: solo ContabilizacionService transiciona a contabilizado)'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END IF;

      -- TG_OP = 'UPDATE'
      IF OLD.estado = 'borrador' THEN
        IF NEW.estado = 'contabilizado' THEN
          SELECT COUNT(*), COALESCE(SUM(debe), 0), COALESCE(SUM(haber), 0),
                 COALESCE(SUM(debe_ml), 0), COALESCE(SUM(haber_ml), 0)
            INTO v_num_lineas, v_suma_debe, v_suma_haber, v_suma_debe_ml, v_suma_haber_ml
            FROM linea_documento WHERE documento_id = NEW.id;

          IF v_num_lineas < 2 THEN
            RAISE EXCEPTION 'El documento % debe tener al menos 2 líneas para contabilizarse', NEW.id
              USING ERRCODE = '23514';
          END IF;
          IF v_suma_debe <> v_suma_haber THEN
            RAISE EXCEPTION 'El documento % no cuadra en moneda de documento (debe % / haber %)',
              NEW.id, v_suma_debe, v_suma_haber USING ERRCODE = '23514';
          END IF;
          IF v_suma_debe_ml <> v_suma_haber_ml THEN
            RAISE EXCEPTION 'El documento % no cuadra en moneda local (debe_ml % / haber_ml %)',
              NEW.id, v_suma_debe_ml, v_suma_haber_ml USING ERRCODE = '23514';
          END IF;

          IF NEW.periodo_id IS NULL THEN
            RAISE EXCEPTION 'El documento % no tiene período asignado', NEW.id USING ERRCODE = '23514';
          END IF;
          SELECT estado INTO v_periodo_estado FROM periodo_contable WHERE id = NEW.periodo_id;
          IF v_periodo_estado IS DISTINCT FROM 'abierto' THEN
            RAISE EXCEPTION 'El período % no está abierto para contabilizar', NEW.periodo_id
              USING ERRCODE = '23514';
          END IF;
        END IF;
        RETURN NEW;
      END IF;

      IF OLD.estado = 'contabilizado' AND NEW.estado = 'anulado' THEN
        IF (to_jsonb(NEW) - 'estado') IS DISTINCT FROM (to_jsonb(OLD) - 'estado') THEN
          RAISE EXCEPTION 'Un documento contabilizado solo permite anularse, sin modificar ningún otro campo'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END IF;

      RAISE EXCEPTION 'Un documento en estado % es inmutable', OLD.estado USING ERRCODE = '23514';
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER trg_documento_before_write
      BEFORE INSERT OR UPDATE OR DELETE ON documento
      FOR EACH ROW EXECUTE FUNCTION fn_documento_before_write();

    -- ------------------------------------------------------------------
    -- Trigger: linea_documento — solo se puede insertar/editar/eliminar
    -- mientras el documento dueño esté en borrador; valida signos de
    -- debe/haber, que la cuenta permita movimientos y esté activa, y los
    -- campos condicionales (tercero/centro de costo) según la cuenta.
    -- ------------------------------------------------------------------
    CREATE OR REPLACE FUNCTION fn_linea_documento_before_write()
    RETURNS TRIGGER AS $$
    DECLARE
      v_estado_doc TEXT;
      v_cuenta RECORD;
    BEGIN
      SELECT estado INTO v_estado_doc FROM documento WHERE id = COALESCE(NEW.documento_id, OLD.documento_id);

      -- v_estado_doc NULL en DELETE = el borrado llegó por ON DELETE CASCADE
      -- desde documento (el padre ya no está). Se permite: el trigger del
      -- padre ya exigió que estuviera en borrador antes de dejarlo borrar.
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

    CREATE TRIGGER trg_linea_documento_before_write
      BEFORE INSERT OR UPDATE OR DELETE ON linea_documento
      FOR EACH ROW EXECUTE FUNCTION fn_linea_documento_before_write();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`
    DROP TRIGGER IF EXISTS trg_linea_documento_before_write ON linea_documento;
    DROP FUNCTION IF EXISTS fn_linea_documento_before_write();
    DROP TRIGGER IF EXISTS trg_documento_before_write ON documento;
    DROP FUNCTION IF EXISTS fn_documento_before_write();

    DROP TABLE IF EXISTS audit_log;
    DROP TABLE IF EXISTS linea_documento;
    DROP TABLE IF EXISTS documento;
    DROP TABLE IF EXISTS secuencia_documento;
    DROP TABLE IF EXISTS tipo_documento;
    DROP TABLE IF EXISTS periodo_contable;
    DROP TABLE IF EXISTS ejercicio_fiscal;
    DROP TABLE IF EXISTS cuenta;
    DROP TABLE IF EXISTS sociedad;
    DROP TABLE IF EXISTS empresa;
    DROP TABLE IF EXISTS plan_cuentas;
  `);
};
