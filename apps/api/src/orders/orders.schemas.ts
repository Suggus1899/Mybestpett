import { z } from 'zod';
import { paginationShape } from '../common/pagination.js';
import { OrderStatus, PaymentStatus } from '../generated/prisma/enums.js';

const id = z.uuid('Id inválido');

export const checkoutSchema = z.object({
  addressId: id,
  shippingZoneId: id,
  paymentMethodId: id,
  acceptTerms: z.literal(true, 'Debes aceptar los términos y condiciones'),
});

// Lo que el cliente declara haber pagado. El equipo lo compara con el banco.
export const reportPaymentSchema = z.object({
  // Se normaliza: sin espacios y en mayúsculas, para detectar repeticiones.
  reference: z
    .string()
    .transform((v) => v.replace(/\s+/g, '').toUpperCase())
    .pipe(
      z
        .string()
        .regex(
          /^[A-Z0-9-]{4,40}$/,
          'Referencia inválida: de 4 a 40 letras, números o guiones',
        ),
    ),
  originBank: z.string().trim().max(80).optional(),
  amount: z
    .string()
    .trim()
    .regex(
      /^\d{1,12}(\.\d{1,2})?$/,
      'Monto inválido: usa punto y hasta 2 decimales',
    )
    .refine((v) => Number(v) > 0, 'El monto debe ser mayor que cero'),
  paidAt: z.iso.datetime({ offset: true, error: 'Fecha y hora inválidas' }),
});

export const rejectPaymentSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, 'Explica el motivo (mínimo 5 caracteres)')
    .max(300),
});

export const cancelOrderSchema = rejectPaymentSchema;

// Avance del pedido tras el pago. Enviar exige el número de guía.
export const advanceOrderSchema = z.discriminatedUnion(
  'status',
  [
    z.object({
      status: z.literal('PREPARING'),
      note: z.string().trim().max(300).optional(),
    }),
    z.object({
      status: z.literal('SHIPPED'),
      carrier: z.string().trim().min(1).max(80).optional(),
      trackingCode: z.string().trim().min(3, 'Número de guía inválido').max(60),
      note: z.string().trim().max(300).optional(),
    }),
    z.object({
      status: z.literal('DELIVERED'),
      note: z.string().trim().max(300).optional(),
    }),
  ],
  'Estado inválido',
);

export const listMyOrdersSchema = z.object(paginationShape);

export const listOrdersManageSchema = z.object({
  ...paginationShape,
  status: z.enum(OrderStatus).optional(),
  q: z.string().trim().max(80).optional(), // código del pedido o correo
});

export const listPaymentsSchema = z.object({
  ...paginationShape,
  status: z.enum(PaymentStatus).default('REPORTED'),
});

export type CheckoutDto = z.infer<typeof checkoutSchema>;
export type ReportPaymentDto = z.infer<typeof reportPaymentSchema>;
export type RejectPaymentDto = z.infer<typeof rejectPaymentSchema>;
export type CancelOrderDto = z.infer<typeof cancelOrderSchema>;
export type AdvanceOrderDto = z.infer<typeof advanceOrderSchema>;
export type ListMyOrdersQuery = z.infer<typeof listMyOrdersSchema>;
export type ListOrdersManageQuery = z.infer<typeof listOrdersManageSchema>;
export type ListPaymentsQuery = z.infer<typeof listPaymentsSchema>;
