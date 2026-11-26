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

export interface ComboRule {
  id: string;
  name: string;
  priceUsdCents: number;
  items: { variantId: string; quantity: number; unitPriceUsdCents: number }[];
}

export interface AppliedCombo {
  comboId: string;
  name: string;
  count: number;
  savingsUsdCents: number;
}

// Cuántos combos completos hay en el carrito y cuánto ahorran. Una unidad
// cuenta para un solo combo: primero se arman los que más ahorran.
// El ahorro usa el precio actual de cada presentación; si el combo no sale
// más barato que comprar por separado, no se aplica.
export function comboDiscounts(
  cart: Map<string, number>, // variantId → unidades
  combos: ComboRule[],
): AppliedCombo[] {
  const left = new Map(cart);
  const saving = (c: ComboRule) =>
    c.items.reduce((n, i) => n + i.unitPriceUsdCents * i.quantity, 0) -
    c.priceUsdCents;
  const applied: AppliedCombo[] = [];
  for (const combo of [...combos].sort((a, b) => saving(b) - saving(a))) {
    const each = saving(combo);
    if (each <= 0 || combo.items.length === 0) continue;
    const count = Math.min(
      ...combo.items.map((i) =>
        Math.floor((left.get(i.variantId) ?? 0) / i.quantity),
      ),
    );
    if (count <= 0) continue;
    for (const i of combo.items) {
      left.set(i.variantId, left.get(i.variantId)! - i.quantity * count);
    }
    applied.push({
      comboId: combo.id,
      name: combo.name,
      count,
      savingsUsdCents: each * count,
    });
  }
  return applied;
}

export interface CouponRule {
  type: 'PERCENT' | 'FIXED';
  value: number;
  maxDiscountUsdCents: number | null;
}

// Descuento del cupón sobre lo que queda de los productos tras los combos.
// Nunca deja los productos en negativo; el porcentaje se redondea hacia abajo.
export function couponDiscount(baseUsdCents: number, coupon: CouponRule) {
  const raw =
    coupon.type === 'PERCENT'
      ? Math.floor((baseUsdCents * coupon.value) / 100)
      : coupon.value;
  const capped =
    coupon.maxDiscountUsdCents === null
      ? raw
      : Math.min(raw, coupon.maxDiscountUsdCents);
  return Math.max(0, Math.min(capped, baseUsdCents));
}

// Parte del reembolso de unos productos cuando el pedido tuvo descuentos:
// se devuelve lo que se pagó por ellos, no el precio de lista.
export function discountedShare(
  listUsdCents: number,
  order: {
    subtotalUsdCents: number;
    comboDiscountUsdCents: number;
    couponDiscountUsdCents: number;
  },
) {
  const discount = order.comboDiscountUsdCents + order.couponDiscountUsdCents;
  if (discount === 0 || order.subtotalUsdCents === 0) return listUsdCents;
  return Math.floor(
    (listUsdCents * (order.subtotalUsdCents - discount)) /
      order.subtotalUsdCents,
  );
}
