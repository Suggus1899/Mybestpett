import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { Role } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  ChangeStatusDto,
  ListUsersQuery,
  SetRolesDto,
} from './users.schemas.js';

const select = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  isActive: true,
  createdAt: true,
  roles: { select: { role: true }, orderBy: { role: 'asc' } },
} as const;

type Row = { roles: { role: Role }[] } & Record<string, unknown>;

const serialize = <T extends Row>(user: T) => ({
  ...user,
  roles: user.roles.map((r) => r.role),
});

// Mismo orden que el enum (y que devuelve PostgreSQL), sin duplicados.
const inRoleOrder = (roles: Role[]) =>
  Object.values(Role).filter((role) => roles.includes(role));

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListUsersQuery) {
    const where = query.role ? { roles: { some: { role: query.role } } } : {};
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
    return {
      items: items.map(serialize),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async setRoles(actor: AuthUser, userId: string, dto: SetRolesDto) {
    // CUSTOMER siempre se conserva: todo el personal también puede comprar.
    const next = inRoleOrder(['CUSTOMER', ...dto.roles]);
    // Evita que el administrador se quite su propio acceso por error.
    if (actor.id === userId && !next.includes('ADMIN')) {
      throw new BadRequestException(
        'No puedes quitarte el rol de administrador',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { roles: { select: { role: true } } },
      });
      if (!user) throw new NotFoundException('Usuario no encontrado');
      const current = inRoleOrder(user.roles.map((r) => r.role));

      const added = next.filter((role) => !current.includes(role));
      const removed = current.filter((role) => !next.includes(role));
      if (added.length > 0) {
        await tx.userRole.createMany({
          data: added.map((role) => ({ userId, role, grantedById: actor.id })),
        });
      }
      if (removed.length > 0) {
        await tx.userRole.deleteMany({
          where: { userId, role: { in: removed } },
        });
      }
      if (added.length > 0 || removed.length > 0) {
        await this.audit.record(
          {
            actorId: actor.id,
            action: 'user.roles_changed',
            entityType: 'user',
            entityId: userId,
            metadata: { from: current, to: next },
          },
          tx,
        );
      }
      return serialize(
        await tx.user.findUniqueOrThrow({ where: { id: userId }, select }),
      );
    });
  }

  async changeStatus(actor: AuthUser, userId: string, dto: ChangeStatusDto) {
    if (actor.id === userId) {
      throw new BadRequestException('No puedes desactivar tu propia cuenta');
    }
    return this.prisma.$transaction(async (tx) => {
      const exists = await tx.user.count({ where: { id: userId } });
      if (!exists) throw new NotFoundException('Usuario no encontrado');

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
      return serialize(updated);
    });
  }
}
