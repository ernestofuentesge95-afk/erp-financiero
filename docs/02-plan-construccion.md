# Plan de Construcción — Módulo por Módulo

> Estrategia: construir en **vertical**. Cada fase entrega un flujo de negocio completo
> y usable, validado con tests, antes de pasar a la siguiente. Cada fase es un contexto
> manejable para una o pocas sesiones de Claude Code.

**Stack:** Node.js + TypeScript · PostgreSQL 16 · API REST (Fastify) · migraciones con
`node-pg-migrate` (o Prisma Migrate) · tests con Vitest · frontend se aborda a partir de
la Fase 2 (React + Vite), primero todo se valida vía API y tests.

---

## Fase 0 — Fundaciones (1 sesión)

**Objetivo:** repositorio listo para que las fases siguientes solo agreguen dominio.

Entregables:
- Monorepo o repo simple con `src/`, `migrations/`, `tests/`, `docs/`.
- Docker Compose con PostgreSQL local; scripts `npm run dev`, `npm run test`, `npm run migrate`.
- Esqueleto de API (health check), manejo de errores estándar, logging.
- Pipeline de CI simple (lint + tests).

**Criterio de salida:** `npm test` corre en verde y una migración de ejemplo aplica y revierte.

---

## Fase 1 — Núcleo contable (el ledger) (2–4 sesiones)

**Objetivo:** poder registrar asientos manuales que cumplen todos los invariantes,
y obtener un balance de comprobación correcto.

Entregables, en este orden:
1. Migraciones de: `empresa`, `sociedad`, `ejercicio_fiscal`, `periodo_contable`,
   `plan_cuentas`, `cuenta`, `tipo_documento`, `secuencia_documento`, `documento`,
   `linea_documento`, `audit_log`.
2. Triggers de protección en BD: inmutabilidad de documentos contabilizados,
   validación de cuadre al contabilizar.
3. Datos semilla: plantilla de plan de cuentas para El Salvador (pyme), tipos de
   documento del catálogo, una sociedad demo con ejercicio y períodos 2026.
4. `ContabilizacionService`: única puerta de entrada al ledger.
   - `crearBorrador(doc)` / `contabilizar(docId)` / `stornar(docId, motivo)`.
   - Todas las validaciones de invariantes viven aquí (y se refuerzan en BD).
5. Gestión de períodos: abrir / cerrar, con audit log.
6. API REST: CRUD de catálogos, asiento manual (borrador → contabilizar), storno.
7. Reporte: **balance de comprobación** por sociedad y rango de períodos
   (saldo inicial, débitos, créditos, saldo final por cuenta).

**Criterios de salida (tests obligatorios):**
- Los 9 invariantes del documento de modelo de datos tienen test automatizado.
- Caso e2e: crear asiento manual de 3 líneas → contabilizar → balance cuadra →
  stornar → balance vuelve al estado previo.
- Intento de UPDATE directo a un documento contabilizado en la BD es rechazado.

---

## Fase 2 — Terceros y Cuentas por Pagar (2–3 sesiones)

**Objetivo:** flujo completo proveedor: factura → asiento automático → pago →
compensación de partidas → reporte de antigüedad.

Entregables:
1. Migraciones: `tercero`, `centro_costo`, `indicador_impuesto`,
   `regla_determinacion_cuenta` + semillas (IVA 13% El Salvador, reglas AP default).
2. Servicio `FacturaProveedorService`: captura factura (proveedor, líneas de gasto con
   centro de costo, indicador de impuesto) → genera documento `FP` vía
   `ContabilizacionService` usando determinación de cuentas:
   `Gasto (D) + IVA crédito (D) contra CxP (H)` con partida abierta y vencimiento.
3. Servicio `PagoService`: pago total o parcial → documento `PG`
   (`CxP (D) contra Banco (H)`) + compensación de partidas abiertas (clearing).
4. Notas de crédito de proveedor (`NC-P`).
5. Reportes: partidas abiertas por proveedor, **antigüedad de saldos CxP**
   (buckets 0-30 / 31-60 / 61-90 / +90).
6. Primer frontend: pantallas de captura de factura, registro de pago, consulta de
   partidas y antigüedad.

