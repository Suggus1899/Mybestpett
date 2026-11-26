import { Prisma } from '../generated/prisma/client.js';
import {
  chargedAmount,
  comboDiscounts,
  couponDiscount,
  discountedShare,
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

describe('comboDiscounts', () => {
  const kit = {
    id: 'kit',
    name: 'Kit baño',
    priceUsdCents: 1500,
    items: [
      { variantId: 'champu', quantity: 1, unitPriceUsdCents: 1000 },
      { variantId: 'toalla', quantity: 1, unitPriceUsdCents: 800 },
    ],
  };
  const duo = {
    id: 'duo',
    name: 'Dos champús',
    priceUsdCents: 1500,
    items: [{ variantId: 'champu', quantity: 2, unitPriceUsdCents: 1000 }],
  };

  it('cuenta los combos completos y su ahorro', () => {
    const cart = new Map([
      ['champu', 3],
      ['toalla', 2],
    ]);
    expect(comboDiscounts(cart, [kit])).toEqual([
      { comboId: 'kit', name: 'Kit baño', count: 2, savingsUsdCents: 600 },
    ]);
  });

  it('no aplica un combo incompleto', () => {
    expect(comboDiscounts(new Map([['champu', 1]]), [kit])).toEqual([]);
  });

  it('una unidad sirve para un solo combo, primero el que más ahorra', () => {
    // duo ahorra 5 $, kit 3 $: con 2 champús y 1 toalla gana duo.
    const cart = new Map([
      ['champu', 2],
      ['toalla', 1],
    ]);
    expect(comboDiscounts(cart, [kit, duo])).toEqual([
      { comboId: 'duo', name: 'Dos champús', count: 1, savingsUsdCents: 500 },
    ]);
    // Con 3 champús sobra uno para el kit.
    const more = new Map([
      ['champu', 3],
      ['toalla', 1],
    ]);
    expect(comboDiscounts(more, [kit, duo]).map((c) => c.comboId)).toEqual([
      'duo',
      'kit',
    ]);
  });

  it('ignora combos que no ahorran (los precios subieron después)', () => {
    const caro = { ...kit, priceUsdCents: 1800 };
    expect(
      comboDiscounts(
        new Map([
          ['champu', 1],
          ['toalla', 1],
        ]),
        [caro],
      ),
    ).toEqual([]);
  });

  it('no modifica el carrito recibido', () => {
    const cart = new Map([
      ['champu', 1],
      ['toalla', 1],
    ]);
    comboDiscounts(cart, [kit]);
    expect(cart.get('champu')).toBe(1);
  });
});

describe('couponDiscount', () => {
  it('porcentaje redondeado hacia abajo', () => {
    expect(
      couponDiscount(1999, {
        type: 'PERCENT',
        value: 10,
        maxDiscountUsdCents: null,
      }),
    ).toBe(199);
  });
  it('respeta el tope del porcentaje', () => {
    expect(
      couponDiscount(10_000, {
        type: 'PERCENT',
        value: 20,
        maxDiscountUsdCents: 1000,
      }),
    ).toBe(1000);
  });
  it('monto fijo sin pasar del total de los productos', () => {
    expect(
      couponDiscount(3000, {
        type: 'FIXED',
        value: 500,
        maxDiscountUsdCents: null,
      }),
    ).toBe(500);
    expect(
      couponDiscount(300, {
        type: 'FIXED',
        value: 500,
        maxDiscountUsdCents: null,
      }),
    ).toBe(300);
  });
});

describe('discountedShare', () => {
  const order = {
    subtotalUsdCents: 4000,
    comboDiscountUsdCents: 500,
    couponDiscountUsdCents: 300,
  };
  it('reparte los descuentos en proporción', () => {
    // Se pagó 3200 de 4000: un producto de 1000 devuelve 800.
    expect(discountedShare(1000, order)).toBe(800);
  });
  it('sin descuentos devuelve el precio de lista', () => {
    expect(
      discountedShare(1000, {
        ...order,
        comboDiscountUsdCents: 0,
        couponDiscountUsdCents: 0,
      }),
    ).toBe(1000);
  });
});
