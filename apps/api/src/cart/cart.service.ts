import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
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

// Por qué una línea no se puede comprar tal como está.
export type CartIssue = 'unavailable' | 'insufficient_stock' | null;

export function lineIssue(row: Row): CartIssue {
  const { variant } = row;
  if (!variant.isActive || !variant.product.isActive || variant.stock === 0) {
    return 'unavailable';
  }
  return variant.stock < row.quantity ? 'insufficient_stock' : null;
}

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  // El precio siempre es el actual: el carrito no congela nada.
  async get(userId: string) {
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
    return {
      items,
      itemCount: items.reduce((n, i) => n + i.quantity, 0),
      subtotalUsdCents: valid.reduce((n, i) => n + i.lineTotalUsdCents, 0),
      canCheckout: items.length > 0 && valid.length === items.length,
    };
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

  rows(db: Prisma.TransactionClient | PrismaService, userId: string) {
    return db.cartItem.findMany({
      where: { userId },
      include: itemInclude,
      orderBy: { createdAt: 'asc' },
    });
  }
}
