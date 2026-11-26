import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { paged, paginate } from '../common/pagination.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ListPaymentsQuery, ReportPaymentDto } from './orders.schemas.js';
import { OrdersService, withCode } from './orders.service.js';
import { PAYMENT_WINDOW_MS } from './pricing.js';
import {
  MAX_PROOF_BYTES,
  proofFileName,
  sha256,
  sniffProofType,
} from './proofs.js';

const proofMeta = {
  contentType: true,
  sizeBytes: true,
  createdAt: true,
} as const;

// Margen para relojes desfasados entre el teléfono del cliente y el servidor.
const CLOCK_SKEW_MS = 10 * 60 * 1000;

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly orders: OrdersService,
  ) {}

  // El cliente declara su pago. No da el pedido por pagado: eso lo decide el equipo.
  async report(user: AuthUser, orderId: string, dto: ReportPaymentDto) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId: user.id },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    if (order.status === 'PAYMENT_REPORTED') {
      throw new ConflictException(
        'Ya reportaste un pago; espera a que el equipo lo revise',
      );
    }
    if (order.status !== 'PENDING_PAYMENT') {
      throw new ConflictException('Este pedido no admite reportes de pago');
    }
    const now = new Date();
    if (order.paymentDueAt < now) {
      await this.orders.expireOverdue(now);
      throw new ConflictException(
        'El plazo de 2 horas para reportar el pago venció y el pedido se canceló',
      );
    }
    const paidAt = new Date(dto.paidAt);
    if (paidAt.getTime() > now.getTime() + CLOCK_SKEW_MS) {
      throw new ConflictException(
        'La fecha del pago no puede estar en el futuro',
      );
    }
    if (paidAt.getTime() < order.createdAt.getTime() - CLOCK_SKEW_MS) {
      throw new ConflictException('La fecha del pago es anterior al pedido');
    }
    await this.ensureReferenceFree(order.paymentMethodId, dto.reference);

    await this.prisma.$transaction(async (tx) => {
      await this.orders.transition(
        tx,
        orderId,
        ['PENDING_PAYMENT'],
        { status: 'PAYMENT_REPORTED' },
        user.id,
        `Referencia ${dto.reference}`,
      );
      await tx.payment.create({
        data: {
          orderId,
          methodId: order.paymentMethodId,
          currency: order.chargedCurrency,
          amount: dto.amount,
          reference: dto.reference,
          originBank: dto.originBank || null,
          paidAt,
        },
      });
    });
    return this.orders.getMine(user.id, orderId);
  }

  // El cliente adjunta (o reemplaza) el comprobante mientras el pago espera revisión.
  async attachProof(
    user: AuthUser,
    orderId: string,
    paymentId: string,
    file: { buffer: Buffer; size: number } | undefined,
  ) {
    if (!file || file.size === 0) {
      throw new BadRequestException(
        'Adjunta el comprobante en el campo "file"',
      );
    }
    if (file.size > MAX_PROOF_BYTES) {
      throw new BadRequestException('El comprobante pesa más de 5 MB');
    }
    const contentType = sniffProofType(file.buffer);
    if (!contentType) {
      throw new BadRequestException(
        'El comprobante debe ser una imagen JPG, PNG o WebP, o un PDF',
      );
    }
    const payment = await this.customerPayment(user, orderId, paymentId);
    if (payment.status !== 'REPORTED') {
      throw new ConflictException(
        'Este pago ya fue revisado: no admite comprobante',
      );
    }
    const data = {
      contentType,
      sizeBytes: file.size,
      sha256: sha256(file.buffer),
      data: new Uint8Array(file.buffer),
    };
    return this.prisma.paymentProof.upsert({
      where: { paymentId },
      create: { paymentId, ...data },
      update: { ...data, createdAt: new Date() },
      select: proofMeta,
    });
  }

  async customerProof(user: AuthUser, orderId: string, paymentId: string) {
    const payment = await this.customerPayment(user, orderId, paymentId);
    return this.proofFile(payment.id, payment.reference);
  }

  async staffProof(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      select: { id: true, reference: true },
    });
    if (!payment) throw new NotFoundException('Pago no encontrado');
    return this.proofFile(payment.id, payment.reference);
  }

  private async proofFile(paymentId: string, reference: string) {
    const proof = await this.prisma.paymentProof.findUnique({
      where: { paymentId },
    });
    if (!proof) throw new NotFoundException('Este pago no tiene comprobante');
    return {
      data: Buffer.from(proof.data),
      contentType: proof.contentType,
      fileName: proofFileName(reference, proof.contentType),
    };
  }

  // El pago de otro cliente, o de otro pedido, responde 404 como uno inexistente.
  private async customerPayment(
    user: AuthUser,
    orderId: string,
    paymentId: string,
  ) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, orderId, order: { userId: user.id } },
      select: { id: true, reference: true, status: true },
    });
    if (!payment) throw new NotFoundException('Pago no encontrado');
    return payment;
  }

  // Cola del equipo. Por defecto, los reportados, del más antiguo al más nuevo.
  async list(query: ListPaymentsQuery) {
    const where = { status: query.status };
    const [items, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: query.status === 'REPORTED' ? 'asc' : 'desc' },
        ...paginate(query.page, query.pageSize),
        include: {
          method: { select: { code: true, name: true } },
          proof: { select: proofMeta },
          order: {
            select: {
              id: true,
              number: true,
              status: true,
              totalCharged: true,
              chargedCurrency: true,
              totalUsdCents: true,
              user: {
                select: { email: true, firstName: true, lastName: true },
              },
            },
          },
        },
      }),
      this.prisma.payment.count({ where }),
    ]);
    return paged(
      items.map((p) => ({ ...p, order: withCode(p.order) })),
      total,
      query.page,
      query.pageSize,
    );
  }

  // El operador confirmó el movimiento en el banco: el pedido pasa a pagado.
  async verify(actor: AuthUser, id: string) {
    const payment = await this.reviewable(actor, id);
    await this.ensureReferenceFree(payment.methodId, payment.reference);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.payment.updateMany({
        where: { id, status: 'REPORTED' },
        data: { status: 'VERIFIED', verifiedById: actor.id, verifiedAt: now },
      });
      if (count === 0) throw new ConflictException('Este pago ya fue revisado');
      await this.orders.transition(
        tx,
        payment.orderId,
        ['PAYMENT_REPORTED'],
        { status: 'PAID', paidAt: now },
        actor.id,
        'Pago verificado',
      );
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'payment.verified',
          entityType: 'payment',
          entityId: id,
          metadata: { orderId: payment.orderId, reference: payment.reference },
        },
        tx,
      );
    });
    return this.orders.getManage(payment.orderId);
  }

  // No coincide con el banco: se rechaza con motivo y el cliente tiene otras 2 horas.
  async reject(actor: AuthUser, id: string, reason: string) {
    const payment = await this.reviewable(actor, id);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.payment.updateMany({
        where: { id, status: 'REPORTED' },
        data: {
          status: 'REJECTED',
          rejectionReason: reason,
          verifiedById: actor.id,
          verifiedAt: now,
        },
      });
      if (count === 0) throw new ConflictException('Este pago ya fue revisado');
      await this.orders.transition(
        tx,
        payment.orderId,
        ['PAYMENT_REPORTED'],
        {
          status: 'PENDING_PAYMENT',
          paymentDueAt: new Date(now.getTime() + PAYMENT_WINDOW_MS),
        },
        actor.id,
        `Pago rechazado: ${reason}`,
      );
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'payment.rejected',
          entityType: 'payment',
          entityId: id,
          metadata: { orderId: payment.orderId, reason },
        },
        tx,
      );
    });
    return this.orders.getManage(payment.orderId);
  }

  private async reviewable(actor: AuthUser, id: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id },
      include: { order: { select: { userId: true } } },
    });
    if (!payment) throw new NotFoundException('Pago no encontrado');
    if (payment.status !== 'REPORTED') {
      throw new ConflictException('Este pago ya fue revisado');
    }
    // Con dinero de por medio, nadie revisa el pago de su propio pedido.
    if (payment.order.userId === actor.id) {
      throw new ForbiddenException(
        'No puedes revisar el pago de tu propio pedido',
      );
    }
    return payment;
  }

  // Una referencia ya verificada con el mismo método no puede pagar otro pedido.
  // El índice único parcial de la base lo garantiza también ante carreras.
  private async ensureReferenceFree(methodId: string, reference: string) {
    const used = await this.prisma.payment.findFirst({
      where: { methodId, reference, status: 'VERIFIED' },
      select: { id: true },
    });
    if (used)
      throw new ConflictException('Esa referencia ya se usó en otro pago');
  }
}
