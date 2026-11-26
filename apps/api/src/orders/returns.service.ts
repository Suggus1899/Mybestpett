import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { EmailService } from '../emails/email.service.js';
import { LoyaltyService } from '../loyalty/loyalty.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { paged, paginate } from '../common/pagination.js';
import { Prisma } from '../generated/prisma/client.js';
import type { ReturnStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  ListReturnsQuery,
  RefundReturnDto,
  RequestReturnDto,
} from './orders.schemas.js';
import { OrdersService, withCode } from './orders.service.js';
import { chargedAmount, discountedShare, RETURN_WINDOW_MS } from './pricing.js';

type Tx = Prisma.TransactionClient;

// Estados que todavía ocupan las unidades pedidas en devolución.
const ACTIVE: ReturnStatus[] = ['REQUESTED', 'APPROVED', 'REFUNDED'];

const include = {
  items: { include: { orderItem: true } },
  order: {
    select: {
      id: true,
      number: true,
      status: true,
      chargedCurrency: true,
      deliveredAt: true,
      userId: true,
      paymentMethod: { select: { code: true, name: true } },
      user: { select: { email: true, firstName: true, lastName: true } },
    },
  },
  decidedBy: { select: { firstName: true, lastName: true } },
  refundedBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.ReturnRequestInclude;

function isUniqueViolation(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly orders: OrdersService,
    private readonly emails: EmailService,
    private readonly loyalty: LoyaltyService,
  ) {}

  // ---------- Cliente ----------

  // Pide la devolución de productos de un pedido entregado hace 3 días o menos.
  // Alimento e higiene no se devuelven. El envío no se reembolsa.
  async request(user: AuthUser, orderId: string, dto: RequestReturnDto) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId: user.id },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    if (order.status !== 'DELIVERED' || !order.deliveredAt) {
      throw new ConflictException(
        'Solo se devuelve un pedido que ya te entregamos',
      );
    }
    if (Date.now() > order.deliveredAt.getTime() + RETURN_WINDOW_MS) {
      throw new ConflictException(
        'Pasaron más de 3 días desde la entrega: ya no admite devolución',
      );
    }

    const open = await this.prisma.returnRequest.findFirst({
      where: { orderId, status: { in: ['REQUESTED', 'APPROVED'] } },
      select: { id: true },
    });
    if (open) throw this.alreadyOpen();

    const taken = await this.takenByItem(orderId);
    let listUsdCents = 0;
    for (const line of dto.items) {
      const item = order.items.find((i) => i.id === line.orderItemId);
      if (!item) throw new BadRequestException('Ese producto no es del pedido');
      if (!item.isReturnable) {
        throw new BadRequestException(
          `${item.productName} no admite devolución (alimento o higiene)`,
        );
      }
      const left = item.quantity - (taken.get(item.id) ?? 0);
      if (line.quantity > left) {
        throw new BadRequestException(
          left === 0
            ? `${item.productName} ya está en otra devolución`
            : `De ${item.productName} puedes devolver como máximo ${left}`,
        );
      }
      listUsdCents += item.unitPriceUsdCents * line.quantity;
    }
    // Con combos o cupón se devuelve lo pagado, no el precio de lista.
    const refundUsdCents = discountedShare(listUsdCents, order);

    try {
      const created = await this.prisma.returnRequest.create({
        data: {
          orderId,
          userId: user.id,
          reason: dto.reason,
          refundUsdCents,
          currency: order.chargedCurrency,
          // Con las tasas congeladas del pedido: se devuelve lo que se cobró.
          refundAmount: chargedAmount(refundUsdCents, order.chargedCurrency, {
            usdVes: order.usdVesRate,
            eurVes: order.eurVesRate,
          }),
          items: { create: dto.items },
        },
      });
      await this.audit.record({
        actorId: user.id,
        action: 'return.requested',
        entityType: 'return',
        entityId: created.id,
        metadata: { orderId, refundUsdCents },
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw this.alreadyOpen();
      throw error;
    }
    return this.orders.getMine(user.id, orderId);
  }

  // ---------- Equipo ----------

  async list(query: ListReturnsQuery) {
    const where = { status: query.status };
    const [items, total] = await Promise.all([
      this.prisma.returnRequest.findMany({
        where,
        orderBy: { createdAt: query.status === 'REQUESTED' ? 'asc' : 'desc' },
        ...paginate(query.page, query.pageSize),
        include,
      }),
      this.prisma.returnRequest.count({ where }),
    ]);
    return paged(items.map(present), total, query.page, query.pageSize);
  }

  async get(id: string) {
    const found = await this.prisma.returnRequest.findUnique({
      where: { id },
      include,
    });
    if (!found) throw new NotFoundException('Devolución no encontrada');
    return present(found);
  }

  async approve(actor: AuthUser, id: string, note?: string) {
    await this.decide(actor, id, 'APPROVED', note ?? null);
    return this.get(id);
  }

  async reject(actor: AuthUser, id: string, reason: string) {
    await this.decide(actor, id, 'REJECTED', reason);
    return this.get(id);
  }

  // Solo el administrador: registra el reembolso ya hecho por el mismo método
  // y, si el producto volvió en buen estado, lo repone en el inventario.
  async refund(actor: AuthUser, id: string, dto: RefundReturnDto) {
    const current = await this.get(id);
    this.ensureNotOwn(actor, current.order.userId);
    if (current.status !== 'APPROVED') {
      throw new ConflictException(
        current.status === 'REFUNDED'
          ? 'Esta devolución ya se reembolsó'
          : 'Solo se reembolsa una devolución aprobada',
      );
    }
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.returnRequest.updateMany({
        where: { id, status: 'APPROVED' },
        data: {
          status: 'REFUNDED',
          refundReference: dto.reference,
          restocked: dto.restock,
          refundedById: actor.id,
          refundedAt: now,
        },
      });
      if (count === 0) {
        throw new ConflictException(
          'La devolución cambió de estado; recarga e inténtalo de nuevo',
        );
      }
      await this.emails.returnEvent(tx, id, 'refunded');
      await this.loyalty.onRefund(
        tx,
        current.order.id,
        id,
        current.items.reduce(
          (n, l) => n + l.orderItem.unitPriceUsdCents * l.quantity,
          0,
        ),
      );
      if (dto.restock) {
        const lines = current.items.filter((l) => l.orderItem.variantId);
        for (const line of lines) {
          await tx.productVariant.update({
            where: { id: line.orderItem.variantId! },
            data: { stock: { increment: line.quantity } },
          });
        }
        await tx.inventoryMovement.createMany({
          data: lines.map((line) => ({
            variantId: line.orderItem.variantId!,
            quantityDelta: line.quantity,
            reason: 'RETURN' as const,
            orderId: current.order.id,
            createdById: actor.id,
          })),
        });
      }
      // Si ya se reembolsó todo lo comprado, el pedido queda reembolsado.
      if (await this.fullyRefunded(tx, current.order.id)) {
        await this.orders.transition(
          tx,
          current.order.id,
          ['DELIVERED'],
          { status: 'REFUNDED' },
          actor.id,
          `Reembolso ${dto.reference}`,
        );
      }
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'return.refunded',
          entityType: 'return',
          entityId: id,
          metadata: {
            orderId: current.order.id,
            reference: dto.reference,
            restock: dto.restock,
            amount: current.refundAmount.toString(),
            currency: current.currency,
          },
        },
        tx,
      );
    });
    return this.get(id);
  }

  private async decide(
    actor: AuthUser,
    id: string,
    status: 'APPROVED' | 'REJECTED',
    note: string | null,
  ) {
    const current = await this.get(id);
    this.ensureNotOwn(actor, current.order.userId);
    if (current.status !== 'REQUESTED') {
      throw new ConflictException('Esta devolución ya fue revisada');
    }
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.returnRequest.updateMany({
        where: { id, status: 'REQUESTED' },
        data: {
          status,
          decisionNote: note,
          decidedById: actor.id,
          decidedAt: new Date(),
        },
      });
      if (count === 0) {
        throw new ConflictException('Esta devolución ya fue revisada');
      }
      await this.emails.returnEvent(
        tx,
        id,
        status === 'APPROVED' ? 'approved' : 'rejected',
      );
      await this.audit.record(
        {
          actorId: actor.id,
          action: status === 'APPROVED' ? 'return.approved' : 'return.rejected',
          entityType: 'return',
          entityId: id,
          metadata: { orderId: current.order.id, note },
        },
        tx,
      );
    });
  }

  // Con dinero de por medio, nadie revisa ni reembolsa su propio pedido.
  private ensureNotOwn(actor: AuthUser, ownerId: string) {
    if (ownerId === actor.id) {
      throw new ForbiddenException(
        'No puedes gestionar la devolución de tu propio pedido',
      );
    }
  }

  private alreadyOpen() {
    return new ConflictException(
      'Ya tienes una devolución abierta para este pedido',
    );
  }

  // Unidades de cada línea ya comprometidas en devoluciones no rechazadas.
  private async takenByItem(orderId: string) {
    const rows = await this.prisma.returnItem.groupBy({
      by: ['orderItemId'],
      where: { request: { orderId, status: { in: ACTIVE } } },
      _sum: { quantity: true },
    });
    return new Map(rows.map((r) => [r.orderItemId, r._sum.quantity ?? 0]));
  }

  private async fullyRefunded(tx: Tx, orderId: string) {
    const [items, refunded] = await Promise.all([
      tx.orderItem.findMany({ where: { orderId } }),
      tx.returnItem.groupBy({
        by: ['orderItemId'],
        where: { request: { orderId, status: 'REFUNDED' } },
        _sum: { quantity: true },
      }),
    ]);
    const done = new Map(
      refunded.map((r) => [r.orderItemId, r._sum.quantity ?? 0]),
    );
    return items.every((item) => (done.get(item.id) ?? 0) >= item.quantity);
  }
}

function present<T extends { order: { number: number } }>(found: T) {
  return { ...found, order: withCode(found.order) };
}
