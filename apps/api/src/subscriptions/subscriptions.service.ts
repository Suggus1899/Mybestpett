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
import { CartService } from '../cart/cart.service.js';
import { paged, paginate } from '../common/pagination.js';
import { EmailService } from '../emails/email.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { OrdersService } from '../orders/orders.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RatesService } from '../rates/rates.service.js';
import {
  MAX_FAILURES,
  type CreateSubscriptionDto,
  type ListSubscriptionsQuery,
  type UpdateSubscriptionDto,
} from './subscriptions.schemas.js';

type Tx = Prisma.TransactionClient;

const DAY = 24 * 60 * 60 * 1000;
// Un pedido de suscripción se crea sin que la persona esté: más plazo para pagar.
const PAYMENT_WINDOW_MS = 24 * 60 * 60 * 1000;

const include = {
  variant: {
    select: {
      id: true,
      sku: true,
      name: true,
      priceUsdCents: true,
      stock: true,
      isActive: true,
      product: {
        select: {
          name: true,
          slug: true,
          isActive: true,
          subscribable: true,
          images: {
            orderBy: { sortOrder: 'asc' },
            take: 1,
            select: { url: true, alt: true },
          },
        },
      },
    },
  },
  address: {
    select: {
      id: true,
      recipientName: true,
      line1: true,
      city: true,
      state: true,
    },
  },
  shippingZone: { select: { id: true, name: true } },
  paymentMethod: { select: { id: true, name: true } },
  orders: {
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: {
      id: true,
      number: true,
      status: true,
      totalUsdCents: true,
      createdAt: true,
    },
  },
} satisfies Prisma.SubscriptionInclude;

