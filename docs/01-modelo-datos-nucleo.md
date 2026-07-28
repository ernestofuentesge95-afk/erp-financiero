# Modelo de Datos — Núcleo Contable (Ledger Engine)

> Este documento define el modelo de datos del corazón del ERP. Todo módulo futuro
> (CxP, CxC, bancos, inventario) produce documentos a través de este núcleo.
> **Ningún módulo escribe directamente en las tablas contables.**

Base de datos: **PostgreSQL 16+**. Convenciones: tablas y columnas en `snake_case`,
llaves primarias `id BIGINT GENERATED ALWAYS AS IDENTITY`, timestamps `created_at` /
`created_by` en toda tabla. Los montos usan `NUMERIC(15,2)`; los tipos de cambio `NUMERIC(15,6)`.

---

## 1. Estructura organizativa

### `empresa` (tenant)
Nivel superior. Permite operar el sistema como SaaS multi-empresa en el futuro.

| Columna | Tipo | Notas |
|---|---|---|
| id | BIGINT PK | |
| codigo | TEXT UNIQUE | ej. `ACME` |
| nombre | TEXT | Razón social del grupo |
| activa | BOOLEAN | default true |

### `sociedad` (company code — entidad legal)
Toda transacción contable pertenece a exactamente una sociedad.

| Columna | Tipo | Notas |
|---|---|---|
| id | BIGINT PK | |
| empresa_id | FK → empresa | |
| codigo | TEXT | ej. `SV01`; UNIQUE por empresa |
| nombre | TEXT | Razón social legal |
| nit | TEXT | Registro fiscal |
| pais | TEXT | ISO-3166, ej. `SV` |
| moneda_funcional | TEXT | ISO-4217, ej. `USD` |
| plan_cuentas_id | FK → plan_cuentas | |

### `ejercicio_fiscal`
| Columna | Tipo | Notas |
|---|---|---|
| id | BIGINT PK | |
| sociedad_id | FK | |
| anio | INT | UNIQUE por sociedad |
| fecha_inicio / fecha_fin | DATE | normalmente año calendario |
| estado | TEXT | `abierto` \| `cerrado` |

### `periodo_contable`
Períodos 1–12 más el período 13 de ajustes de cierre.

| Columna | Tipo | Notas |
|---|---|---|
| id | BIGINT PK | |
| ejercicio_id | FK | |
| numero | INT | 1–13; UNIQUE por ejercicio |
| fecha_inicio / fecha_fin | DATE | |
| estado | TEXT | `abierto` \| `cerrado` |

**Regla:** solo se puede contabilizar en períodos con estado `abierto`. Cerrar un período
es una acción explícita y auditada; reabrirlo requiere permiso especial.

---

## 2. Plan de cuentas

### `plan_cuentas`
| Columna | Tipo | Notas |
|---|---|---|
| id | BIGINT PK | |
| codigo | TEXT | ej. `SV_PYME` |
| nombre | TEXT | |
| es_plantilla | BOOLEAN | las plantillas se copian al crear una sociedad |

### `cuenta`
| Columna | Tipo | Notas |
|---|---|---|
| id | BIGINT PK | |
| plan_cuentas_id | FK | |
| codigo | TEXT | ej. `110101`; UNIQUE por plan |
| nombre | TEXT | |
| tipo | TEXT | `activo` \| `pasivo` \| `patrimonio` \| `ingreso` \| `gasto` |
| naturaleza | TEXT | `deudora` \| `acreedora` |
| cuenta_padre_id | FK → cuenta | jerarquía para agrupación en reportes |
| permite_movimientos | BOOLEAN | false = cuenta de agrupación (mayor), no recibe líneas |
| requiere_tercero | BOOLEAN | true en cuentas de CxC / CxP |
| requiere_centro_costo | BOOLEAN | típicamente true en ingresos y gastos |
| gestion_partidas_abiertas | BOOLEAN | true en CxC, CxP y bancos (habilita compensación) |
| activa | BOOLEAN | |

