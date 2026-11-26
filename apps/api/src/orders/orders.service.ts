import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { AddressesService } from '../addresses/addresses.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { CartService, lineIssue } from '../cart/cart.service.js';
import { paged, paginate } from '../common/pagination.js';
import type { OrderStatus } from '../generated/prisma/enums.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RatesService } from '../rates/rates.service.js';
import type {
  AdvanceOrderDto,
  CheckoutDto,
  ListMyOrdersQuery,
  ListOrdersManageQuery,
} from './orders.schemas.js';
import {
  chargedAmount,
  MissingRateError,
  orderCode,
  PAYMENT_WINDOW_MS,
  parseOrderCode,
  RETURN_WINDOW_MS,
  shippingCost,
} from './pricing.js';

type Tx = Prisma.TransactionClient;

// Lo que ve el cliente de su pedido. Sin datos internos del equipo.
const customerInclude = {
  items: { orderBy: { productName: 'asc' } },
  paymentMethod: {
    select: { code: true, name: true, currency: true, instructions: true },
  },
  payments: {
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      reference: true,
      amount: true,
      currency: true,
      paidAt: true,
      status: true,
      rejectionReason: true,
      createdAt: true,
    },
  },
  history: {
    orderBy: { createdAt: 'asc' },
    select: { toStatus: true, note: true, createdAt: true },
  },
  returns: {
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      status: true,
      reason: true,
      refundUsdCents: true,
      currency: true,
      refundAmount: true,
      decisionNote: true,
      refundReference: true,
      refundedAt: true,
      createdAt: true,
      items: { select: { orderItemId: true, quantity: true } },
    },
  },
} satisfies Prisma.OrderInclude;

const staffInclude = {
  ...customerInclude,
  user: {
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
    },
  },
  payments: {
    orderBy: { createdAt: 'desc' },
    include: { method: { select: { code: true, name: true } } },
  },
  history: {
    orderBy: { createdAt: 'asc' },
    include: { changedBy: { select: { firstName: true, lastName: true } } },
  },
} satisfies Prisma.OrderInclude;

// Avances permitidos después del pago: de dónde puede venir cada estado.
const ADVANCE_FROM: Record<AdvanceOrderDto['status'], OrderStatus> = {
  PREPARING: 'PAID',
  SHIPPED: 'PREPARING',
  DELIVERED: 'SHIPPED',
};

export function withCode<T extends { number: number }>(order: T) {
  return { ...order, code: orderCode(order.number) };
}

// Pedido completo con su código y la fecha límite para pedir una devolución.
function withDeadline<
  T extends { number: number; status: OrderStatus; deliveredAt: Date | null },
>(order: T) {
  return {
    ...withCode(order),
    returnUntil:
      order.status === 'DELIVERED' && order.deliveredAt
        ? new Date(order.deliveredAt.getTime() + RETURN_WINDOW_MS)
        : null,
  };
}

