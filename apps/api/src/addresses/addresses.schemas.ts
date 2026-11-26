import { z } from 'zod';
import { phoneSchema } from '../auth/auth.schemas.js';
import { VE_STATES } from '../common/venezuela.js';

const text = (max: number) => z.string().trim().min(1).max(max);
// Campo opcional: una cadena vacía se guarda como null.
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable();

const addressFields = z.object({
  recipientName: text(120),
  phone: phoneSchema,
  state: z.enum(VE_STATES, 'Estado inválido'),
  city: text(80),
  municipality: optionalText(80),
  line1: text(200),
  referencePoint: optionalText(200),
  isDefault: z.boolean(),
});

export const createAddressSchema = addressFields.extend({
  municipality: addressFields.shape.municipality.optional(),
  referencePoint: addressFields.shape.referencePoint.optional(),
  isDefault: z.boolean().default(false),
});
export const updateAddressSchema = addressFields
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nada que actualizar');

export type CreateAddressDto = z.infer<typeof createAddressSchema>;
export type UpdateAddressDto = z.infer<typeof updateAddressSchema>;