**Reglas:**
- Solo cuentas con `permite_movimientos = true` pueden aparecer en líneas de documento.
- Los saldos de las cuentas **nunca se almacenan**: se derivan siempre de las líneas de
  documento (una vista materializada puede optimizar reportes, pero la fuente de verdad
  es el documento).

---

## 3. El documento contable (corazón del sistema)

### `tipo_documento`
| Columna | Tipo | Notas |
|---|---|---|
| id | BIGINT PK | |
| codigo | TEXT | ver catálogo abajo |
| nombre | TEXT | |
| modulo_origen | TEXT | `GL` \| `AP` \| `AR` \| `BK` \| ... |

Catálogo inicial: `AS` asiento manual · `FP` factura de proveedor · `NC-P` nota de crédito
proveedor · `PG` pago emitido · `FC` factura a cliente · `NC-C` nota de crédito cliente ·
`CB` cobro recibido · `CB-AJ` ajuste bancario · `ST` storno · `AP` asiento de apertura ·
`CI` asiento de cierre.

### `secuencia_documento`
Numeración correlativa **sin huecos** por sociedad + tipo + ejercicio.

| Columna | Tipo | Notas |
|---|---|---|
| sociedad_id + tipo_documento_id + ejercicio_id | PK compuesta | |
| ultimo_numero | BIGINT | se incrementa con `SELECT ... FOR UPDATE` dentro de la transacción de contabilización |

### `documento`
| Columna | Tipo | Notas |
|---|---|---|
| id | BIGINT PK | |
| sociedad_id | FK | |
| tipo_documento_id | FK | |
| numero | BIGINT | correlativo; UNIQUE (sociedad, tipo, ejercicio, numero) |
| fecha_documento | DATE | fecha del documento físico (factura, etc.) |
| fecha_contabilizacion | DATE | determina el período |
| periodo_id | FK → periodo_contable | derivado de fecha_contabilizacion al contabilizar |
| moneda | TEXT | moneda del documento |
| tipo_cambio | NUMERIC(15,6) | 1.0 si moneda = moneda funcional |
| referencia | TEXT | nº de factura del proveedor, nº de cheque, etc. |
| descripcion | TEXT | |
| estado | TEXT | `borrador` \| `contabilizado` \| `anulado` |
| documento_origen_id | FK → documento | trazabilidad: el storno apunta al documento que anula; un pago puede apuntar a la factura |
| modulo_origen | TEXT | `GL`, `AP`, `AR`, `BK`... |
| created_by / created_at | | |
| contabilizado_por / contabilizado_at | | |

### `linea_documento`
| Columna | Tipo | Notas |
|---|---|---|
| id | BIGINT PK | |
| documento_id | FK | |
| numero_linea | INT | UNIQUE por documento |
| cuenta_id | FK → cuenta | |
| debe | NUMERIC(15,2) | ≥ 0; exactamente uno de debe/haber es > 0 |
| haber | NUMERIC(15,2) | ≥ 0 |
| debe_ml / haber_ml | NUMERIC(15,2) | importes en moneda local (funcional), calculados con tipo_cambio |
| tercero_id | FK → tercero, nullable | obligatorio si la cuenta lo requiere |
| centro_costo_id | FK → centro_costo, nullable | obligatorio si la cuenta lo requiere |
| fecha_vencimiento | DATE, nullable | para partidas de CxC / CxP |
| descripcion | TEXT | |
| compensada_por_id | FK → linea_documento, nullable | compensación de partidas abiertas (clearing) |
| estado_partida | TEXT, nullable | `abierta` \| `compensada` — solo en cuentas con gestión de partidas abiertas |

### Ciclo de vida e inmutabilidad

```
borrador ──(contabilizar)──▶ contabilizado ──(storno)──▶ anulado
```

- En `borrador` el documento puede editarse o eliminarse.
- Al **contabilizar** (transacción atómica): se valida partida doble, período abierto,
  cuentas válidas, campos obligatorios; se asigna número correlativo; se fija el período.