function isUniqueViolation(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function errorText(error: unknown) {
  const response =
    error && typeof error === 'object' && 'getResponse' in error
      ? (error as { getResponse(): unknown }).getResponse()
      : null;
  const message =
    response && typeof response === 'object' && 'message' in response
      ? (response as { message: unknown }).message
      : error instanceof Error
        ? error.message
        : 'Error desconocido';
  return String(Array.isArray(message) ? message[0] : message).slice(0, 300);
}

@Injectable()
export class SubscriptionsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SubscriptionsService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly orders: OrdersService,
    private readonly cart: CartService,
    private readonly addresses: AddressesService,
    private readonly rates: RatesService,
    private readonly emails: EmailService,
  ) {}

  // Cada 5 minutos crea los pedidos que tocan. En las pruebas se llama a mano.
  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      this.runDue().catch((error: unknown) =>
        this.logger.error('No se pudieron crear pedidos de suscripción', error),
      );
    }, 5 * 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  // ---------- Cliente ----------

  async list(userId: string, query: ListSubscriptionsQuery) {
    const where = { userId, status: { not: 'CANCELLED' as const } };
    const [items, total] = await Promise.all([
      this.prisma.subscription.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...paginate(query.page, query.pageSize),
        include,
      }),
      this.prisma.subscription.count({ where }),
    ]);
    return paged(items, total, query.page, query.pageSize);
  }

  // Crea la suscripción y su primer pedido en el acto: si algo no cuadra
  // (stock, zona, método) se rechaza todo y no queda nada a medias.
  async create(user: AuthUser, dto: CreateSubscriptionDto) {
    const rates = await this.rates.forOrder();
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT 1 FROM users WHERE id = ${user.id}::uuid FOR UPDATE`;
        const line = await this.cart.line(tx, dto.variantId, dto.quantity);
        this.assertSubscribable(line?.variant);
        await this.assertDelivery(tx, user.id, dto);
        const now = new Date();
        const subscription = await tx.subscription.create({
          data: {
            userId: user.id,
            variantId: dto.variantId,
            quantity: dto.quantity,
            intervalDays: dto.intervalDays,
            addressId: dto.addressId,
            shippingZoneId: dto.shippingZoneId,
            paymentMethodId: dto.paymentMethodId,
            nextRunAt: new Date(now.getTime() + dto.intervalDays * DAY),
          },
        });
        const order = await this.orders.place(
          tx,
          user.id,
          [line!],
          {
            addressId: dto.addressId,
            shippingZoneId: dto.shippingZoneId,
            paymentMethodId: dto.paymentMethodId,
            points: 0,
          },
          rates,
          {
            paymentWindowMs: PAYMENT_WINDOW_MS,
            subscriptionId: subscription.id,
          },
        );
        await this.audit.record(
          {
            actorId: user.id,
            action: 'subscription.created',
            entityType: 'subscription',
            entityId: subscription.id,
            metadata: { orderId: order.id, intervalDays: dto.intervalDays },
          },
          tx,
        );
        return subscription;
      });
      return this.get(user.id, created.id);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException(
          'Ya tienes una suscripción de este producto: cámbiala o cancélala primero',
        );
      }
      throw error;
    }
  }

  async update(user: AuthUser, id: string, dto: UpdateSubscriptionDto) {
    const current = await this.open(user.id, id);
    await this.assertDelivery(this.prisma, user.id, {
      addressId: dto.addressId ?? current.addressId,
      shippingZoneId: dto.shippingZoneId ?? current.shippingZoneId,
      paymentMethodId: dto.paymentMethodId ?? current.paymentMethodId,
    });
    await this.prisma.subscription.update({ where: { id }, data: dto });
    await this.audit.record({
      actorId: user.id,
      action: 'subscription.updated',
      entityType: 'subscription',
      entityId: id,
      metadata: { fields: Object.keys(dto) },
    });
    return this.get(user.id, id);
  }

  async pause(user: AuthUser, id: string) {
    return this.setStatus(user, id, ['ACTIVE'], { status: 'PAUSED' }, 'paused');
  }

  // Al reanudar, la próxima entrega es mañana (o antes si ya le tocaba más tarde).
  async resume(user: AuthUser, id: string) {
    const current = await this.open(user.id, id);
    const soon = new Date(Date.now() + DAY);
    return this.setStatus(
      user,
      id,
      ['PAUSED'],
      {
        status: 'ACTIVE',
        failures: 0,
        lastError: null,
        nextRunAt:
          current.nextRunAt > soon
            ? soon
            : current.nextRunAt < new Date()
              ? soon
              : current.nextRunAt,
      },
      'resumed',
    );
  }

  async cancel(user: AuthUser, id: string) {
    return this.setStatus(
      user,
      id,
      ['ACTIVE', 'PAUSED'],
      { status: 'CANCELLED', cancelledAt: new Date() },
      'cancelled',
    );
  }

  private async setStatus(
    user: AuthUser,
    id: string,
    from: ('ACTIVE' | 'PAUSED')[],
    data: Prisma.SubscriptionUpdateManyMutationInput,
    event: string,
  ) {
    await this.open(user.id, id);
    const { count } = await this.prisma.subscription.updateMany({
      where: { id, userId: user.id, status: { in: from } },
      data,
    });
    if (count === 0) {
      throw new ConflictException(
        'La suscripción cambió de estado; recarga e inténtalo de nuevo',
      );
    }
    await this.audit.record({
      actorId: user.id,
      action: `subscription.${event}`,
      entityType: 'subscription',
      entityId: id,
    });
    return this.get(user.id, id);
  }

  private async open(userId: string, id: string) {
    const found = await this.prisma.subscription.findFirst({
      where: { id, userId },
    });
    if (!found) throw new NotFoundException('Suscripción no encontrada');
    if (found.status === 'CANCELLED') {
      throw new ConflictException('Esta suscripción ya está cancelada');
    }
    return found;
  }

  async get(userId: string, id: string) {
    const found = await this.prisma.subscription.findFirst({
      where: { id, userId },
      include,
    });
    if (!found) throw new NotFoundException('Suscripción no encontrada');
    return found;
  }

  // ---------- Sistema ----------

  // Crea los pedidos de las suscripciones que ya tocan. Cada una va en su
  // propia transacción: una que falle no frena a las demás. Con 3 fallos
  // seguidos se pausa y se avisa a la persona.
  async runDue(now = new Date()) {
    const due = await this.prisma.subscription.findMany({
      where: { status: 'ACTIVE', nextRunAt: { lte: now } },
      select: { id: true },
      orderBy: { nextRunAt: 'asc' },
      take: 100,
    });
    let created = 0;
    for (const { id } of due) {
      if (await this.runOne(id, now)) created += 1;
    }
    return created;
  }

  private async runOne(id: string, now: Date) {
    const rates = await this.rates.forOrder();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const sub = await tx.subscription.findUnique({ where: { id } });
        if (!sub) return false;
        await tx.$executeRaw`SELECT 1 FROM users WHERE id = ${sub.userId}::uuid FOR UPDATE`;
        // Reclama la entrega: dos procesos a la vez no crean dos pedidos.
        const { count } = await tx.subscription.updateMany({
          where: { id, status: 'ACTIVE', nextRunAt: { lte: now } },
          data: {
            nextRunAt: new Date(now.getTime() + sub.intervalDays * DAY),
            failures: 0,
            lastError: null,
          },
        });
        if (count === 0) return false;
        if (!sub.addressId) {
          throw new BadRequestException(
            'La suscripción no tiene dirección de envío',
          );
        }
        const line = await this.cart.line(tx, sub.variantId, sub.quantity);
        this.assertSubscribable(line?.variant);
        await this.orders.place(
          tx,
          sub.userId,
          [line!],
          {
            addressId: sub.addressId,
            shippingZoneId: sub.shippingZoneId,
            paymentMethodId: sub.paymentMethodId,
            points: 0,
          },
          rates,
          { paymentWindowMs: PAYMENT_WINDOW_MS, subscriptionId: id },
        );
        return true;
      });
    } catch (error) {
      await this.recordFailure(id, now, errorText(error));
      return false;
    }
  }

  private async recordFailure(id: string, now: Date, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.findUnique({
        where: { id },
        include: {
          variant: { select: { product: { select: { name: true } } } },
        },
      });
      if (!sub || sub.status !== 'ACTIVE') return;
      const failures = sub.failures + 1;
      const pause = failures >= MAX_FAILURES;
      await tx.subscription.update({
        where: { id },
        data: {
          failures,
          lastError: reason,
          // Reintenta mañana; tras el tercer fallo se pausa.
          nextRunAt: new Date(now.getTime() + DAY),
          ...(pause && { status: 'PAUSED' as const }),
        },
      });
      if (pause) {
        await this.emails.subscriptionPaused(
          tx,
          sub.userId,
          sub.variant.product.name,
          reason,
        );
        await this.audit.record(
          {
            actorId: null,
            action: 'subscription.auto_paused',
            entityType: 'subscription',
            entityId: id,
            metadata: { reason },
          },
          tx,
        );
      }
    });
  }

  // La dirección es de la persona, la zona llega a su estado y el método está activo.
  private async assertDelivery(
    db: Tx | PrismaService,
    userId: string,
    d: {
      addressId: string | null;
      shippingZoneId: string;
      paymentMethodId: string;
    },
  ) {
    if (!d.addressId) throw new BadRequestException('Elige una dirección');
    const address = await this.addresses.findOwn(db, userId, d.addressId);
    const zone = await db.shippingZone.findFirst({
      where: { id: d.shippingZoneId, isActive: true },
    });
    if (!zone) throw new BadRequestException('Zona de envío no disponible');
    if (!zone.states.includes(address.state)) {
      throw new BadRequestException(
        `La zona «${zone.name}» no llega a ${address.state}`,
      );
    }
    const method = await db.paymentMethod.findFirst({
      where: { id: d.paymentMethodId, isActive: true },
    });
    if (!method) throw new BadRequestException('Método de pago no disponible');
  }

  private assertSubscribable(
    variant:
      | {
          isActive: boolean;
          product: { isActive: boolean; subscribable: boolean };
        }
      | undefined,
  ): asserts variant is NonNullable<typeof variant> {
    if (
      !variant ||
      !variant.isActive ||
      !variant.product.isActive ||
      !variant.product.subscribable
    ) {
      throw new BadRequestException(
        'Este producto no se ofrece con entrega recurrente',
      );
    }
  }
}

export type { Tx };
