import { z } from 'zod';
import { usdCentsSchema } from '../common/money.js';
import { VE_STATES } from '../common/venezuela.js';

const notEmpty = (v: object) => Object.keys(v).length > 0;
const nothingToUpdate = 'Nada que actualizar';

const zoneFields = z.object({
  name: z.string().trim().min(1).max(80),
  states: z
    .array(z.enum(VE_STATES, 'Estado inválido'))
    .min(1, 'Elige al menos un estado')
    .max(VE_STATES.length)
    .refine((s) => new Set(s).size === s.length, 'Hay estados repetidos'),
  carrier: z.string().trim().min(1).max(80),
  priceUsdCents: usdCentsSchema.max(100_000), // hasta 1.000 $
  freeOverUsdCents: usdCentsSchema, // desde este subtotal el envío es gratis
  isActive: z.boolean(),
  sortOrder: z.number().int().min(0).max(10_000),
});

export const createZoneSchema = zoneFields.extend({
  freeOverUsdCents: zoneFields.shape.freeOverUsdCents.default(2500),
  isActive: z.boolean().default(true),
  sortOrder: zoneFields.shape.sortOrder.default(0),
});
export const updateZoneSchema = zoneFields
  .partial()
  .refine(notEmpty, nothingToUpdate);

// El código y la moneda de un método son fijos; se editan los datos para pagar.
export const updatePaymentMethodSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    instructions: z.string().trim().min(1).max(1000),
    isActive: z.boolean(),
    sortOrder: z.number().int().min(0).max(10_000),
  })
  .partial()
  .refine(notEmpty, nothingToUpdate);

export type CreateZoneDto = z.infer<typeof createZoneSchema>;
export type UpdateZoneDto = z.infer<typeof updateZoneSchema>;
export type UpdatePaymentMethodDto = z.infer<typeof updatePaymentMethodSchema>;
