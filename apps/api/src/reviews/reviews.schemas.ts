import { z } from 'zod';
import { paginationShape } from '../common/pagination.js';
import { ReviewStatus } from '../generated/prisma/enums.js';

export const upsertReviewSchema = z.object({
  rating: z
    .number('Elige de 1 a 5 estrellas')
    .int('Elige de 1 a 5 estrellas')
    .min(1, 'Elige de 1 a 5 estrellas')
    .max(5, 'Elige de 1 a 5 estrellas'),
  title: z
    .string()
    .trim()
    .max(80, 'El título admite hasta 80 caracteres')
    .optional()
    .transform((v) => v || null),
  body: z
    .string('Cuéntanos tu experiencia')
    .trim()
    .min(10, 'Cuéntanos un poco más (mínimo 10 caracteres)')
    .max(1000, 'La reseña admite hasta 1000 caracteres'),
});

export const listReviewsSchema = z.object({
  ...paginationShape,
  sort: z.enum(['recent', 'best', 'worst']).default('recent'),
});

export const listReviewsManageSchema = z.object({
  ...paginationShape,
  status: z.enum(ReviewStatus).optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
});

export const moderateReviewSchema = z.discriminatedUnion(
  'status',
  [
    z.object({
      status: z.literal('HIDDEN'),
      reason: z
        .string()
        .trim()
        .min(5, 'Explica el motivo (mínimo 5 caracteres)')
        .max(300),
    }),
    z.object({ status: z.literal('VISIBLE') }),
  ],
  'Estado inválido',
);

export type UpsertReviewDto = z.infer<typeof upsertReviewSchema>;
export type ListReviewsQuery = z.infer<typeof listReviewsSchema>;
export type ListReviewsManageQuery = z.infer<typeof listReviewsManageSchema>;
export type ModerateReviewDto = z.infer<typeof moderateReviewSchema>;
