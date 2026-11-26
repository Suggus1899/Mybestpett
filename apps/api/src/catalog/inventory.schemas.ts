import { z } from 'zod';
import { slugSchema } from '../common/slug.js';

export const inventoryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  // Busca por nombre de producto o SKU.
  q: z.string().trim().min(1).max(80).optional(),
  category: slugSchema.optional(),
  // all: todo · out: agotado · low: stock bajo (1..lowThreshold) · in: con stock
  status: z.enum(['all', 'out', 'low', 'in']).default('all'),
  lowThreshold: z.coerce.number().int().min(1).max(1000).default(5),
  includeInactive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default(false),
  sort: z.enum(['stock_asc', 'stock_desc', 'name']).default('stock_asc'),
});

export type InventoryQuery = z.infer<typeof inventoryQuerySchema>;
