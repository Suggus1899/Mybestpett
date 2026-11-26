import { z } from 'zod';
import { usdCentsSchema } from '../common/money.js';
import { paginationShape } from '../common/pagination.js';
import { slugSchema } from '../common/slug.js';
import {
  AnimalListingType,
  AnimalStatus,
  Sex,
  Species,
} from '../generated/prisma/enums.js';

const imageSchema = z.object({
  url: z.url({ protocol: /^https$/ }).max(500),
  alt: z.string().trim().min(1).max(160),
});

const fields = z.object({
  name: z.string().trim().min(1).max(80),
  slug: slugSchema.optional(),
  listingType: z.enum(AnimalListingType),
  status: z.enum(AnimalStatus),
  species: z.enum(Species),
  breed: z.string().trim().max(80).nullable().optional(),
  sex: z.enum(Sex),
  birthDate: z.iso
    .date()
    .transform((d) => new Date(`${d}T00:00:00Z`))
    .nullable()
    .optional(),
  description: z.string().trim().min(1).max(5000),
  priceUsdCents: usdCentsSchema.nullable().optional(),
  isVaccinated: z.boolean(),
  isSterilized: z.boolean(),
});

// En venta exige precio; en adopción no se cobra precio de venta.
const priceRule = (v: {
  listingType?: string;
  priceUsdCents?: number | null;
}) =>
  v.listingType === undefined ||
  (v.listingType === 'SALE'
    ? v.priceUsdCents != null && v.priceUsdCents > 0
    : v.priceUsdCents == null);
const priceMessage = {
  message:
    'Un animal en venta necesita precio; uno en adopción no lleva precio',
  path: ['priceUsdCents'],
};

// Los valores por defecto solo al crear: en una edición parcial pisarían
// campos que nadie envió.
export const createAnimalSchema = fields
  .extend({
    status: z.enum(AnimalStatus).default('AVAILABLE'),
    sex: z.enum(Sex).default('UNKNOWN'),
    isVaccinated: z.boolean().default(false),
    isSterilized: z.boolean().default(false),
    images: z.array(imageSchema).max(10).default([]),
  })
  .refine(priceRule, priceMessage);

// El tipo de publicación no cambia después de crearla.
export const updateAnimalSchema = fields
  .omit({ listingType: true })
  .partial()
  .extend({ images: z.array(imageSchema).max(10).optional() })
  .refine((v) => Object.keys(v).length > 0, 'Nada que actualizar');

export const listAnimalsSchema = z.object({
  ...paginationShape,
  listingType: z.enum(AnimalListingType).optional(),
  species: z.enum(Species).optional(),
});

export type CreateAnimalDto = z.infer<typeof createAnimalSchema>;
export type UpdateAnimalDto = z.infer<typeof updateAnimalSchema>;
export type ListAnimalsQuery = z.infer<typeof listAnimalsSchema>;
