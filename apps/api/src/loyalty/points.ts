// Reglas del programa de puntos (pedido de Gus, 2026-11-26):
// se gana 1 punto por cada dólar pagado en productos y 100 puntos valen 1 $.
export const POINT_VALUE_CENTS = 1; // 100 puntos = 100 centavos
export const REDEEM_STEP = 100; // se canjean de 100 en 100

// Puntos que gana un pedido: por lo pagado en productos (sin envío y sin lo
// que se pagó con puntos), un punto por dólar completo.
export function pointsEarned(order: {
  subtotalUsdCents: number;
  comboDiscountUsdCents: number;
  couponDiscountUsdCents: number;
  pointsDiscountUsdCents: number;
}) {
  const paid =
    order.subtotalUsdCents -
    order.comboDiscountUsdCents -
    order.couponDiscountUsdCents -
    order.pointsDiscountUsdCents;
  return Math.max(0, Math.floor(paid / 100));
}

// Parte proporcional de un total de puntos para unos productos devueltos.
export function proportionalPoints(
  points: number,
  listUsdCents: number,
  subtotalUsdCents: number,
) {
  if (points === 0 || subtotalUsdCents === 0) return 0;
  return Math.floor((points * listUsdCents) / subtotalUsdCents);
}
