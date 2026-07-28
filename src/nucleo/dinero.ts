import { Decimal } from "decimal.js";

/**
 * Nunca usar `number` para dinero (CLAUDE.md regla 9). Toda cifra monetaria
 * viaja como string decimal de aquí en adelante; Postgres NUMERIC también
 * entra y sale como string a través de `pg`.
 */

export function aMonto(valor: string | number): Decimal {
  return new Decimal(valor);
}

export function formatearMonto(valor: Decimal | string | number): string {
  return new Decimal(valor).toFixed(2);
}

export function formatearTipoCambio(valor: Decimal | string | number): string {
  return new Decimal(valor).toFixed(6);
}

export function sumar(valores: Array<string | number>): Decimal {
  return valores.reduce((acc: Decimal, v) => acc.plus(v), new Decimal(0));
}
