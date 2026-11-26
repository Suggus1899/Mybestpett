import { Injectable } from '@nestjs/common';
import { paged, paginate } from '../common/pagination.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { InventoryQuery } from './inventory.schemas.js';

// Inventario: una fila por variante (lo que tiene stock), con su producto.
@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: InventoryQuery) {
    const where: Prisma.ProductVariantWhereInput = {};
    if (!query.includeInactive) {
      where.isActive = true;
      where.product = { isActive: true };
    }
    if (query.q) {
      where.OR = [
        { sku: { contains: query.q, mode: 'insensitive' } },
        { name: { contains: query.q, mode: 'insensitive' } },
        { product: { name: { contains: query.q, mode: 'insensitive' } } },
      ];
    }
    if (query.category) {
      where.product = {
        ...(where.product as Prisma.ProductWhereInput),
        category: {
          OR: [{ slug: query.category }, { parent: { slug: query.category } }],
        },
      };
    }
    if (query.status === 'out') where.stock = 0;
    if (query.status === 'low')
      where.stock = { gte: 1, lte: query.lowThreshold };
    if (query.status === 'in') where.stock = { gt: 0 };

    const orderBy: Prisma.ProductVariantOrderByWithRelationInput[] =
      query.sort === 'name'
        ? [{ product: { name: 'asc' } }, { name: 'asc' }]
        : [
            { stock: query.sort === 'stock_asc' ? 'asc' : 'desc' },
            { sku: 'asc' },
          ];

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.productVariant.findMany({
        where,
        orderBy,
        ...paginate(query.page, query.pageSize),
        select: {
          id: true,
          sku: true,
          name: true,
          stock: true,
          priceUsdCents: true,
          isActive: true,
          updatedAt: true,
          product: {
            select: {
              id: true,
              name: true,
              slug: true,
              isActive: true,
              category: { select: { name: true, slug: true } },
            },
          },
        },
      }),
      this.prisma.productVariant.count({ where }),
    ]);

    const items = rows.map((row) => ({
      ...row,
      status:
        row.stock === 0
          ? 'out'
          : row.stock <= query.lowThreshold
            ? 'low'
            : 'in',
    }));
    return paged(items, total, query.page, query.pageSize);
  }

  // Cifras globales para la cabecera del inventario (solo lo que está a la venta).
  async summary(lowThreshold = 5) {
    const [totals] = await this.prisma.$queryRaw<
      {
        variants: bigint;
        units: bigint | null;
        out_of_stock: bigint;
        low_stock: bigint;
        value_usd_cents: bigint | null;
      }[]
    >`
      SELECT
        COUNT(*)                                              AS variants,
        SUM(v.stock)                                          AS units,
        COUNT(*) FILTER (WHERE v.stock = 0)                   AS out_of_stock,
        COUNT(*) FILTER (WHERE v.stock BETWEEN 1 AND ${lowThreshold}) AS low_stock,
        SUM(v.stock::bigint * v."priceUsdCents")              AS value_usd_cents
      FROM product_variants v
      JOIN products p ON p.id = v."productId"
      WHERE v."isActive" AND p."isActive"`;

    const animals = await this.prisma.animal.groupBy({
      by: ['listingType'],
      where: { status: 'AVAILABLE' },
      _count: { _all: true },
    });
    const animalCount = (type: 'SALE' | 'ADOPTION') =>
      animals.find((a) => a.listingType === type)?._count._all ?? 0;

    return {
      lowThreshold,
      variants: Number(totals.variants),
      units: Number(totals.units ?? 0),
      outOfStock: Number(totals.out_of_stock),
      lowStock: Number(totals.low_stock),
      // Valor del inventario a precio de venta.
      valueUsdCents: Number(totals.value_usd_cents ?? 0),
      animalsForSale: animalCount('SALE'),
      animalsForAdoption: animalCount('ADOPTION'),
    };
  }
}
