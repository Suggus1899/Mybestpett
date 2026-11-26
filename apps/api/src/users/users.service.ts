import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  ChangeRoleDto,
  ChangeStatusDto,
  ListUsersQuery,
} from './users.schemas.js';

const select = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  role: true,
  isActive: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListUsersQuery) {
    const where = query.role ? { role: query.role } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, page: query.page, pageSize: query.pageSize };
  }

  async changeRole(actor: AuthUser, userId: string, dto: ChangeRoleDto) {
    // Evita que el administrador se quite su propio acceso por error.
    if (actor.id === userId) {
      throw new BadRequestException('No puedes cambiar tu propio rol');
    }
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('Usuario no encontrado');
      if (user.role === dto.role)
        return tx.user.findUniqueOrThrow({ where: { id: userId }, select });

      const updated = await tx.user.update({
        where: { id: userId },
        data: { role: dto.role },
        select,
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'user.role_changed',
          entityType: 'user',
          entityId: userId,
          metadata: { from: user.role, to: dto.role },
        },
        tx,
      );
      return updated;
    });
  }

  async changeStatus(actor: AuthUser, userId: string, dto: ChangeStatusDto) {
    if (actor.id === userId) {
      throw new BadRequestException('No puedes desactivar tu propia cuenta');
    }
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('Usuario no encontrado');

      const updated = await tx.user.update({
        where: { id: userId },
        data: { isActive: dto.isActive },
        select,
      });
      if (!dto.isActive) {
        // Cierra todas sus sesiones abiertas.
        await tx.session.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.audit.record(
        {
          actorId: actor.id,
          action: dto.isActive ? 'user.activated' : 'user.deactivated',
          entityType: 'user',
          entityId: userId,
        },
        tx,
      );
      return updated;
    });
  }
}
