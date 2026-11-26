import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
}

type Db = Pick<PrismaService, 'auditLog'> | Prisma.TransactionClient;

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Pasa `tx` cuando la acción ocurre dentro de una transacción, para que el
  // registro se guarde (o se descarte) junto con el cambio que describe.
  async record(entry: AuditEntry, tx: Db = this.prisma): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        metadata: entry.metadata,
        ip: entry.ip ?? null,
      },
    });
    this.logger.log(
      `${entry.action} ${entry.entityType}:${entry.entityId ?? '-'}`,
    );
  }
}