**Criterios de salida:**
- E2e: factura $1,130 (gasto $1,000 + IVA $130) → pago parcial $500 → partida queda
  abierta por $630 → pago $630 → partida compensada, saldo CxP del proveedor = 0.
- El usuario que captura la factura nunca eligió cuentas contables: todo salió de
  `regla_determinacion_cuenta` e `indicador_impuesto`.

---

## Fase 3 — Cuentas por Cobrar y Facturación (2–3 sesiones)

**Objetivo:** espejo de la Fase 2 del lado cliente.

Entregables:
- `FacturaClienteService` (`FC`): `CxC (D) contra Ingreso (H) + IVA débito (H)`,
  partida abierta con vencimiento según condición de pago del cliente.
- `CobroService` (`CB`) con compensación, cobros parciales y anticipos.
- Notas de crédito a clientes (`NC-C`).
- Reportes: partidas abiertas por cliente, antigüedad CxC, ventas por período.
- Frontend correspondiente.

**Criterio de salida:** e2e simétrico al de Fase 2, del lado cliente.

---

## Fase 4 — Bancos y Conciliación (2 sesiones)

**Objetivo:** control del efectivo real.

Entregables:
- Cuentas bancarias como cuentas con gestión de partidas abiertas + tabla
  `cuenta_bancaria` (banco, número, cuenta contable asociada).
- Importación de estado de cuenta (CSV) a tabla staging `movimiento_bancario`.
- Motor de conciliación: matching automático por monto + referencia + fecha,
  con confirmación manual de lo no coincidente; los ajustes generan documentos `CB-AJ`.
- Reporte de conciliación: saldo según libros vs saldo según banco, partidas en tránsito.

**Criterio de salida:** e2e con un CSV de 20 movimientos donde 15 concilian automático,
3 manual y 2 generan ajustes; la conciliación cierra en cero.

---

## Fase 5 — Estados financieros (1–2 sesiones)

**Objetivo:** los tres reportes que dirigen el negocio, derivados 100% de documentos.

Entregables:
- **Balance general** y **estado de resultados** usando la jerarquía de cuentas
  (`cuenta_padre_id`) para agrupar, comparativo entre períodos.
- **Flujo de caja** por método indirecto.
- Exportación a Excel/PDF de los tres reportes.
- Verificación cruzada automática: utilidad del P&L = variación de resultados en el
  balance; balance cuadra (activo = pasivo + patrimonio).

---

## Fase 6 — Cierre y multi-moneda (2 sesiones)

- Proceso de cierre de ejercicio: asiento de cierre de resultados (`CI`), asiento de
  apertura del ejercicio siguiente (`AP`), período 13 de ajustes.
- Revaluación de partidas abiertas en moneda extranjera (diferencial cambiario).
- Bloqueos y checklist de cierre mensual.

---

## Backlog posterior (no antes de validar Fases 1–5 con usuarios reales)

- Inventario y costo de ventas (kardex, promedio ponderado) — genera documentos vía el núcleo.
- Activos fijos y depreciación automática.
- Reporting por centro de costo / beneficio (la capa "CO").
- Presupuestos vs real.
- Multi-tenant SaaS: aislamiento por `empresa_id`, autenticación, roles y permisos finos.
- Libros fiscales de El Salvador (libro de compras, libro de ventas, F-07/F-14).

---

## Método de trabajo con Claude Code

1. **Una fase (o sub-entregable) por sesión.** Abrir la sesión indicando: fase, entregable,
   y referencia a `docs/01-modelo-datos-nucleo.md`.
2. **Tests primero en el núcleo.** En Fase 1, pedir primero los tests de invariantes y
   luego la implementación que los pone en verde.
3. **Cerrar cada sesión con:** `npm test` en verde, migraciones aplicadas desde cero
   (`migrate reset && migrate up`), y un commit con mensaje descriptivo.
4. **No avanzar de fase con tests rojos o invariantes sin cubrir.**
5. Ante cualquier duda de diseño, la fuente de verdad es `CLAUDE.md` y
   `docs/01-modelo-datos-nucleo.md`; si algo debe cambiar, se actualiza el documento
   primero y el código después.
