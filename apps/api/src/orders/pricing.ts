import { Prisma } from '../generated/prisma/client.js';
import type { Currency } from '../generated/prisma/enums.js';

type Decimal = Prisma.Decimal;
export const PAYMENT_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 horas para reportar el pago
export const RETURN_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3 días desde la entrega

export interface FrozenRates {
  usdVes: Decimal | null; // Bs por 1 USD
  eurVes: Decimal | null; // Bs por 1 EUR
}

export class MissingRateError extends Error {}

// Monto exacto a cobrar en la moneda del método de pago, redondeado a céntimos.
// Bs = USD × tasa del dólar; euros = USD × tasa del dólar ÷ tasa del euro.
// USDT se cobra 1:1 con el dólar.
export function chargedAmount(
  usdCents: number,
  currency: Currency,
  rates: FrozenRates,
): Decimal {
  const usd = new Prisma.Decimal(usdCents).div(100);
  let amount: Decimal;
  switch (currency) {
    case 'USD':
    case 'USDT':
      amount = usd;
      break;
    case 'VES':
      if (!rates.usdVes) throw new MissingRateError('USD');
      amount = usd.mul(rates.usdVes);
      break;
    case 'EUR':
      if (!rates.usdVes || !rates.eurVes) throw new MissingRateError('EUR');
      amount = usd.mul(rates.usdVes).div(rates.eurVes);
      break;
  }
  return amount.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

// Envío gratis cuando el subtotal llega al mínimo de la zona (25 $ por defecto).
export function shippingCost(
  subtotalUsdCents: number,
  zone: { priceUsdCents: number; freeOverUsdCents: number | null },
): number {
  if (
    zone.freeOverUsdCents !== null &&
    subtotalUsdCents >= zone.freeOverUsdCents
  ) {
    return 0;
  }
  return zone.priceUsdCents;
}

export function orderCode(number: number): string {
  return `PB-${String(number).padStart(6, '0')}`;
}

// Acepta "PB-000123", "pb123" o "123".
export function parseOrderCode(text: string): number | null {
  const match = /^(?:PB-?)?0*(\d{1,9})$/i.exec(text.trim());
  return match ? Number(match[1]) : null;
}
