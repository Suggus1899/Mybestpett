import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { paged, paginate } from '../common/pagination.js';
import { slugify } from '../common/slug.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateBrandDto,
  CreateCategoryDto,
  CreateProductDto,
  CreateVariantDto,
  ListProductsManageQuery,
  ListProductsQuery,
  SetImagesDto,
  UpdateCategoryDto,
  UpdateProductDto,
  UpdateVariantDto,
} from './catalog.schemas.js';

const cardInclude = {
  category: { select: { name: true, slug: true } },
  brand: { select: { name: true, slug: true } },
  images: {
    orderBy: { sortOrder: 'asc' },
    take: 1,
    select: { url: true, alt: true },
  },
  variants: {
    where: { isActive: true },
    select: { priceUsdCents: true, compareAtUsdCents: true, stock: true },
  },
} satisfies Prisma.ProductInclude;

type CardRow = Prisma.ProductGetPayload<{ include: typeof cardInclude }>;

type Rating = { average: number | null; count: number };

// Lo que necesita una tarjeta de producto en un listado.
function toCard(p: CardRow, rating: Rating = { average: null, count: 0 }) {
  const cheapest = [...p.variants].sort(
    (a, b) => a.priceUsdCents - b.priceUsdCents,
  )[0];
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    species: p.species,
    isActive: p.isActive,
    category: p.category,
    brand: p.brand,
    image: p.images[0] ?? null,
    priceFromUsdCents: cheapest?.priceUsdCents ?? null,
    compareAtUsdCents: cheapest?.compareAtUsdCents ?? null,
    inStock: p.variants.some((v) => v.stock > 0),
    rating,
  };
}

