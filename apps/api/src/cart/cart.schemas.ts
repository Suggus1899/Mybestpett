import { z } from 'zod';

export const MAX_QUANTITY = 20; // por presentación
export const MAX_LINES = 50;

const quantity = z
  .number()
  .int('La cantidad debe ser un número entero')
  .min(1, 'La cantidad mínima es 1')
  .max(MAX_QUANTITY, `La cantidad máxima es ${MAX_QUANTITY}`);

export const addItemSchema = z.object({
  variantId: z.uuid('Id inválido'),
  quantity: quantity.default(1),
});
export const setQuantitySchema = z.object({ quantity });

export type AddItemDto = z.infer<typeof addItemSchema>;
export type SetQuantityDto = z.infer<typeof setQuantitySchema>;
