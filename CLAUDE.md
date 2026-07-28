# CLAUDE.md — ERP Financiero y Administrativo

Sistema ERP financiero para pymes (con arquitectura preparada para escalar a empresas
grandes), inspirado en los principios de diseño de SAP: principio del documento,
partida doble automática, integración por determinación de cuentas y configuración
sobre código.

## Documentos de referencia (fuente de verdad)

- `docs/01-modelo-datos-nucleo.md` — modelo de datos del núcleo contable e invariantes.
- `docs/02-plan-construccion.md` — fases, entregables y criterios de salida.

Si el código y estos documentos entran en conflicto, los documentos mandan. Si un
cambio de diseño es necesario, **actualiza el documento primero** y luego el código.

## Stack

- Node.js + TypeScript (strict). API REST con Fastify.
- PostgreSQL 16. Migraciones versionadas; nunca modificar una migración ya aplicada.
- Tests con Vitest. Docker Compose para la BD local.
- Frontend (desde Fase 2): React + Vite.

## Reglas de dominio — NUNCA romper

1. **Todo pasa por el ledger.** Ningún módulo inserta en `documento` / `linea_documento`
   directamente: siempre a través de `ContabilizacionService`.
2. **Inmutabilidad.** Un documento `contabilizado` jamás se actualiza ni se borra.
   Correcciones = storno (documento inverso vinculado) + documento nuevo.
3. **Partida doble.** Todo documento contabilizado cuadra: Σ debe = Σ haber, en moneda
   de documento y en moneda local.
4. **Períodos.** Solo se contabiliza en períodos abiertos. Cerrar/abrir períodos es
   acción explícita y auditada.
5. **Saldos derivados.** Ninguna tabla de saldos es fuente de verdad; los saldos se
   calculan desde las líneas de documento.
6. **Determinación de cuentas.** Los módulos operativos no conocen números de cuenta:
   resuelven cuentas vía `regla_determinacion_cuenta` e `indicador_impuesto`.
7. **Numeración correlativa** sin huecos por sociedad + tipo de documento + ejercicio,
   asignada dentro de la transacción de contabilización.
8. **Defensa en profundidad.** Las reglas 2 y 3 se validan en el servicio **y** se
   refuerzan con triggers/constraints en PostgreSQL.
9. **Montos:** `NUMERIC(15,2)` para importes, `NUMERIC(15,6)` para tipos de cambio.
   Prohibido usar float para dinero, también en TypeScript (usar enteros en centavos
   o una librería decimal en la capa de aplicación).
10. **Auditoría:** contabilizar, stornar, cerrar períodos y cambiar configuración
    escriben en `audit_log` (usuario, timestamp, snapshot del cambio).

## Convenciones de código

- Idioma del dominio: **español** (tablas, entidades, servicios: `documento`,
  `ContabilizacionService`, `tercero`). Infraestructura genérica en inglés está bien.
- Servicios de dominio puros y testeables; la capa HTTP solo traduce request/response.
- Toda operación de contabilización es una transacción de BD atómica.
- Errores de dominio tipados (ej. `PeriodoCerradoError`, `DocumentoDescuadradoError`)
  con mensajes en español orientados al usuario contable.

## Flujo de trabajo

- Trabajar la fase indicada por el usuario según `docs/02-plan-construccion.md`;
  no adelantar funcionalidad de fases futuras.
- En el núcleo: primero los tests de invariantes, luego la implementación.
- Antes de dar por terminada una tarea: `npm run lint`, `npm test` en verde y
  migraciones aplicables desde base de datos vacía.
- Commits pequeños con mensajes descriptivos en español.
