import type { Currency, Order, OrderStatus, PaymentStatus, ReturnStatus } from './api';

// Textos del estado del pedido para el cliente y el equipo.
export const orderStatusLabel: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Esperando el pago',
  PAYMENT_REPORTED: 'Pago en revisión',
  PAID: 'Pagado',
  PREPARING: 'En preparación',
  SHIPPED: 'Enviado',
  DELIVERED: 'Entregado',
  CANCELLED: 'Cancelado',
  REFUNDED: 'Reembolsado',
};

export const orderStatusClass: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'bg-amber/25 text-ink',
  PAYMENT_REPORTED: 'bg-amber/25 text-ink',
  PAID: 'bg-petbf-soft text-petbf-dark',
  PREPARING: 'bg-petbf-soft text-petbf-dark',
  SHIPPED: 'bg-petbf-soft text-petbf-dark',
  DELIVERED: 'bg-petbf text-white',
  CANCELLED: 'bg-red-50 text-danger',
  REFUNDED: 'bg-mist text-slate',
};

export const paymentStatusLabel: Record<PaymentStatus, string> = {
  REPORTED: 'En revisión',
  VERIFIED: 'Verificado',
  REJECTED: 'Rechazado',
};

export const returnStatusLabel: Record<ReturnStatus, string> = {
  REQUESTED: 'En revisión',
  APPROVED: 'Aprobada',
  REJECTED: 'Rechazada',
  REFUNDED: 'Reembolsada',
};

// Unidades de cada producto que aún se pueden devolver: las devolvibles menos
// las que ya están en una devolución no rechazada.
export function returnableLeft(order: Order) {
  const taken = new Map<string, number>();
  for (const r of order.returns) {
    if (r.status === 'REJECTED') continue;
    for (const line of r.items) taken.set(line.orderItemId, (taken.get(line.orderItemId) ?? 0) + line.quantity);
  }
  return order.items
    .filter((item) => item.isReturnable)
    .map((item) => ({ item, left: item.quantity - (taken.get(item.id) ?? 0) }))
    .filter((line) => line.left > 0);
}

// Se puede pedir una devolución: dentro del plazo, sin otra abierta y con algo por devolver.
export function canRequestReturn(order: Order, now = Date.now()) {
  return (
    order.returnUntil !== null &&
    new Date(order.returnUntil).getTime() > now &&
    !order.returns.some((r) => r.status === 'REQUESTED' || r.status === 'APPROVED') &&
    returnableLeft(order).length > 0
  );
}

export const ORDER_STATUSES = Object.keys(orderStatusLabel) as OrderStatus[];

// Monto en la moneda del método con las tasas dadas, como en la API:
// Bs = USD × tasa del dólar; euros = USD × tasa del dólar ÷ tasa del euro.
// Solo orienta en el checkout: el monto exacto lo calcula y congela la API.
export function estimateCharge(
  usdCents: number,
  currency: Currency,
  usdVes: string | null,
  eurVes: string | null,
): string | null {
  const usd = usdCents / 100;
  if (currency === 'USD' || currency === 'USDT') return usd.toFixed(2);
  if (!usdVes) return null;
  if (currency === 'VES') return (usd * Number(usdVes)).toFixed(2);
  if (!eurVes) return null;
  return ((usd * Number(usdVes)) / Number(eurVes)).toFixed(2);
}
