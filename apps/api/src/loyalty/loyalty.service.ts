import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { paged, paginate } from '../common/pagination.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  POINT_VALUE_CENTS,
  pointsEarned,
  proportionalPoints,
} from './points.js';
import type { AdjustPointsDto, ListPointsQuery } from './loyalty.schemas.js';

type Db = Prisma.TransactionClient | PrismaService;

@Injectable()
export class LoyaltyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async balance(db: Db, userId: string) {
    const { _sum } = await db.pointsEntry.aggregate({
      where: { userId },
      _sum: { delta: true },
    });
    return _sum.delta ?? 0;
  }

  async summary(userId: string, query: ListPointsQuery) {
    const [balance, items, total] = await Promise.all([
      this.balance(this.prisma, userId),
      this.prisma.pointsEntry.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        ...paginate(query.page, query.pageSize),
        select: {
          id: true,
          delta: true,
          reason: true,
          note: true,
          createdAt: true,
          order: { select: { id: true, number: true } },
        },
      }),
      this.prisma.pointsEntry.count({ where: { userId } }),
    ]);
    return {
      balance,
      valueUsdCents: balance * POINT_VALUE_CENTS,
      ...paged(items, total, query.page, query.pageSize),
    };
  }

  // ---------- Ganchos del flujo de pedidos (dentro de su transacción) ----------

  // Descuenta los puntos canjeados. Quien llama ya bloqueó a la persona.
  async redeem(tx: Db, userId: string, orderId: string, points: number) {
    if (points === 0) return;
    await tx.pointsEntry.create({
      data: { userId, orderId, delta: -points, reason: 'REDEEMED' },
    });
  }

  // Al entregar: suma los puntos del pedido una sola vez.
  async earn(tx: Prisma.TransactionClient, orderId: string) {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    const points = pointsEarned(order);
    if (points === 0 || order.pointsEarned > 0) return;
    await tx.order.update({
      where: { id: orderId },
      data: { pointsEarned: points },
    });
    await tx.pointsEntry.create({
      data: {
        userId: order.userId,
        orderId,
        delta: points,
        reason: 'EARNED',
      },
    });
  }

  // Al cancelar: devuelve lo canjeado (aún no ganó nada).
  async restoreOnCancel(tx: Prisma.TransactionClient, orderId: string) {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.pointsRedeemed === 0) return;
    await tx.pointsEntry.create({
      data: {
        userId: order.userId,
        orderId,
        delta: order.pointsRedeemed,
        reason: 'RESTORED',
        note: 'Pedido cancelado',
      },
    });
  }

  // Al reembolsar productos: devuelve la parte de los puntos canjeados y
  // quita la parte de los ganados. El saldo no baja de 0.
  async onRefund(
    tx: Prisma.TransactionClient,
    orderId: string,
    returnId: string,
    listUsdCents: number,
  ) {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    await tx.$executeRaw`SELECT 1 FROM users WHERE id = ${order.userId}::uuid FOR UPDATE`;
    const back = proportionalPoints(
      order.pointsRedeemed,
      listUsdCents,
      order.subtotalUsdCents,
    );
    if (back > 0) {
      await tx.pointsEntry.create({
        data: {
          userId: order.userId,
          orderId,
          returnId,
          delta: back,
          reason: 'RESTORED',
          note: 'Reembolso',
        },
      });
    }
    const earned = proportionalPoints(
      order.pointsEarned,
      listUsdCents,
      order.subtotalUsdCents,
    );
    const take = Math.min(earned, await this.balance(tx, order.userId));
    if (take > 0) {
      await tx.pointsEntry.create({
        data: {
          userId: order.userId,
          orderId,
          returnId,
          delta: -take,
          reason: 'REVERSED',
          note: 'Reembolso',
        },
      });
    }
  }

  // ---------- Administrador ----------

  async listForUser(userId: string, query: ListPointsQuery) {
    const exists = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Cuenta no encontrada');
    return this.summary(userId, query);
  }

  async adjust(actor: AuthUser, userId: string, dto: AdjustPointsDto) {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      if (locked.length === 0)
        throw new NotFoundException('Cuenta no encontrada');
      const balance = await this.balance(tx, userId);
      if (balance + dto.delta < 0) {
        throw new BadRequestException(
          `El saldo quedaría en negativo: tiene ${balance} puntos`,
        );
      }
      await tx.pointsEntry.create({
        data: {
          userId,
          delta: dto.delta,
          reason: 'ADJUSTED',
          note: dto.note,
          createdById: actor.id,
        },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'points.adjusted',
          entityType: 'user',
          entityId: userId,
          metadata: { delta: dto.delta, note: dto.note },
        },
        tx,
      );
      return { balance: balance + dto.delta };
    });
  }
}
