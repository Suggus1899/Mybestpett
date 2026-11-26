import type { Currency, OrderStatus, PaymentStatus } from './api';

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
