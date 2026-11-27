import { z } from 'zod';
import { usdCentsSchema } from '../common/money.js';
import { paginationShape } from '../common/pagination.js';
import { slugSchema } from '../common/slug.js';
import { Species } from '../generated/prisma/enums.js';

const name = z.string().trim().min(1).max(120);
const imageSchema = z.object({
  url: z.url({ protocol: /^https$/ }).max(500),
  alt: z.string().trim().min(1).max(160),
});

// Importante: los valores por defecto van solo en los esquemas de creación.
// En una edición parcial, un default rellenaría campos que nadie envió
// (por ejemplo pondría el stock a 0 al cambiar solo el precio).
const notEmpty = (v: object) => Object.keys(v).length > 0;
const nothingToUpdate = 'Nada que actualizar';

// ---------- Categorías y marcas ----------

const categoryFields = z.object({
  name,
  slug: slugSchema,
  parentId: z.uuid().nullable(),
  sortOrder: z.number().int().min(0).max(10_000),
  isActive: z.boolean(),
});

export const createCategorySchema = categoryFields.extend({
  slug: slugSchema.optional(),
  parentId: z.uuid().nullable().optional(),
  sortOrder: categoryFields.shape.sortOrder.default(0),
  isActive: z.boolean().default(true),
});
export const updateCategorySchema = categoryFields
  .partial()
  .refine(notEmpty, nothingToUpdate);

export const createBrandSchema = z.object({
  name,
  slug: slugSchema.optional(),
});

// ---------- Productos ----------

const variantFields = z.object({
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{2,40}$/, 'SKU inválido: letras, números y guiones'),
  name: z.string().trim().min(1).max(80),
  priceUsdCents: usdCentsSchema,
  compareAtUsdCents: usdCentsSchema.nullable(),
  stock: z.number().int().min(0).max(1_000_000),
  isActive: z.boolean(),
});

const offerIsHigher = (v: {
  priceUsdCents?: number;
  compareAtUsdCents?: number | null;
}) =>
  v.compareAtUsdCents == null ||
  v.priceUsdCents == null ||
  v.compareAtUsdCents > v.priceUsdCents;
const offerMessage = {
  message: 'El precio anterior debe ser mayor que el precio actual',
  path: ['compareAtUsdCents'],
};

export const createVariantSchema = variantFields
  .extend({
    compareAtUsdCents: usdCentsSchema.nullable().optional(),
    stock: variantFields.shape.stock.default(0),
    isActive: z.boolean().default(true),
  })
  .refine(offerIsHigher, offerMessage);

export const updateVariantSchema = variantFields
  .omit({ sku: true })
  .partial()
  .refine(notEmpty, nothingToUpdate)
  .refine(offerIsHigher, offerMessage);

const productFields = z.object({
  name,
  slug: slugSchema,
  description: z.string().trim().min(1).max(5000),
  categoryId: z.uuid(),
  brandId: z.uuid().nullable(),
  species: z.array(z.enum(Species)).max(7),
  // false para alimento e higiene: no se aceptan devoluciones una vez abiertos.
  isReturnable: z.boolean(),
  // Se puede pedir con entrega recurrente (alimento, arena…).
  subscribable: z.boolean(),
  isActive: z.boolean(),
});

export const createProductSchema = productFields.extend({
  slug: slugSchema.optional(),
  brandId: z.uuid().nullable().optional(),
  species: productFields.shape.species.default([]),
  isReturnable: z.boolean().default(true),
  subscribable: z.boolean().default(false),
  isActive: z.boolean().default(true),
  variants: z.array(createVariantSchema).min(1).max(30),
  images: z.array(imageSchema).max(10).default([]),
});

export const updateProductSchema = productFields
  .partial()
  .refine(notEmpty, nothingToUpdate);

export const setImagesSchema = z.object({
  images: z.array(imageSchema).max(10),
});

const booleanQuery = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();

export const listProductsSchema = z.object({
  ...paginationShape,
  category: slugSchema.optional(),
  species: z.enum(Species).optional(),
  q: z.string().trim().min(2).max(80).optional(),
  onSale: booleanQuery,
  sort: z.enum(['newest', 'name']).default('newest'),
});

export const listProductsManageSchema = listProductsSchema.extend({
  active: booleanQuery,
});

export type CreateCategoryDto = z.infer<typeof createCategorySchema>;
export type UpdateCategoryDto = z.infer<typeof updateCategorySchema>;
export type CreateBrandDto = z.infer<typeof createBrandSchema>;
export type CreateVariantDto = z.infer<typeof createVariantSchema>;
export type UpdateVariantDto = z.infer<typeof updateVariantSchema>;
export type CreateProductDto = z.infer<typeof createProductSchema>;
export type UpdateProductDto = z.infer<typeof updateProductSchema>;
export type SetImagesDto = z.infer<typeof setImagesSchema>;
export type ListProductsQuery = z.infer<typeof listProductsSchema>;
export type ListProductsManageQuery = z.infer<typeof listProductsManageSchema>;
