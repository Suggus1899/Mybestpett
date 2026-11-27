import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import type { OrderStatus } from '../generated/prisma/enums.js';
import type { Prisma } from '../generated/prisma/client.js';
import { orderCode, RETURN_WINDOW_MS } from '../orders/pricing.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { money, templates, type Email, type OrderInfo } from './templates.js';

type Db = Prisma.TransactionClient | PrismaService;

export const MAX_ATTEMPTS = 5;
const BATCH = 20;

// Espera antes del siguiente intento: 1, 4, 9, 16 minutos.
function backoffMs(attempt: number) {
  return attempt * attempt * 60_000;
}

@Injectable()
export class EmailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EmailService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // Cada 30 segundos envía lo pendiente. En las pruebas se llama a mano.
  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      this.deliverPending().catch((error: unknown) =>
        this.logger.error('No se pudo procesar la bandeja de correos', error),
      );
    }, 30_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  // Guarda el correo en la bandeja. Con `tx`, solo existe si el cambio que lo
  // origina se confirma.
  async enqueue(db: Db, to: string, email: Email, kind: string) {
    await db.emailOutbox.create({ data: { to, kind, ...email } });
  }

  // Avisa que una suscripción se pausó sola tras varios intentos fallidos.
  async subscriptionPaused(
    db: Db,
    userId: string,
    productName: string,
    reason: string,
  ) {
    const user = await db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, firstName: true },
    });
    const web = this.config.get('WEB_URL', { infer: true }).replace(/\/$/, '');
    await this.enqueue(
      db,
      user.email,
      templates.subscriptionPaused(
        user.firstName,
        productName,
        reason,
        `${web}/cuenta/suscripciones`,
      ),
      'subscription.paused',
    );
  }

  // Avisa al cliente del cambio de estado de su pedido.
  async orderEvent(
    db: Db,
    orderId: string,
    status: OrderStatus,
    note?: string | null,
    from?: OrderStatus | null,
  ) {
    const order = await this.loadOrder(db, orderId);
    const info = this.info(order);
    let email: Email | null = null;
    switch (status) {
      case 'PENDING_PAYMENT':
        email =
          from === 'PAYMENT_REPORTED'
            ? templates.paymentRejected(
                info,
                (note ?? '').replace(/^Pago rechazado: /, ''),
                order.paymentDueAt,
              )
            : order.subscription
              ? templates.subscriptionOrder(
                  info,
                  order.subscription.variant.product.name,
                  order.paymentDueAt,
                  order.paymentMethod.instructions,
                )
              : templates.orderCreated(
                  info,
                  order.paymentDueAt,
                  order.paymentMethod.instructions,
                );
        break;
      case 'PAID':
        email = templates.paymentVerified(info);
        break;
      case 'SHIPPED':
        email = templates.shipped(info, order.carrier, order.trackingCode);
        break;
      case 'DELIVERED':
        email = templates.delivered(
          info,
          new Date(
            (order.deliveredAt ?? new Date()).getTime() + RETURN_WINDOW_MS,
          ),
        );
        break;
      case 'CANCELLED':
        email = templates.cancelled(info, note ?? null);
        break;
      default:
        // En revisión, preparación y reembolsado no generan correo: el
        // reembolso ya avisa con su propio correo.
        return;
    }
    await this.enqueue(
      db,
      order.user.email,
      email,
      `order.${status.toLowerCase()}`,
    );
  }

  async returnEvent(
    db: Db,
    returnId: string,
    event: 'approved' | 'rejected' | 'refunded',
  ) {
    const found = await db.returnRequest.findUniqueOrThrow({
      where: { id: returnId },
      select: {
        orderId: true,
        decisionNote: true,
        refundAmount: true,
        currency: true,
        refundReference: true,
      },
    });
    const order = await this.loadOrder(db, found.orderId);
    const info = this.info(order);
    const email =
      event === 'approved'
        ? templates.returnApproved(info, found.decisionNote)
        : event === 'rejected'
          ? templates.returnRejected(info, found.decisionNote ?? '')
          : templates.returnRefunded(
              info,
              money(found.refundAmount, found.currency),
              found.refundReference ?? '',
            );
    await this.enqueue(db, order.user.email, email, `return.${event}`);
  }

  // Envía los pendientes. Cada correo se reserva antes de enviarlo (sube el
  // contador y aplaza el próximo intento), así dos procesos no lo mandan dos veces.
  async deliverPending(now = new Date()) {
    const due = await this.prisma.emailOutbox.findMany({
      where: { status: 'PENDING', nextAttemptAt: { lte: now } },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
    });
    let sent = 0;
    for (const email of due) {
      const attempt = email.attempts + 1;
      const { count } = await this.prisma.emailOutbox.updateMany({
        where: { id: email.id, status: 'PENDING', attempts: email.attempts },
        data: {
          attempts: attempt,
          nextAttemptAt: new Date(now.getTime() + backoffMs(attempt)),
        },
      });
      if (count === 0) continue;
      try {
        await this.send(email);
        await this.prisma.emailOutbox.update({
          where: { id: email.id },
          data: { status: 'SENT', sentAt: new Date(), lastError: null },
        });
        sent += 1;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Error desconocido';
        await this.prisma.emailOutbox.update({
          where: { id: email.id },
          data: {
            lastError: message.slice(0, 500),
            ...(attempt >= MAX_ATTEMPTS && { status: 'FAILED' as const }),
          },
        });
        this.logger.warn(
          `Correo ${email.id} falló (intento ${attempt}): ${message}`,
        );
      }
    }
    return sent;
  }

  private async send(email: { to: string; subject: string; text: string }) {
    if (this.config.get('EMAIL_PROVIDER', { infer: true }) === 'log') {
      this.logger.log(`Correo a ${email.to}: ${email.subject}`);
      return;
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.get('RESEND_API_KEY', { infer: true })}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.config.get('EMAIL_FROM', { infer: true }),
        to: [email.to],
        subject: email.subject,
        text: email.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      throw new Error(
        `Resend respondió ${res.status}: ${(await res.text()).slice(0, 200)}`,
      );
    }
  }

  private loadOrder(db: Db, id: string) {
    return db.order.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        number: true,
        totalCharged: true,
        chargedCurrency: true,
        paymentDueAt: true,
        carrier: true,
        trackingCode: true,
        deliveredAt: true,
        subscription: {
          select: {
            variant: { select: { product: { select: { name: true } } } },
          },
        },
        user: { select: { email: true, firstName: true } },
        paymentMethod: { select: { name: true, instructions: true } },
      },
    });
  }

  private info(
    order: Awaited<ReturnType<EmailService['loadOrder']>>,
  ): OrderInfo {
    const web = this.config.get('WEB_URL', { infer: true }).replace(/\/$/, '');
    return {
      code: orderCode(order.number),
      firstName: order.user.firstName,
      url: `${web}/pedidos/${order.id}`,
      total: money(order.totalCharged, order.chargedCurrency),
      methodName: order.paymentMethod.name,
    };
  }
}