- Un documento `contabilizado` **jamás se actualiza ni se borra**. Prohibido a nivel de
  aplicación **y** de base de datos (trigger que rechaza UPDATE/DELETE salvo el cambio
  de estado a `anulado` y el marcado de compensación).
- El **storno** crea un documento nuevo tipo `ST` con las líneas invertidas exactas,
  `documento_origen_id` apuntando al original, y marca el original como `anulado`.

---

## 4. Terceros y centros de costo

### `tercero` (business partner)
| Columna | Tipo | Notas |
|---|---|---|
| id | BIGINT PK | |
| empresa_id | FK | compartido entre sociedades del tenant |
| codigo | TEXT | UNIQUE por empresa |
| nombre | TEXT | |
| nit | TEXT | |
| es_cliente / es_proveedor | BOOLEAN | un tercero puede ser ambos |
| condicion_pago_dias | INT | default para calcular vencimientos |
| activo | BOOLEAN | |

### `centro_costo`
| Columna | Tipo | Notas |
|---|---|---|
| id | BIGINT PK | |
| sociedad_id | FK | |
| codigo | TEXT | UNIQUE por sociedad |
| nombre | TEXT | |
| activo | BOOLEAN | |

---

## 5. Configuración: determinación de cuentas e impuestos

### `indicador_impuesto`
| Columna | Tipo | Notas |
|---|---|---|
| id | BIGINT PK | |
| sociedad_id | FK | |
| codigo | TEXT | ej. `IVA13`, `EXENTO` |
| tasa | NUMERIC(6,4) | ej. 0.1300 |
| cuenta_iva_credito_id | FK → cuenta | IVA crédito fiscal (compras) |
| cuenta_iva_debito_id | FK → cuenta | IVA débito fiscal (ventas) |

### `regla_determinacion_cuenta`
Tabla clave-valor que traduce operaciones de negocio a cuentas contables.
Es lo que permite que los módulos generen asientos sin conocer el plan de cuentas.

| Columna | Tipo | Notas |
|---|---|---|
| id | BIGINT PK | |
| sociedad_id | FK | |
| modulo | TEXT | `AP`, `AR`, `BK`... |
| operacion | TEXT | ej. `AP.CXP_DEFAULT`, `AR.CXC_DEFAULT`, `BK.BANCO_DEFAULT`, `AP.DESCUENTO_PP` |
| condicion | TEXT, nullable | discriminador opcional (categoría de proveedor, etc.) |
| cuenta_id | FK → cuenta | |

---

## 6. Auditoría

### `audit_log`
Toda acción relevante (contabilizar, anular, cerrar período, cambiar configuración)
registra: usuario, timestamp, acción, entidad, id, y snapshot JSON del cambio.
La inmutabilidad del documento cubre el "qué"; el audit log cubre el "quién y cuándo"
de las acciones administrativas.

---

## 7. Invariantes del sistema (deben existir como tests automatizados)

1. **Partida doble:** en todo documento contabilizado, `Σ debe_ml = Σ haber_ml` (y por
   moneda de documento, `Σ debe = Σ haber`).
2. **Período abierto:** no se contabiliza ni se anula en un período cerrado.
3. **Inmutabilidad:** un documento contabilizado no admite UPDATE ni DELETE (verificado
   con test que intenta hacerlo directo en la BD y espera rechazo del trigger).
4. **Storno exacto:** el storno de un documento produce líneas espejo exactas y ambos
   documentos quedan vinculados; el efecto neto en saldos es cero.
5. **Cuentas imputables:** ninguna línea referencia una cuenta con
   `permite_movimientos = false` o inactiva.
6. **Campos obligatorios condicionales:** si la cuenta requiere tercero o centro de
   costo, la línea los trae.
7. **Numeración sin huecos:** por sociedad + tipo + ejercicio, los números de documentos
   contabilizados forman una secuencia correlativa.
8. **Saldos derivados:** el balance de comprobación se calcula desde `linea_documento`;
   no existe ninguna tabla de saldos que sea fuente de verdad.
9. **Punto único de escritura:** solo el servicio `ContabilizacionService` inserta en
   `documento` / `linea_documento` con estado `contabilizado`.
