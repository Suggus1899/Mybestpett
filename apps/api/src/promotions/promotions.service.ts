import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { paged, paginate } from '../common/pagination.js';
import { slugify } from '../common/slug.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  comboDiscounts,
  couponDiscount,
  type AppliedCombo,
} from '../orders/pricing.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateComboDto,
  CreateCouponDto,
  ListCombosManageQuery,
  ListCouponsQuery,
  UpdateComboDto,
  UpdateCouponDto,
} from './promotions.schemas.js';

type Db = Prisma.TransactionClient | PrismaService;

export interface CartLine {
  variantId: string;
  quantity: number;
  unitPriceUsdCents: number;
}

export interface Quote {
  subtotalUsdCents: number;
  combos: AppliedCombo[];
  comboDiscountUsdCents: number;
  coupon: {
    id: string;
    code: string;
    description: string;
    discountUsdCents: number;
  } | null;
  couponDiscountUsdCents: number;
  // Lo que cuestan los productos después de los descuentos (sin envío).
  itemsTotalUsdCents: number;
}

const usd = (cents: number) => `${(cents / 100).toFixed(2)} $`;

const comboInclude = {
  items: {
    orderBy: { id: 'asc' },
    include: {
      variant: {
        select: {
          id: true,
          name: true,
          sku: true,
          priceUsdCents: true,
          stock: true,
          isActive: true,
          product: {
            select: {
              name: true,
              slug: true,
              isActive: true,
              images: {
                orderBy: { sortOrder: 'asc' },
                take: 1,
                select: { url: true, alt: true },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.ComboInclude;

type ComboRow = Prisma.ComboGetPayload<{ include: typeof comboInclude }>;

// Se puede vender si todas sus presentaciones y productos siguen activos.
const sellable = (c: ComboRow) =>
  c.items.length > 0 &&
  c.items.every((i) => i.variant.isActive && i.variant.product.isActive);

function present(c: ComboRow) {
  const regular = c.items.reduce(
    (n, i) => n + i.variant.priceUsdCents * i.quantity,
    0,
  );
  return {
    id: c.id,
    name: c.name,
    slug: c.slug,
    description: c.description,
    priceUsdCents: c.priceUsdCents,
    regularUsdCents: regular,
    savingsUsdCents: regular - c.priceUsdCents,
    // Cuántos combos completos alcanzan con el stock de hoy.
    available: Math.min(
      ...c.items.map((i) => Math.floor(i.variant.stock / i.quantity)),
    ),
    items: c.items.map((i) => ({
      quantity: i.quantity,
      variantId: i.variant.id,
      variantName: i.variant.name,
      sku: i.variant.sku,
      unitPriceUsdCents: i.variant.priceUsdCents,
      product: {
        name: i.variant.product.name,
        slug: i.variant.product.slug,
        image: i.variant.product.images[0] ?? null,
      },
    })),
  };
}

@Injectable()
export class PromotionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------- Cálculo (carrito y checkout) ----------

  async combosFor(db: Db, lines: CartLine[]): Promise<AppliedCombo[]> {
    if (lines.length === 0) return [];
    const combos = await db.combo.findMany({
      where: {
        isActive: true,
        items: { some: { variantId: { in: lines.map((l) => l.variantId) } } },
      },
      include: comboInclude,
    });
    return comboDiscounts(
      new Map(lines.map((l) => [l.variantId, l.quantity])),
      combos.filter(sellable).map((c) => ({
        id: c.id,
        name: c.name,
        priceUsdCents: c.priceUsdCents,
        items: c.items.map((i) => ({
          variantId: i.variantId,
          quantity: i.quantity,
          unitPriceUsdCents: i.variant.priceUsdCents,
        })),
      })),
    );
  }

  // Subtotal, combos y cupón. Con `lock`, bloquea el cupón hasta que termine
  // la transacción: dos compras a la vez no pasan del límite de usos.
  async quote(
    db: Db,
    userId: string,
    lines: CartLine[],
    code?: string,
    { lock = false, now = new Date() } = {},
  ): Promise<Quote> {
    const subtotal = lines.reduce(
      (n, l) => n + l.unitPriceUsdCents * l.quantity,
      0,
    );
    const combos = await this.combosFor(db, lines);
    const comboDiscount = combos.reduce((n, c) => n + c.savingsUsdCents, 0);
    const base = subtotal - comboDiscount;
    let coupon: Quote['coupon'] = null;
    if (code) {
      const found = await this.usableCoupon(db, code, userId, base, lock, now);
      coupon = {
        id: found.id,
        code: found.code,
        description: found.description,
        discountUsdCents: couponDiscount(base, found),
      };
    }
    const couponAmount = coupon?.discountUsdCents ?? 0;
    return {
      subtotalUsdCents: subtotal,
      combos,
      comboDiscountUsdCents: comboDiscount,
      coupon,
      couponDiscountUsdCents: couponAmount,
      itemsTotalUsdCents: base - couponAmount,
    };
  }

  private async usableCoupon(
    db: Db,
    code: string,
    userId: string,
    base: number,
    lock: boolean,
    now: Date,
  ) {
    if (lock) {
      await db.$executeRaw`SELECT 1 FROM coupons WHERE code = ${code} FOR UPDATE`;
    }
    const coupon = await db.coupon.findUnique({ where: { code } });
    if (!coupon || !coupon.isActive) {
      throw new BadRequestException('Ese cupón no existe o ya no está activo');
    }
    if (coupon.startsAt && coupon.startsAt > now) {
      throw new BadRequestException('Ese cupón todavía no está vigente');
    }
    if (coupon.endsAt && coupon.endsAt <= now) {
      throw new BadRequestException('Ese cupón ya venció');
    }
    if (base < coupon.minSubtotalUsdCents) {
      throw new BadRequestException(
        `Ese cupón aplica en compras desde ${usd(coupon.minSubtotalUsdCents)}`,
      );
    }
    const used = { couponId: coupon.id, status: { not: 'CANCELLED' as const } };
    const [total, mine] = await Promise.all([
      coupon.maxRedemptions === null
        ? Promise.resolve(0)
        : db.order.count({ where: used }),
      db.order.count({ where: { ...used, userId } }),
    ]);
    if (coupon.maxRedemptions !== null && total >= coupon.maxRedemptions) {
      throw new BadRequestException('Ese cupón ya se agotó');
    }
    if (mine >= coupon.perUserLimit) {
      throw new BadRequestException(
        coupon.perUserLimit === 1
          ? 'Ya usaste este cupón'
          : `Ya usaste este cupón ${coupon.perUserLimit} veces`,
      );
    }
    return coupon;
  }

  // ---------- Combos: tienda ----------

  async listCombos() {
    const combos = await this.prisma.combo.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
      take: 60,
      include: comboInclude,
    });
    return combos
      .filter(sellable)
      .map(present)
      .filter((c) => c.savingsUsdCents > 0);
  }

  async getCombo(slug: string) {
    const combo = await this.prisma.combo.findFirst({
      where: { slug, isActive: true },
      include: comboInclude,
    });
    if (!combo || !sellable(combo)) {
      throw new NotFoundException('Combo no encontrado');
    }
    const shown = present(combo);
    if (shown.savingsUsdCents <= 0) {
      throw new NotFoundException('Combo no encontrado');
    }
    return shown;
  }

  // ---------- Combos: equipo ----------

  async listCombosManage(query: ListCombosManageQuery) {
    const [items, total] = await Promise.all([
      this.prisma.combo.findMany({
        orderBy: { createdAt: 'desc' },
        ...paginate(query.page, query.pageSize),
        include: comboInclude,
      }),
      this.prisma.combo.count(),
    ]);
    return paged(
      items.map((c) => ({
        ...present(c),
        isActive: c.isActive,
        sellable: sellable(c),
      })),
      total,
      query.page,
      query.pageSize,
    );
  }

  async createCombo(actor: AuthUser, dto: CreateComboDto) {
    const items = await this.checkComboPrice(dto.items, dto.priceUsdCents);
    const combo = await this.prisma.$transaction(async (tx) => {
      const created = await tx.combo.create({
        data: {
          name: dto.name,
          slug: dto.slug ?? slugify(dto.name),
          description: dto.description,
          priceUsdCents: dto.priceUsdCents,
          isActive: dto.isActive,
          items: { create: items },
        },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'combo.created',
          entityType: 'combo',
          entityId: created.id,
          metadata: { priceUsdCents: dto.priceUsdCents },
        },
        tx,
      );
      return created;
    });
    return this.comboById(combo.id);
  }

  async updateCombo(actor: AuthUser, id: string, dto: UpdateComboDto) {
    const current = await this.prisma.combo.findUnique({
      where: { id },
      include: { items: { include: { variant: { select: { sku: true } } } } },
    });
    if (!current) throw new NotFoundException('Combo no encontrado');
    let items: { variantId: string; quantity: number }[] | undefined;
    if (dto.items || dto.priceUsdCents !== undefined) {
      const checked = await this.checkComboPrice(
        dto.items ??
          current.items.map((i) => ({
            sku: i.variant.sku,
            quantity: i.quantity,
          })),
        dto.priceUsdCents ?? current.priceUsdCents,
      );
      if (dto.items) items = checked;
    }
    const { items: _items, ...fields } = dto;
    await this.prisma.$transaction(async (tx) => {
      if (items) {
        await tx.comboItem.deleteMany({ where: { comboId: id } });
        await tx.comboItem.createMany({
          data: items.map((i) => ({ ...i, comboId: id })),
        });
      }
      await tx.combo.update({ where: { id }, data: fields });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'combo.updated',
          entityType: 'combo',
          entityId: id,
          metadata: { fields: Object.keys(dto) },
        },
        tx,
      );
    });
    return this.comboById(id);
  }

  private async comboById(id: string) {
    const combo = await this.prisma.combo.findUniqueOrThrow({
      where: { id },
      include: comboInclude,
    });
    return {
      ...present(combo),
      isActive: combo.isActive,
      sellable: sellable(combo),
    };
  }

  // Cada SKU debe ser una presentación a la venta y el combo debe costar
  // menos que la suma de sus productos a precio de hoy. Devuelve los ids.
  private async checkComboPrice(
    items: { sku: string; quantity: number }[],
    price: number,
  ) {
    const variants = await this.prisma.productVariant.findMany({
      where: {
        sku: { in: items.map((i) => i.sku) },
        isActive: true,
        product: { isActive: true },
      },
      select: { id: true, sku: true, priceUsdCents: true },
    });
    const missing = items.filter((i) => !variants.some((v) => v.sku === i.sku));
    if (missing.length > 0) {
      throw new BadRequestException(
        `No está a la venta o no existe: ${missing.map((i) => i.sku).join(', ')}`,
      );
    }
    const resolved = items.map((i) => {
      const v = variants.find((x) => x.sku === i.sku)!;
      return { variantId: v.id, quantity: i.quantity, price: v.priceUsdCents };
    });
    const regular = resolved.reduce((n, i) => n + i.price * i.quantity, 0);
    if (price >= regular) {
      throw new BadRequestException(
        `El combo debe costar menos que sus productos por separado (${usd(regular)})`,
      );
    }
    return resolved.map(({ variantId, quantity }) => ({ variantId, quantity }));
  }

  // ---------- Cupones: equipo ----------

  async listCoupons(query: ListCouponsQuery) {
    const where: Prisma.CouponWhereInput = { isActive: query.active };
    const [items, total] = await Promise.all([
      this.prisma.coupon.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...paginate(query.page, query.pageSize),
        include: { createdBy: { select: { firstName: true, lastName: true } } },
      }),
      this.prisma.coupon.count({ where }),
    ]);
    const uses = await this.prisma.order.groupBy({
      by: ['couponId'],
      where: {
        couponId: { in: items.map((c) => c.id) },
        status: { not: 'CANCELLED' },
      },
      _count: { _all: true },
      _sum: { couponDiscountUsdCents: true },
    });
    return paged(
      items.map((c) => {
        const u = uses.find((x) => x.couponId === c.id);
        return {
          ...c,
          uses: u?._count._all ?? 0,
          discountedUsdCents: u?._sum.couponDiscountUsdCents ?? 0,
        };
      }),
      total,
      query.page,
      query.pageSize,
    );
  }

  async createCoupon(actor: AuthUser, dto: CreateCouponDto) {
    const exists = await this.prisma.coupon.findUnique({
      where: { code: dto.code },
      select: { id: true },
    });
    if (exists)
      throw new ConflictException('Ya existe un cupón con ese código');
    return this.prisma.$transaction(async (tx) => {
      const coupon = await tx.coupon.create({
        data: { ...dto, createdById: actor.id },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'coupon.created',
          entityType: 'coupon',
          entityId: coupon.id,
          metadata: {
            code: coupon.code,
            type: coupon.type,
            value: coupon.value,
          },
        },
        tx,
      );
      return coupon;
    });
  }

  async updateCoupon(actor: AuthUser, id: string, dto: UpdateCouponDto) {
    const current = await this.prisma.coupon.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Cupón no encontrado');
    const startsAt =
      dto.startsAt !== undefined ? dto.startsAt : current.startsAt;
    const endsAt = dto.endsAt !== undefined ? dto.endsAt : current.endsAt;
    if (startsAt && endsAt && endsAt <= startsAt) {
      throw new BadRequestException('El fin debe ser después del inicio');
    }
    if (current.type === 'FIXED' && dto.maxDiscountUsdCents) {
      throw new BadRequestException('El tope es solo para porcentajes');
    }
    return this.prisma.$transaction(async (tx) => {
      const coupon = await tx.coupon.update({ where: { id }, data: dto });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'coupon.updated',
          entityType: 'coupon',
          entityId: id,
          metadata: { fields: Object.keys(dto) },
        },
        tx,
      );
      return coupon;
    });
  }
}
