import { z } from 'zod';

export const paginationShape = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
};

export function paginate(page: number, pageSize: number) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}

export function paged<T>(
  items: T[],
  total: number,
  page: number,
  pageSize: number,
) {
  return { items, total, page, pageSize };
}
