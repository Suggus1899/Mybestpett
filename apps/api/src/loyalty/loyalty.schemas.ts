import { z } from 'zod';
import { paginationShape } from '../common/pagination.js';
import { REDEEM_STEP } from './points.js';

export const listPointsSchema = z.object({ ...paginationShape });

export const adjustPointsSchema = z.object({
  delta: z
    .number()
    .int('Los puntos son enteros')
    .min(-1_000_000)
    .max(1_000_000)
    .refine((n) => n !== 0, 'El ajuste no puede ser 0'),
  note: z.string().trim().min(5, 'Explica el motivo del ajuste').max(200),
});

export const redeemPointsSchema = z
  .number()
  .int('Los puntos son enteros')
  .min(0)
  .max(10_000_000)
  .refine(
    (n) => n % REDEEM_STEP === 0,
    `Los puntos se canjean de ${REDEEM_STEP} en ${REDEEM_STEP}`,
  );

export type ListPointsQuery = z.infer<typeof listPointsSchema>;
export type AdjustPointsDto = z.infer<typeof adjustPointsSchema>;
