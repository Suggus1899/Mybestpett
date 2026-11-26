import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { paged, paginate } from '../common/pagination.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  ListReviewsManageQuery,
  ListReviewsQuery,
  ModerateReviewDto,
  UpsertReviewDto,
} from './reviews.schemas.js';

// "Ana P.": nombre y la inicial del apellido, sin correo ni datos de contacto.
function displayName(user: { firstName: string; lastName: string }) {
  const initial = user.lastName.trim().charAt(0);
  return initial
    ? `${user.firstName} ${initial.toUpperCase()}.`
    : user.firstName;
}

const publicSelect = {
  id: true,
  rating: true,
  title: true,
  body: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { firstName: true, lastName: true } },
} satisfies Prisma.ProductReviewSelect;

type PublicRow = Prisma.ProductReviewGetPayload<{
  select: typeof publicSelect;
}>;

function toPublic({ user, ...review }: PublicRow) {
  return { ...review, author: displayName(user), verifiedPurchase: true };
}

const order: Record<
  ListReviewsQuery['sort'],
  Prisma.ProductReviewOrderByWithRelationInput[]
> = {
  recent: [{ createdAt: 'desc' }],
  best: [{ rating: 'desc' }, { createdAt: 'desc' }],
  worst: [{ rating: 'asc' }, { createdAt: 'desc' }],
};

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------- Público ----------

  async list(slug: string, query: ListReviewsQuery) {
    const product = await this.product(slug);
    const where = { productId: product.id, status: 'VISIBLE' as const };
    const [items, total, groups] = await Promise.all([
      this.prisma.productReview.findMany({
        where,
        orderBy: order[query.sort],
        ...paginate(query.page, query.pageSize),
        select: publicSelect,
      }),
      this.prisma.productReview.count({ where }),
      this.prisma.productReview.groupBy({
        by: ['rating'],
        where,
        _count: { _all: true },
      }),
    ]);
    const distribution = [1, 2, 3, 4, 5].map(
      (stars) => groups.find((g) => g.rating === stars)?._count._all ?? 0,
    );
    const count = distribution.reduce((a, b) => a + b, 0);
    const sum = distribution.reduce((acc, n, i) => acc + n * (i + 1), 0);
    return {
      ...paged(items.map(toPublic), total, query.page, query.pageSize),
      summary: {
        count,
        average: count ? Math.round((sum / count) * 10) / 10 : null,
        distribution, // cuántas reseñas de 1, 2, 3, 4 y 5 estrellas
      },
    };
  }

  // ---------- Cliente ----------

  // Si puede reseñar y su reseña actual (incluida una oculta, con el motivo).
  async mine(user: AuthUser, slug: string) {
    const product = await this.product(slug);
    const [canReview, review] = await Promise.all([
      this.bought(user.id, product.id),
      this.prisma.productReview.findUnique({
        where: { productId_userId: { productId: product.id, userId: user.id } },
        select: {
          id: true,
          rating: true,
          title: true,
          body: true,
          status: true,
          hiddenReason: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);
    return { canReview, review };
  }

  // Crea o edita la reseña propia. Una oculta por el equipo sigue oculta.
  async upsert(user: AuthUser, slug: string, dto: UpsertReviewDto) {
    const product = await this.product(slug);
    if (!(await this.bought(user.id, product.id))) {
      throw new ForbiddenException(
        'Solo puedes reseñar productos que compraste y ya recibiste',
      );
    }
    await this.prisma.productReview.upsert({
      where: { productId_userId: { productId: product.id, userId: user.id } },
      create: { productId: product.id, userId: user.id, ...dto },
      update: dto,
    });
    return this.mine(user, slug);
  }

  async remove(user: AuthUser, slug: string) {
    const product = await this.product(slug);
    const { count } = await this.prisma.productReview.deleteMany({
      where: { productId: product.id, userId: user.id },
    });
    if (count === 0)
      throw new NotFoundException('No tienes una reseña de este producto');
  }

  // ---------- Equipo ----------

  async listManage(query: ListReviewsManageQuery) {
    const where: Prisma.ProductReviewWhereInput = {
      status: query.status,
      rating: query.rating,
    };
    const [items, total] = await Promise.all([
      this.prisma.productReview.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...paginate(query.page, query.pageSize),
        include: {
          product: { select: { name: true, slug: true } },
          user: { select: { email: true, firstName: true, lastName: true } },
          moderatedBy: { select: { firstName: true, lastName: true } },
        },
      }),
      this.prisma.productReview.count({ where }),
    ]);
    return paged(items, total, query.page, query.pageSize);
  }

  async moderate(actor: AuthUser, id: string, dto: ModerateReviewDto) {
    const review = await this.prisma.productReview.findUnique({
      where: { id },
    });
    if (!review) throw new NotFoundException('Reseña no encontrada');
    if (review.status === dto.status) {
      throw new ConflictException(
        dto.status === 'HIDDEN'
          ? 'La reseña ya está oculta'
          : 'La reseña ya está visible',
      );
    }
    const hiddenReason = dto.status === 'HIDDEN' ? dto.reason : null;
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.productReview.update({
        where: { id },
        data: {
          status: dto.status,
          hiddenReason,
          moderatedById: actor.id,
          moderatedAt: new Date(),
        },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: dto.status === 'HIDDEN' ? 'review.hidden' : 'review.shown',
          entityType: 'review',
          entityId: id,
          metadata: { productId: review.productId, reason: hiddenReason },
        },
        tx,
      );
      return updated;
    });
  }

  private async product(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { slug, isActive: true },
      select: { id: true },
    });
    if (!product) throw new NotFoundException('Producto no encontrado');
    return product;
  }

  // Lo compró y lo recibió (un pedido entregado con alguna presentación del producto).
  private async bought(userId: string, productId: string) {
    const item = await this.prisma.orderItem.findFirst({
      where: {
        order: { userId, status: 'DELIVERED' },
        variant: { productId },
      },
      select: { id: true },
    });
    return item !== null;
  }
}