@Injectable()
export class OrdersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrdersService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cart: CartService,
    private readonly addresses: AddressesService,
    private readonly rates: RatesService,
  ) {}

  // Cada minuto cancela los pedidos sin pago reportado tras 2 horas.
  // En las pruebas se llama a mano para controlar el momento.
  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      this.expireOverdue().catch((error: unknown) =>
        this.logger.error('No se pudieron cancelar pedidos vencidos', error),
      );
    }, 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  // ---------- Cliente ----------

  // Revalida stock y precios, congela la tasa y descuenta el stock en una sola
  // transacción: o se crea todo el pedido o no cambia nada.
  async checkout(user: AuthUser, dto: CheckoutDto) {
    const rates = await this.rates.forOrder();
    const order = await this.prisma.$transaction(async (tx) => {
      // Bloquea a la persona: dos envíos seguidos del checkout no duplican el pedido.
      await tx.$executeRaw`SELECT 1 FROM users WHERE id = ${user.id}::uuid FOR UPDATE`;

      const rows = await this.cart.rows(tx, user.id);
      if (rows.length === 0)
        throw new BadRequestException('El carrito está vacío');
      const blocked = rows.filter((r) => lineIssue(r) !== null);
      if (blocked.length > 0) {
        throw new ConflictException(
          `Revisa tu carrito: ${blocked.map((r) => r.variant.product.name).join(', ')} ya no tiene stock suficiente`,
        );
      }

      const address = await this.addresses.findOwn(tx, user.id, dto.addressId);
      const zone = await tx.shippingZone.findFirst({
        where: { id: dto.shippingZoneId, isActive: true },
      });
      if (!zone) throw new BadRequestException('Zona de envío no disponible');
      if (!zone.states.includes(address.state)) {
        throw new BadRequestException(
          `La zona «${zone.name}» no llega a ${address.state}`,
        );
      }
      const method = await tx.paymentMethod.findFirst({
        where: { id: dto.paymentMethodId, isActive: true },
      });
      if (!method)
        throw new BadRequestException('Método de pago no disponible');

      const subtotal = rows.reduce(
        (n, r) => n + r.variant.priceUsdCents * r.quantity,
        0,
      );
      const shipping = shippingCost(subtotal, zone);
      const total = subtotal + shipping;
      let totalCharged: Prisma.Decimal;
      try {
        totalCharged = chargedAmount(total, method.currency, rates);
      } catch (error) {
        if (error instanceof MissingRateError) {
          throw new ConflictException(
            'Todavía no hay tasa del BCV cargada para cobrar en esa moneda. Elige otro método o intenta más tarde',
          );
        }
        throw error;
      }

      // Descuento condicionado: si otra compra se llevó el stock, no pasa.
      for (const row of rows) {
        const { count } = await tx.productVariant.updateMany({
          where: {
            id: row.variantId,
            isActive: true,
            stock: { gte: row.quantity },
          },
          data: { stock: { decrement: row.quantity } },
        });
        if (count === 0) {
          throw new ConflictException(
            `Ya no queda stock suficiente de ${row.variant.product.name} (${row.variant.name})`,
          );
        }
      }

      const now = new Date();
      const created = await tx.order.create({
        data: {
          userId: user.id,
          paymentMethodId: method.id,
          chargedCurrency: method.currency,
          usdVesRate: rates.usdVes,
          eurVesRate: rates.eurVes,
          rateEffectiveAt: rates.effectiveAt,
          subtotalUsdCents: subtotal,
          shippingUsdCents: shipping,
          totalUsdCents: total,
          totalCharged,
          recipientName: address.recipientName,
          phone: address.phone,
          state: address.state,
          city: address.city,
          municipality: address.municipality,
          line1: address.line1,
          referencePoint: address.referencePoint,
          shippingZoneName: zone.name,
          carrier: zone.carrier,
          paymentDueAt: new Date(now.getTime() + PAYMENT_WINDOW_MS),
          termsAcceptedAt: now,
          items: {
            create: rows.map((r) => ({
              variantId: r.variantId,
              productName: r.variant.product.name,
              productSlug: r.variant.product.slug,
              variantName: r.variant.name,
              sku: r.variant.sku,
              unitPriceUsdCents: r.variant.priceUsdCents,
              quantity: r.quantity,
              isReturnable: r.variant.product.isReturnable,
            })),
          },
          history: {
            create: { toStatus: 'PENDING_PAYMENT', changedById: user.id },
          },
        },
      });
      await tx.inventoryMovement.createMany({
        data: rows.map((r) => ({
          variantId: r.variantId,
          quantityDelta: -r.quantity,
          reason: 'SALE' as const,
          orderId: created.id,
          createdById: user.id,
        })),
      });
      await tx.cartItem.deleteMany({ where: { userId: user.id } });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'order.created',
          entityType: 'order',
          entityId: created.id,
          metadata: { number: created.number, totalUsdCents: total },
        },
        tx,
      );
      return created;
    });
    return this.getMine(user.id, order.id);
  }

  async listMine(userId: string, query: ListMyOrdersQuery) {
    const where = { userId };
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...paginate(query.page, query.pageSize),
        select: {
          id: true,
          number: true,
          status: true,
          totalUsdCents: true,
          totalCharged: true,
          chargedCurrency: true,
          paymentDueAt: true,
          createdAt: true,
          _count: { select: { items: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    return paged(items.map(withCode), total, query.page, query.pageSize);
  }

  // El pedido de otra persona responde 404, igual que uno inexistente.
  async getMine(userId: string, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, userId },
      include: customerInclude,
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    return withDeadline(order);
  }

  // El cliente puede cancelar mientras no haya reportado el pago.
  async cancelMine(user: AuthUser, id: string) {
    const order = await this.getMine(user.id, id);
    if (order.status !== 'PENDING_PAYMENT') {
      throw new ConflictException(
        order.status === 'PAYMENT_REPORTED'
          ? 'Ya reportaste el pago: escríbenos para cancelar este pedido'
          : 'Este pedido ya no se puede cancelar',
      );
    }
    await this.prisma.$transaction((tx) =>
      this.cancelInTx(
        tx,
        id,
        ['PENDING_PAYMENT'],
        user.id,
        'Cancelado por el cliente',
      ),
    );
    return this.getMine(user.id, id);
  }

  // ---------- Equipo ----------

  async listManage(query: ListOrdersManageQuery) {
    const where: Prisma.OrderWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.q) {
      const number = parseOrderCode(query.q);
      where.OR = [
        ...(number !== null ? [{ number }] : []),
        { user: { email: { contains: query.q.toLowerCase() } } },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        // Con un estado elegido, la cola va del más antiguo al más nuevo.
        orderBy: { createdAt: query.status ? 'asc' : 'desc' },
        ...paginate(query.page, query.pageSize),
        select: {
          id: true,
          number: true,
          status: true,
          totalUsdCents: true,
          totalCharged: true,
          chargedCurrency: true,
          state: true,
          city: true,
          paymentDueAt: true,
          createdAt: true,
          user: { select: { email: true, firstName: true, lastName: true } },
          _count: { select: { items: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    return paged(items.map(withCode), total, query.page, query.pageSize);
  }

  async getManage(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: staffInclude,
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    return withDeadline(order);
  }

  async advance(actor: AuthUser, id: string, dto: AdvanceOrderDto) {
    const order = await this.getManage(id);
    const from = ADVANCE_FROM[dto.status];
    if (order.status !== from) {
      throw new ConflictException(
        `El pedido está en ${order.status} y solo puede pasar a ${dto.status} desde ${from}`,
      );
    }
    const now = new Date();
    const data: Prisma.OrderUpdateManyMutationInput & { status: OrderStatus } =
      { status: dto.status };
    if (dto.status === 'SHIPPED') {
      data.trackingCode = dto.trackingCode;
      data.shippedAt = now;
      if (dto.carrier) data.carrier = dto.carrier;
    }
    if (dto.status === 'DELIVERED') data.deliveredAt = now;

    await this.prisma.$transaction(async (tx) => {
      await this.transition(tx, id, [from], data, actor.id, dto.note);
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'order.status_changed',
          entityType: 'order',
          entityId: id,
          metadata: { from, to: dto.status },
        },
        tx,
      );
    });
    return this.getManage(id);
  }

  // Antes del pago, el equipo puede cancelar. Después, corresponde un reembolso.
  async cancelManage(actor: AuthUser, id: string, reason: string) {
    const order = await this.getManage(id);
    if (
      order.status !== 'PENDING_PAYMENT' &&
      order.status !== 'PAYMENT_REPORTED'
    ) {
      throw new ConflictException(
        'Solo se cancela un pedido sin pago verificado; uno pagado se reembolsa',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.payment.updateMany({
        where: { orderId: id, status: 'REPORTED' },
        data: {
          status: 'REJECTED',
          rejectionReason: reason,
          verifiedById: actor.id,
          verifiedAt: new Date(),
        },
      });
      await this.cancelInTx(
        tx,
        id,
        ['PENDING_PAYMENT', 'PAYMENT_REPORTED'],
        actor.id,
        reason,
      );
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'order.cancelled',
          entityType: 'order',
          entityId: id,
          metadata: { reason },
        },
        tx,
      );
    });
    return this.getManage(id);
  }

  // ---------- Sistema ----------

  // Cancela los pedidos cuyo plazo de 2 horas pasó sin reporte de pago.
  async expireOverdue(now = new Date()) {
    const overdue = await this.prisma.order.findMany({
      where: { status: 'PENDING_PAYMENT', paymentDueAt: { lt: now } },
      select: { id: true },
      take: 200,
    });
    let cancelled = 0;
    for (const { id } of overdue) {
      const done = await this.prisma.$transaction((tx) =>
        this.cancelInTx(
          tx,
          id,
          ['PENDING_PAYMENT'],
          null,
          'No se reportó el pago a tiempo',
          now,
        ),
      );
      if (done) cancelled += 1;
    }
    return cancelled;
  }

  // Cambia el estado solo si sigue en uno de `from`. Dos personas (o el
  // proceso automático) actuando a la vez no aplican el cambio dos veces.
  async transition(
    tx: Tx,
    id: string,
    from: OrderStatus[],
    data: Prisma.OrderUpdateManyMutationInput & { status: OrderStatus },
    actorId: string | null,
    note?: string | null,
  ) {
    const current = await tx.order.findUnique({
      where: { id },
      select: { status: true },
    });
    const { count } = await tx.order.updateMany({
      where: { id, status: { in: from } },
      data,
    });
    if (count === 0) {
      throw new ConflictException(
        'El pedido cambió de estado; recarga e inténtalo de nuevo',
      );
    }
    await tx.orderStatusHistory.create({
      data: {
        orderId: id,
        fromStatus: current?.status ?? null,
        toStatus: data.status,
        changedById: actorId,
        note: note ?? null,
      },
    });
  }

  // Cancela y devuelve el stock. Devuelve false si el pedido ya no estaba en `from`.
  private async cancelInTx(
    tx: Tx,
    id: string,
    from: OrderStatus[],
    actorId: string | null,
    note: string,
    now = new Date(),
  ) {
    try {
      await this.transition(
        tx,
        id,
        from,
        { status: 'CANCELLED', cancelledAt: now },
        actorId,
        note,
      );
    } catch (error) {
      if (actorId === null && error instanceof ConflictException) return false;
      throw error;
    }
    const items = await tx.orderItem.findMany({
      where: { orderId: id, variantId: { not: null } },
    });
    for (const item of items) {
      await tx.productVariant.update({
        where: { id: item.variantId! },
        data: { stock: { increment: item.quantity } },
      });
    }
    await tx.inventoryMovement.createMany({
      data: items.map((item) => ({
        variantId: item.variantId!,
        quantityDelta: item.quantity,
        reason: 'CANCELLATION' as const,
        orderId: id,
        createdById: actorId,
      })),
    });
    return true;
  }
}
