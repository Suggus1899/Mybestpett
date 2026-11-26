import { z } from 'zod';
import { paginationShape } from '../common/pagination.js';
import { usdCentsSchema } from '../common/money.js';
import { slugSchema } from '../common/slug.js';

// "verano-10 " -> "VERANO-10". Letras, números y guiones.
export const couponCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[A-Z0-9][A-Z0-9-]{2,29}$/,
    'El cupón tiene de 3 a 30 letras, números o guiones',
  );

const date = z.coerce.date('Fecha inválida');
const positiveCents = usdCentsSchema.min(1, 'Debe ser mayor que 0');

const couponLimits = {
  description: z.string().trim().min(3, 'Describe el cupón').max(160),
  minSubtotalUsdCents: usdCentsSchema.default(0),
  maxDiscountUsdCents: positiveCents.nullable().default(null),
  startsAt: date.nullable().default(null),
  endsAt: date.nullable().default(null),
  maxRedemptions: z
    .number()
    .int()
    .min(1, 'Al menos 1 uso')
    .max(1_000_000)
    .nullable()
    .default(null),
  perUserLimit: z
    .number()
    .int()
    .min(1, 'Al menos 1 uso por cliente')
    .max(100)
    .default(1),
  isActive: z.boolean().default(true),
};

function validWindow(
  v: { startsAt?: Date | null; endsAt?: Date | null },
  ctx: z.RefinementCtx,
) {
  if (v.startsAt && v.endsAt && v.endsAt <= v.startsAt) {
    ctx.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: 'El fin debe ser después del inicio',
    });
  }
}

export const createCouponSchema = z
  .object({
    code: couponCodeSchema,
    type: z.enum(['PERCENT', 'FIXED'], 'Elige porcentaje o monto fijo'),
    value: z.number().int().min(1, 'El descuento debe ser mayor que 0'),
    ...couponLimits,
  })
  .superRefine((v, ctx) => {
    if (v.type === 'PERCENT' && v.value > 90) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'El porcentaje máximo es 90 %',
      });
    }
    if (v.type === 'FIXED' && v.value > 100_000_000) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Monto demasiado alto',
      });
    }
    if (v.type === 'FIXED' && v.maxDiscountUsdCents !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxDiscountUsdCents'],
        message: 'El tope es solo para porcentajes',
      });
    }
    validWindow(v, ctx);
  });

// El tipo y el valor no cambian: los pedidos guardan el descuento que
// recibieron, y un cupón distinto se crea con otro código.
export const updateCouponSchema = z
  .object({
    description: couponLimits.description,
    minSubtotalUsdCents: usdCentsSchema,
    maxDiscountUsdCents: positiveCents.nullable(),
    startsAt: date.nullable(),
    endsAt: date.nullable(),
    maxRedemptions: z.number().int().min(1).max(1_000_000).nullable(),
    perUserLimit: z.number().int().min(1).max(100),
    isActive: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'No hay cambios')
  .superRefine(validWindow);

export const listCouponsSchema = z.object({
  ...paginationShape,
  active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const quoteSchema = z.object({ coupon: couponCodeSchema.optional() });

const comboItems = z
  .array(
    z.object({
      // El equipo identifica cada presentación por su SKU.
      sku: z.string().trim().toUpperCase().min(1, 'Falta el SKU').max(40),
      quantity: z
        .number()
        .int()
        .min(1, 'Cantidad mínima 1')
        .max(20, 'Cantidad máxima 20'),
    }),
  )
  .min(1, 'El combo necesita productos')
  .max(10, 'Un combo tiene como máximo 10 productos')
  .superRefine((items, ctx) => {
    if (new Set(items.map((i) => i.sku)).size !== items.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'Hay una presentación repetida: sube su cantidad',
      });
    }
    if (items.reduce((n, i) => n + i.quantity, 0) < 2) {
      ctx.addIssue({
        code: 'custom',
        message: 'Un combo tiene al menos 2 unidades',
      });
    }
  });

export const createComboSchema = z.object({
  name: z.string().trim().min(3, 'Ponle nombre al combo').max(80),
  slug: slugSchema.optional(),
  description: z
    .string()
    .trim()
    .min(10, 'Describe el combo (mínimo 10 caracteres)')
    .max(500),
  priceUsdCents: positiveCents,
  isActive: z.boolean().default(true),
  items: comboItems,
});

export const updateComboSchema = z
  .object({
    name: createComboSchema.shape.name,
    description: createComboSchema.shape.description,
    priceUsdCents: positiveCents,
    isActive: z.boolean(),
    items: comboItems,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'No hay cambios');

export const listCombosManageSchema = z.object({ ...paginationShape });

export const addComboSchema = z.object({
  quantity: z.number().int().min(1).max(5).default(1),
});

export type CreateCouponDto = z.infer<typeof createCouponSchema>;
export type UpdateCouponDto = z.infer<typeof updateCouponSchema>;
export type ListCouponsQuery = z.infer<typeof listCouponsSchema>;
export type QuoteQuery = z.infer<typeof quoteSchema>;
export type CreateComboDto = z.infer<typeof createComboSchema>;
export type UpdateComboDto = z.infer<typeof updateComboSchema>;
export type ListCombosManageQuery = z.infer<typeof listCombosManageSchema>;
export type AddComboDto = z.infer<typeof addComboSchema>;
