import type { Currency } from '../generated/prisma/enums.js';

// Textos de los correos al cliente. Texto plano: se lee bien en cualquier
// cliente de correo y no hay HTML que escapar.

export interface Email {
  subject: string;
  text: string;
}

const number = new Intl.NumberFormat('es-VE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const dateTime = new Intl.DateTimeFormat('es-VE', {
  timeZone: 'America/Caracas',
  dateStyle: 'long',
  timeStyle: 'short',
});

export function money(amount: { toString(): string }, currency: Currency) {
  const value = number.format(Number(amount.toString()));
  switch (currency) {
    case 'USD':
      return `$${value}`;
    case 'VES':
      return `Bs. ${value}`;
    case 'EUR':
      return `${value} €`;
    case 'USDT':
      return `${value} USDT`;
  }
}

export function when(date: Date) {
  return dateTime.format(date);
}

export interface OrderInfo {
  code: string;
  firstName: string;
  url: string; // enlace al pedido en la tienda
  total: string; // monto ya formateado en la moneda del pedido
  methodName: string;
}

const sign = '\n\nEquipo Petbf';

function body(order: OrderInfo, ...lines: string[]) {
  return `Hola, ${order.firstName}:\n\n${lines.join('\n\n')}\n\nVer el pedido: ${order.url}${sign}`;
}

export const templates = {
  orderCreated: (o: OrderInfo, dueAt: Date, instructions: string): Email => ({
    subject: `Pedido ${o.code}: paga ${o.total} antes de 2 horas`,
    text: body(
      o,
      `Recibimos tu pedido ${o.code}. Para confirmarlo, paga ${o.total} con ${o.methodName} y reporta el pago desde la tienda antes del ${when(dueAt)}.`,
      `Datos para pagar:\n${instructions}`,
      'Si no reportas el pago a tiempo, el pedido se cancela y liberamos los productos.',
    ),
  }),
  subscriptionOrder: (
    o: OrderInfo,
    productName: string,
    dueAt: Date,
    instructions: string,
  ): Email => ({
    subject: `Tu entrega recurrente de ${productName}: pedido ${o.code}`,
    text: body(
      o,
      `Tu suscripción generó el pedido ${o.code} (${productName}). Para confirmarlo, paga ${o.total} con ${o.methodName} y reporta el pago desde la tienda antes del ${when(dueAt)}.`,
      `Datos para pagar:\n${instructions}`,
      'Si no lo pagas a tiempo, este pedido se cancela y la suscripción sigue con la próxima entrega. Puedes pausarla o cancelarla desde Mis suscripciones.',
    ),
  }),
  subscriptionPaused: (
    firstName: string,
    productName: string,
    reason: string,
    url: string,
  ): Email => ({
    subject: `Pausamos tu suscripción de ${productName}`,
    text: `Hola, ${firstName}:\n\nNo pudimos crear tus últimos pedidos de ${productName} y pausamos la suscripción. Motivo: ${reason}\n\nCuando lo resuelvas, reanúdala desde Mis suscripciones: ${url}${sign}`,
  }),
  paymentVerified: (o: OrderInfo): Email => ({
    subject: `Pedido ${o.code}: pago confirmado`,
    text: body(
      o,
      `Confirmamos tu pago de ${o.total}. Ya estamos preparando tu pedido ${o.code}.`,
    ),
  }),
  paymentRejected: (o: OrderInfo, reason: string, dueAt: Date): Email => ({
    subject: `Pedido ${o.code}: no pudimos confirmar tu pago`,
    text: body(
      o,
      `No pudimos confirmar el pago que reportaste. Motivo: ${reason}`,
      `Puedes revisarlo y reportarlo de nuevo antes del ${when(dueAt)}.`,
    ),
  }),
  shipped: (
    o: OrderInfo,
    carrier: string,
    trackingCode: string | null,
  ): Email => ({
    subject: `Pedido ${o.code}: va en camino`,
    text: body(
      o,
      `Tu pedido ${o.code} salió con ${carrier}${trackingCode ? `, guía ${trackingCode}` : ''}.`,
    ),
  }),
  delivered: (o: OrderInfo, returnUntil: Date): Email => ({
    subject: `Pedido ${o.code}: entregado`,
    text: body(
      o,
      `Tu pedido ${o.code} figura como entregado. ¡Gracias por comprar en Petbf!`,
      `Si algo no salió bien, puedes pedir una devolución hasta el ${when(returnUntil)}. El alimento y los productos de higiene no se devuelven.`,
    ),
  }),
  cancelled: (o: OrderInfo, reason: string | null): Email => ({
    subject: `Pedido ${o.code}: cancelado`,
    text: body(
      o,
      `Tu pedido ${o.code} se canceló.${reason ? ` Motivo: ${reason}` : ''}`,
    ),
  }),
  returnApproved: (o: OrderInfo, note: string | null): Email => ({
    subject: `Pedido ${o.code}: devolución aprobada`,
    text: body(
      o,
      'Aprobamos tu devolución. Cuando recibamos el producto, te devolvemos el dinero por el mismo método de pago.',
      ...(note ? [`Indicaciones: ${note}`] : []),
    ),
  }),
  returnRejected: (o: OrderInfo, reason: string): Email => ({
    subject: `Pedido ${o.code}: devolución rechazada`,
    text: body(o, `No pudimos aceptar tu devolución. Motivo: ${reason}`),
  }),
  returnRefunded: (o: OrderInfo, amount: string, reference: string): Email => ({
    subject: `Pedido ${o.code}: te devolvimos ${amount}`,
    text: body(
      o,
      `Te devolvimos ${amount} por ${o.methodName}. Referencia: ${reference}.`,
    ),
  }),
};
