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

// Lo que necesita una tarjeta de producto en un listado.
function toCard(p: CardRow) {
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
  };
}

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
    return paged(rows.map(toCard), total, query.page, query.pageSize);
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
    // El público ve si hay stock, no la cantidad exacta.
    return {
      ...product,
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
