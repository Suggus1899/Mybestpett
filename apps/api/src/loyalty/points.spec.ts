import { pointsEarned, proportionalPoints } from './points.js';

describe('pointsEarned', () => {
  const base = {
    subtotalUsdCents: 0,
    comboDiscountUsdCents: 0,
    couponDiscountUsdCents: 0,
    pointsDiscountUsdCents: 0,
  };
  it('un punto por dólar completo pagado en productos', () => {
    expect(pointsEarned({ ...base, subtotalUsdCents: 2599 })).toBe(25);
  });
  it('no cuenta descuentos ni lo pagado con puntos', () => {
    expect(
      pointsEarned({
        subtotalUsdCents: 5000,
        comboDiscountUsdCents: 600,
        couponDiscountUsdCents: 400,
        pointsDiscountUsdCents: 1000,
      }),
    ).toBe(30);
  });
  it('nunca es negativo', () => {
    expect(pointsEarned({ ...base, subtotalUsdCents: 50 })).toBe(0);
  });
});

describe('proportionalPoints', () => {
  it('reparte según el precio de lista devuelto', () => {
    expect(proportionalPoints(300, 1000, 4000)).toBe(75);
    expect(proportionalPoints(0, 1000, 4000)).toBe(0);
  });
});
