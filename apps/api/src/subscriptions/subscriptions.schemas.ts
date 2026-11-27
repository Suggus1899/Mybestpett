import { z } from 'zod';
import { paginationShape } from '../common/pagination.js';

export const MIN_INTERVAL_DAYS = 7;
export const MAX_INTERVAL_DAYS = 90;
export const MAX_FAILURES = 3; // intentos fallidos seguidos antes de pausar

const fields = {
  quantity: z
    .number()
    .int('La cantidad debe ser un número entero')
    .min(1, 'La cantidad mínima es 1')
    .max(10, 'La cantidad máxima es 10'),
  intervalDays: z
    .number()
    .int('Los días deben ser un número entero')
    .min(MIN_INTERVAL_DAYS, `Mínimo cada ${MIN_INTERVAL_DAYS} días`)
    .max(MAX_INTERVAL_DAYS, `Máximo cada ${MAX_INTERVAL_DAYS} días`),
  addressId: z.uuid('Id inválido'),
  shippingZoneId: z.uuid('Id inválido'),
  paymentMethodId: z.uuid('Id inválido'),
};

export const createSubscriptionSchema = z.object({
  variantId: z.uuid('Id inválido'),
  ...fields,
});

export const updateSubscriptionSchema = z
  .object(fields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'No hay cambios');

export const listSubscriptionsSchema = z.object({ ...paginationShape });

export type CreateSubscriptionDto = z.infer<typeof createSubscriptionSchema>;
export type UpdateSubscriptionDto = z.infer<typeof updateSubscriptionSchema>;
export type ListSubscriptionsQuery = z.infer<typeof listSubscriptionsSchema>;
