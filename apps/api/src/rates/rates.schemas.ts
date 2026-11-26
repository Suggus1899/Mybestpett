import { z } from 'zod';

// Tasa como texto decimal ("245.6712") para no perder precisión con float.
const rate = z
  .string()
  .trim()
  .regex(
    /^\d{1,12}(\.\d{1,8})?$/,
    'Tasa inválida: usa punto decimal, hasta 8 decimales',
  )
  .refine((v) => Number(v) > 0, 'La tasa debe ser mayor que cero');

// Lo que publica el BCV: bolívares por 1 dólar y por 1 euro, para un día.
export const createRatesSchema = z.object({
  usdVes: rate,
  eurVes: rate.optional(),
  effectiveDate: z.iso.date().optional(), // por defecto, hoy (hora de Caracas)
});

export type CreateRatesDto = z.infer<typeof createRatesSchema>;
