import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PromotionsService } from '../promotions/promotions.service.js';
import { MAX_LINES, MAX_QUANTITY, type AddItemDto } from './cart.schemas.js';

const itemInclude = {
  variant: {
    include: {
      product: {
        select: {
          name: true,
          slug: true,
          isActive: true,
          isReturnable: true,
          images: {
            orderBy: { sortOrder: 'asc' },
            take: 1,
            select: { url: true, alt: true },
          },
        },
      },
    },
  },
} satisfies Prisma.CartItemInclude;

type Row = Prisma.CartItemGetPayload<{ include: typeof itemInclude }>;
// Lo necesario para comprar una presentación: del carrito o de una suscripción.
export type CartLine = Pick<Row, 'variantId' | 'quantity' | 'variant'>;

// Por qué una línea no se puede comprar tal como está.
export type CartIssue = 'unavailable' | 'insufficient_stock' | null;

export function lineIssue(row: CartLine): CartIssue {
  const { variant } = row;
  if (!variant.isActive || !variant.product.isActive || variant.stock === 0) {
    return 'unavailable';
  }
  return variant.stock < row.quantity ? 'insufficient_stock' : null;
}

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly promotions: PromotionsService,
  ) {}

  // El precio siempre es el actual: el carrito no congela nada. Los combos
  // completos se descuentan solos; el cupón se prueba con `quote`.
  async get(userId: string, coupon?: string) {
    const rows = await this.rows(this.prisma, userId);
    const items = rows.map((row) => {
      const issue = lineIssue(row);
      return {
        variantId: row.variantId,
        sku: row.variant.sku,
        name: row.variant.name,
        product: {
          name: row.variant.product.name,
          slug: row.variant.product.slug,
          image: row.variant.product.images[0] ?? null,
        },
        unitPriceUsdCents: row.variant.priceUsdCents,
        quantity: row.quantity,
        lineTotalUsdCents: row.variant.priceUsdCents * row.quantity,
        issue,
        // Lo máximo que se puede pedir de esta presentación ahora mismo.
        available:
          issue === 'unavailable'
            ? 0
            : Math.min(row.variant.stock, MAX_QUANTITY),
      };
    });
    const valid = items.filter((i) => i.issue === null);
    const quote = await this.promotions.quote(
      this.prisma,
      userId,
      valid.map((i) => ({
        variantId: i.variantId,
        quantity: i.quantity,
        unitPriceUsdCents: i.unitPriceUsdCents,
      })),
      coupon,
    );
    return {
      items,
      itemCount: items.reduce((n, i) => n + i.quantity, 0),
      subtotalUsdCents: quote.subtotalUsdCents,
      combos: quote.combos,
      comboDiscountUsdCents: quote.comboDiscountUsdCents,
      coupon: quote.coupon && {
        code: quote.coupon.code,
        description: quote.coupon.description,
        discountUsdCents: quote.coupon.discountUsdCents,
      },
      itemsTotalUsdCents: quote.itemsTotalUsdCents,
      canCheckout: items.length > 0 && valid.length === items.length,
    };
  }

  // Añade todas las unidades de un combo, o ninguna si alguna no alcanza.
  async addCombo(userId: string, slug: string, times: number) {
    const combo = await this.promotions.getCombo(slug);
    const existing = await this.prisma.cartItem.findMany({ where: { userId } });
    const newLines = combo.items.filter(
      (i) => !existing.some((e) => e.variantId === i.variantId),
    ).length;
    if (existing.length + newLines > MAX_LINES) {
      throw new BadRequestException(
        `El carrito admite hasta ${MAX_LINES} productos distintos`,
      );
    }
    const stock = await this.prisma.productVariant.findMany({
      where: { id: { in: combo.items.map((i) => i.variantId) } },
      select: { id: true, stock: true },
    });
    const wanted = combo.items.map((i) => {
      const quantity =
        (existing.find((e) => e.variantId === i.variantId)?.quantity ?? 0) +
        i.quantity * times;
      const available = stock.find((v) => v.id === i.variantId)?.stock ?? 0;
      if (quantity > MAX_QUANTITY) {
        throw new BadRequestException(
          `Puedes llevar hasta ${MAX_QUANTITY} unidades de ${i.product.name} (${i.variantName})`,
        );
      }
      if (quantity > available) {
        throw new ConflictException(
          available === 0
            ? `${i.product.name} (${i.variantName}) está agotado`
            : `Solo hay ${available} disponibles de ${i.product.name} (${i.variantName})`,
        );
      }
      return { variantId: i.variantId, quantity };
    });
    await this.prisma.$transaction(
      wanted.map((w) =>
        this.prisma.cartItem.upsert({
          where: { userId_variantId: { userId, variantId: w.variantId } },
          create: { userId, ...w },
          update: { quantity: w.quantity },
        }),
      ),
    );
    return this.get(userId);
  }

  // Suma a lo que ya había en el carrito.
  async add(userId: string, dto: AddItemDto) {
    const existing = await this.prisma.cartItem.findUnique({
      where: { userId_variantId: { userId, variantId: dto.variantId } },
    });
    if (!existing) {
      const lines = await this.prisma.cartItem.count({ where: { userId } });
      if (lines >= MAX_LINES) {
        throw new BadRequestException(
          `El carrito admite hasta ${MAX_LINES} productos distintos`,
        );
      }
    }
    const quantity = (existing?.quantity ?? 0) + dto.quantity;
    if (quantity > MAX_QUANTITY) {
      throw new BadRequestException(
        `Puedes llevar hasta ${MAX_QUANTITY} unidades de cada presentación`,
      );
    }
    return this.set(userId, dto.variantId, quantity);
  }

  async set(userId: string, variantId: string, quantity: number) {
    const variant = await this.prisma.productVariant.findUnique({
      where: { id: variantId },
      include: { product: { select: { isActive: true } } },
    });
    if (!variant || !variant.isActive || !variant.product.isActive) {
      throw new NotFoundException('Producto no encontrado');
    }
    if (variant.stock === 0) throw new ConflictException('Producto agotado');
    if (variant.stock < quantity) {
      throw new ConflictException(
        `Solo hay ${variant.stock} disponibles de esta presentación`,
      );
    }
    await this.prisma.cartItem.upsert({
      where: { userId_variantId: { userId, variantId } },
      create: { userId, variantId, quantity },
      update: { quantity },
    });
    return this.get(userId);
  }

  async remove(userId: string, variantId: string) {
    await this.prisma.cartItem.deleteMany({ where: { userId, variantId } });
    return this.get(userId);
  }

  async clear(userId: string) {
    await this.prisma.cartItem.deleteMany({ where: { userId } });
    return this.get(userId);
  }

  // Una línea suelta con la misma forma que las del carrito.
  async line(
    db: Prisma.TransactionClient | PrismaService,
    variantId: string,
    quantity: number,
  ): Promise<CartLine | null> {
    const variant = await db.productVariant.findUnique({
      where: { id: variantId },
      include: itemInclude.variant.include,
    });
    return variant ? { variantId, quantity, variant } : null;
  }

  rows(db: Prisma.TransactionClient | PrismaService, userId: string) {
    return db.cartItem.findMany({
      where: { userId },
      include: itemInclude,
      orderBy: { createdAt: 'asc' },
    });
  }
}