// Estados en los que un pedido cuenta como venta.
const SOLD = ['PAID', 'PREPARING', 'SHIPPED', 'DELIVERED'] as const;
const RECOMMENDATIONS = 4;

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------- Lectura pública ----------

  listCategories() {
    return this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, slug: true, parentId: true },
    });
  }

  listBrands() {
    return this.prisma.brand.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true },
    });
  }

  async listProducts(
    query: ListProductsQuery | ListProductsManageQuery,
    staff = false,
  ) {
    const where: Prisma.ProductWhereInput = {};
    if (!staff) {
      where.isActive = true;
      // Solo productos con al menos una variante a la venta.
      where.variants = { some: { isActive: true } };
    } else if ('active' in query && query.active !== undefined) {
      where.isActive = query.active;
    }

    if (query.category) {
      const category = await this.prisma.category.findUnique({
        where: { slug: query.category },
        select: { id: true, children: { select: { id: true } } },
      });
      if (!category) return paged([], 0, query.page, query.pageSize);
      // Incluye las subcategorías directas: "Perros" muestra también "Perros > Alimento".
      where.categoryId = {
        in: [category.id, ...category.children.map((c) => c.id)],
      };
    }
    if (query.species) where.species = { has: query.species };
    if (query.q) where.name = { contains: query.q, mode: 'insensitive' };
    if (query.onSale) {
      where.variants = {
        some: { isActive: true, compareAtUsdCents: { not: null } },
      };
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        include: cardInclude,
        orderBy:
          query.sort === 'name' ? { name: 'asc' } : { createdAt: 'desc' },
        ...paginate(query.page, query.pageSize),
      }),
      this.prisma.product.count({ where }),
    ]);
    const ratings = await this.ratings(rows.map((r) => r.id));
    return paged(
      rows.map((r) => toCard(r, ratings.get(r.id))),
      total,
      query.page,
      query.pageSize,
    );
  }

  // Promedio y número de reseñas visibles de cada producto.
  async ratings(productIds: string[]) {
    const rows = await this.prisma.productReview.groupBy({
      by: ['productId'],
      where: { productId: { in: productIds }, status: 'VISIBLE' },
      _avg: { rating: true },
      _count: { _all: true },
    });
    return new Map<string, Rating>(
      rows.map((r) => [
        r.productId,
        {
          average:
            r._avg.rating === null ? null : Math.round(r._avg.rating * 10) / 10,
          count: r._count._all,
        },
      ]),
    );
  }

  // "También te puede gustar": primero lo que se compró junto con este
  // producto en pedidos pagados; si no alcanza, lo más vendido de su categoría.
  // Solo productos activos con stock.
  async recommendations(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { slug, isActive: true },
      select: { id: true, categoryId: true },
    });
    if (!product) throw new NotFoundException('Producto no encontrado');

    const together = await this.prisma.$queryRaw<{ productId: string }[]>`
      SELECT v2."productId"
      FROM order_items oi1
      JOIN product_variants v1 ON v1.id = oi1."variantId"
      JOIN orders o ON o.id = oi1."orderId"
      JOIN order_items oi2 ON oi2."orderId" = oi1."orderId" AND oi2.id <> oi1.id
      JOIN product_variants v2 ON v2.id = oi2."variantId"
      WHERE v1."productId" = ${product.id}::uuid
        AND v2."productId" <> ${product.id}::uuid
        AND o.status::text = ANY(${[...SOLD]})
      GROUP BY v2."productId"
      ORDER BY COUNT(DISTINCT oi1."orderId") DESC, v2."productId"
      LIMIT 20`;
    const bestInCategory = await this.prisma.$queryRaw<{ productId: string }[]>`
      SELECT p.id AS "productId"
      FROM products p
      LEFT JOIN product_variants v ON v."productId" = p.id
      LEFT JOIN order_items oi ON oi."variantId" = v.id
      LEFT JOIN orders o ON o.id = oi."orderId" AND o.status::text = ANY(${[...SOLD]})
      WHERE p."categoryId" = ${product.categoryId}::uuid AND p.id <> ${product.id}::uuid
      GROUP BY p.id
      ORDER BY COALESCE(SUM(CASE WHEN o.id IS NOT NULL THEN oi.quantity END), 0) DESC, p."createdAt" DESC
      LIMIT 20`;
    const ids = [
      ...new Set([...together, ...bestInCategory].map((r) => r.productId)),
    ];
    const rows = await this.prisma.product.findMany({
      where: {
        id: { in: ids },
        isActive: true,
        variants: { some: { isActive: true, stock: { gt: 0 } } },
      },
      include: cardInclude,
    });
    const picked = ids
      .map((id) => rows.find((r) => r.id === id))
      .filter((r): r is CardRow => r !== undefined)
      .slice(0, RECOMMENDATIONS);
    const ratings = await this.ratings(picked.map((r) => r.id));
    return picked.map((r) => toCard(r, ratings.get(r.id)));
  }

  async getProduct(slug: string, staff = false) {
    const product = await this.prisma.product.findUnique({
      where: { slug },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        brand: { select: { id: true, name: true, slug: true } },
        images: {
          orderBy: { sortOrder: 'asc' },
          select: { url: true, alt: true },
        },
        variants: {
          where: staff ? {} : { isActive: true },
          orderBy: { priceUsdCents: 'asc' },
          select: {
            id: true,
            sku: true,
            name: true,
            priceUsdCents: true,
            compareAtUsdCents: true,
            stock: true,
            isActive: true,
          },
        },
      },
    });
    if (!product || (!staff && !product.isActive)) {
      throw new NotFoundException('Producto no encontrado');
    }
    if (staff) return product;
    const rating = (await this.ratings([product.id])).get(product.id) ?? {
      average: null,
      count: 0,
    };
    // El público ve si hay stock, no la cantidad exacta.
    return {
      ...product,
      rating,
      variants: product.variants.map(({ stock, ...v }) => ({
        ...v,
        inStock: stock > 0,
      })),
    };
  }

  // ---------- Gestión (equipo) ----------

  async createCategory(actor: AuthUser, dto: CreateCategoryDto) {
    const category = await this.prisma.category.create({
      data: { ...dto, slug: dto.slug ?? slugify(dto.name) },
    });
    await this.audit.record({
      actorId: actor.id,
      action: 'category.created',
      entityType: 'category',
      entityId: category.id,
    });
    return category;
  }

  async updateCategory(actor: AuthUser, id: string, dto: UpdateCategoryDto) {
    const category = await this.prisma.category.update({
      where: { id },
      data: dto,
    });
    await this.audit.record({
      actorId: actor.id,
      action: 'category.updated',
      entityType: 'category',
      entityId: id,
      metadata: dto,
    });
    return category;
  }

  async createBrand(actor: AuthUser, dto: CreateBrandDto) {
    const brand = await this.prisma.brand.create({
      data: { name: dto.name, slug: dto.slug ?? slugify(dto.name) },
    });
    await this.audit.record({
      actorId: actor.id,
      action: 'brand.created',
      entityType: 'brand',
      entityId: brand.id,
    });
    return brand;
  }

  async createProduct(actor: AuthUser, dto: CreateProductDto) {
    const { variants, images, ...fields } = dto;
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          ...fields,
          slug: fields.slug ?? slugify(fields.name),
          variants: { create: variants },
          images: {
            create: images.map((image, sortOrder) => ({ ...image, sortOrder })),
          },
        },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'product.created',
          entityType: 'product',
          entityId: product.id,
          metadata: { variants: variants.length },
        },
        tx,
      );
      return this.getProductById(tx, product.id);
    });
  }

  async updateProduct(actor: AuthUser, id: string, dto: UpdateProductDto) {
    return this.prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id }, data: dto });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'product.updated',
          entityType: 'product',
          entityId: id,
          metadata: dto,
        },
        tx,
      );
      return this.getProductById(tx, id);
    });
  }

  async setImages(actor: AuthUser, id: string, dto: SetImagesDto) {
    return this.prisma.$transaction(async (tx) => {
      await tx.product.findUniqueOrThrow({
        where: { id },
        select: { id: true },
      });
      await tx.productImage.deleteMany({ where: { productId: id } });
      await tx.productImage.createMany({
        data: dto.images.map((image, sortOrder) => ({
          ...image,
          sortOrder,
          productId: id,
        })),
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'product.images_set',
          entityType: 'product',
          entityId: id,
          metadata: { count: dto.images.length },
        },
        tx,
      );
      return this.getProductById(tx, id);
    });
  }

  async createVariant(
    actor: AuthUser,
    productId: string,
    dto: CreateVariantDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const variant = await tx.productVariant.create({
        data: { ...dto, productId },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'variant.created',
          entityType: 'product_variant',
          entityId: variant.id,
          metadata: {
            productId,
            priceUsdCents: dto.priceUsdCents,
            stock: dto.stock,
          },
        },
        tx,
      );
      return variant;
    });
  }

  // Precio y stock quedan auditados con el valor anterior y el nuevo.
  async updateVariant(actor: AuthUser, id: string, dto: UpdateVariantDto) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.productVariant.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Variante no encontrada');

      const merged = { ...before, ...dto };
      if (
        merged.compareAtUsdCents != null &&
        merged.compareAtUsdCents <= merged.priceUsdCents
      ) {
        throw new BadRequestException(
          'El precio anterior debe ser mayor que el precio actual',
        );
      }

      const variant = await tx.productVariant.update({
        where: { id },
        data: dto,
      });
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const key of Object.keys(dto) as (keyof UpdateVariantDto)[]) {
        if (before[key] !== variant[key]) {
          changes[key] = { from: before[key], to: variant[key] };
        }
      }
      if (changes.stock) {
        await tx.inventoryMovement.create({
          data: {
            variantId: id,
            quantityDelta: variant.stock - before.stock,
            reason: 'ADJUSTMENT',
            createdById: actor.id,
          },
        });
      }
      if (Object.keys(changes).length > 0) {
        await this.audit.record(
          {
            actorId: actor.id,
            action: 'variant.updated',
            entityType: 'product_variant',
            entityId: id,
            metadata: changes as Prisma.InputJsonObject,
          },
          tx,
        );
      }
      return variant;
    });
  }

  private getProductById(tx: Prisma.TransactionClient, id: string) {
    return tx.product.findUniqueOrThrow({
      where: { id },
      include: {
        images: { orderBy: { sortOrder: 'asc' } },
        variants: { orderBy: { priceUsdCents: 'asc' } },
      },
    });
  }
}
