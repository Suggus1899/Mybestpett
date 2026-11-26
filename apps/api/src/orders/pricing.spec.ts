import { Prisma } from '../generated/prisma/client.js';
import {
  chargedAmount,
  MissingRateError,
  orderCode,
  parseOrderCode,
  shippingCost,
} from './pricing.js';

const rates = {
  usdVes: new Prisma.Decimal('245.5'),
  eurVes: new Prisma.Decimal('268.1'),
};

describe('chargedAmount', () => {
  it('cobra dólares y USDT sin conversión', () => {
    expect(chargedAmount(1450, 'USD', rates).toString()).toBe('14.5');
    expect(chargedAmount(1450, 'USDT', rates).toString()).toBe('14.5');
  });

  it('convierte a bolívares con la tasa del dólar', () => {
    // 14,50 × 245,50 = 3.559,75
    expect(chargedAmount(1450, 'VES', rates).toFixed(2)).toBe('3559.75');
  });

  it('convierte a euros con el cruce de las dos tasas y redondea', () => {
    // 14,50 × 245,50 ÷ 268,10 = 13,2777… → 13,28
    expect(chargedAmount(1450, 'EUR', rates).toFixed(2)).toBe('13.28');
  });

  it('redondea la mitad hacia arriba', () => {
    const r = { usdVes: new Prisma.Decimal('0.125'), eurVes: null };
    expect(chargedAmount(100, 'VES', r).toFixed(2)).toBe('0.13');
  });

  it('exige la tasa que necesita', () => {
    expect(() =>
      chargedAmount(100, 'VES', { usdVes: null, eurVes: null }),
    ).toThrow(MissingRateError);
    expect(() =>
      chargedAmount(100, 'EUR', { usdVes: rates.usdVes, eurVes: null }),
    ).toThrow(MissingRateError);
    expect(
      chargedAmount(100, 'USD', { usdVes: null, eurVes: null }).toString(),
    ).toBe('1');
  });
});

describe('shippingCost', () => {
  const zone = { priceUsdCents: 500, freeOverUsdCents: 2500 };
  it('es gratis desde 25 $ exactos', () => {
    expect(shippingCost(2499, zone)).toBe(500);
    expect(shippingCost(2500, zone)).toBe(0);
  });
  it('sin mínimo, siempre se cobra', () => {
    expect(
      shippingCost(100_000, { priceUsdCents: 500, freeOverUsdCents: null }),
    ).toBe(500);
  });
});

describe('códigos de pedido', () => {
  it('formatea y lee el número', () => {
    expect(orderCode(123)).toBe('PB-000123');
    expect(parseOrderCode('PB-000123')).toBe(123);
    expect(parseOrderCode(' pb123 ')).toBe(123);
    expect(parseOrderCode('123')).toBe(123);
    expect(parseOrderCode('PB-12a')).toBeNull();
    expect(parseOrderCode('')).toBeNull();
  });
});
