import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  CreateZoneDto,
  UpdatePaymentMethodDto,
  UpdateZoneDto,
} from './store.schemas.js';

const order = [{ sortOrder: 'asc' }, { name: 'asc' }] as const;

// Configuración de la tienda que usa el checkout: zonas de envío y métodos de pago.
@Injectable()
export class StoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  zones(all = false) {
    return this.prisma.shippingZone.findMany({
      where: all ? {} : { isActive: true },
      orderBy: [...order],
    });
  }

  paymentMethods(all = false) {
    return this.prisma.paymentMethod.findMany({
      where: all ? {} : { isActive: true },
      orderBy: [...order],
    });
  }

  async createZone(actor: AuthUser, dto: CreateZoneDto) {
    return this.prisma.$transaction(async (tx) => {
      const zone = await tx.shippingZone.create({ data: dto });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'shipping_zone.created',
          entityType: 'shipping_zone',
          entityId: zone.id,
        },
        tx,
      );
      return zone;
    });
  }

  async updateZone(actor: AuthUser, id: string, dto: UpdateZoneDto) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.shippingZone.findUniqueOrThrow({ where: { id } });
      const zone = await tx.shippingZone.update({ where: { id }, data: dto });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'shipping_zone.updated',
          entityType: 'shipping_zone',
          entityId: id,
          metadata: { from: pick(before, dto), to: pick(zone, dto) },
        },
        tx,
      );
      return zone;
    });
  }

  async updatePaymentMethod(
    actor: AuthUser,
    id: string,
    dto: UpdatePaymentMethodDto,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.paymentMethod.findUniqueOrThrow({
        where: { id },
      });
      const method = await tx.paymentMethod.update({
        where: { id },
        data: dto,
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'payment_method.updated',
          entityType: 'payment_method',
          entityId: id,
          metadata: { from: pick(before, dto), to: pick(method, dto) },
        },
        tx,
      );
      return method;
    });
  }
}

// Solo los campos que se pidieron cambiar, para el registro de auditoría.
function pick<T extends object>(row: T, dto: object): Prisma.InputJsonObject {
  return Object.fromEntries(
    Object.keys(dto).map((k) => [
      k,
      row[k as keyof T] as Prisma.InputJsonValue,
    ]),
  );
}
