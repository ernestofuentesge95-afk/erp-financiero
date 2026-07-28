import { Decimal } from "decimal.js";

/** Igual que el backend (CLAUDE.md regla 9): nunca float para dinero, ni siquiera en previews del UI. */

export function aMonto(valor: string | number): Decimal {
  return new Decimal(valor || 0);
}

export function formatearMonto(valor: Decimal | string | number): string {
  return new Decimal(valor || 0).toFixed(2);
}

export function sumar(valores: Array<string | number>): Decimal {
  return valores.reduce((acc: Decimal, v) => acc.plus(v || 0), new Decimal(0));
}

const formateadorVisual = new Intl.NumberFormat("es-SV", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Para mostrar en pantalla con separador de miles: $1,130.00. */
export function formatearVisual(valor: Decimal | string | number): string {
  return `$${formateadorVisual.format(new Decimal(valor || 0).toNumber())}`;
}
