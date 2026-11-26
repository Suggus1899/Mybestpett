import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { AuditService } from '../audit/audit.service.js';
import { hasAnyRole } from '../common/roles.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthService, STAFF_ROLES, toPublicUser } from './auth.service.js';
import type {
  AccessTokenPayload,
  AuthUser,
  RequestMeta,
} from './auth.types.js';
import {
  decryptSecret,
  deriveKey,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  otpauthUrl,
  verifyTotp,
} from './totp.js';

// Tras 5 códigos incorrectos seguidos, la cuenta espera 15 minutos.
export const MAX_CODE_FAILURES = 5;
export const LOCK_MS = 15 * 60 * 1000;

type Owner = {
  id: string;
  totpSecret: string | null;
  totpLastStep: number | null;
  recoveryCodes: string[];
};

@Injectable()
export class TwoFactorService {
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    config: ConfigService<Env, true>,
  ) {
    this.key = deriveKey(
      config.get('TOTP_ENCRYPTION_KEY', { infer: true }) ??
        config.get('JWT_ACCESS_SECRET', { infer: true }),
    );
  }

  // Paso 1: genera el secreto para la app de autenticación. No se activa
  // hasta confirmarlo con un código.
  async setup(user: AuthUser) {
    if (!hasAnyRole(user, STAFF_ROLES)) {
      throw new ForbiddenException(
        'La verificación en dos pasos está disponible para el equipo',
      );
    }
    const current = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { totpEnabledAt: true },
    });
    if (current.totpEnabledAt) {
      throw new ConflictException(
        'Ya tienes la verificación en dos pasos activa',
      );
    }
    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { totpPendingSecret: encryptSecret(secret, this.key) },
    });
    return { secret, otpauthUrl: otpauthUrl(secret, user.email) };
  }

  // Paso 2: confirma con un código de la app. Devuelve los códigos de
  // recuperación una sola vez y marca la sesión actual como verificada.
  async enable(user: AuthUser, code: string) {
    const current = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { totpEnabledAt: true, totpPendingSecret: true },
    });
    if (current.totpEnabledAt) {
      throw new ConflictException(
        'Ya tienes la verificación en dos pasos activa',
      );
    }
    if (!current.totpPendingSecret) {
      throw new ConflictException('Primero genera la clave para tu app');
    }
    const secret = decryptSecret(current.totpPendingSecret, this.key);
    const step = verifyTotp(secret, code);
    // 400 y no 401: la sesión es válida, lo que falla es el código.
    if (step === null) throw new BadRequestException('Código incorrecto');

    const recoveryCodes = generateRecoveryCodes();
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: { id: user.id, totpEnabledAt: null },
        data: {
          totpSecret: current.totpPendingSecret,
          totpPendingSecret: null,
          totpEnabledAt: new Date(),
          totpLastStep: step,
          totpFailures: 0,
          totpLockedUntil: null,
          recoveryCodes: recoveryCodes.map(hashRecoveryCode),
        },
      });
      if (count === 0) {
        throw new ConflictException(
          'Ya tienes la verificación en dos pasos activa',
        );
      }
      if (user.sessionId) {
        await tx.session.update({
          where: { id: user.sessionId },
          data: { mfa: true },
        });
      }
      await this.audit.record(
        {
          actorId: user.id,
          action: 'auth.2fa_enabled',
          entityType: 'user',
          entityId: user.id,
        },
        tx,
      );
    });
    return { recoveryCodes };
  }

  // Desactivarla pide la contraseña y un código: una sesión robada no basta.
  async disable(user: AuthUser, password: string, code: string) {
    const owner = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: {
        id: true,
        passwordHash: true,
        totpEnabledAt: true,
        totpSecret: true,
        totpLastStep: true,
        totpLockedUntil: true,
        recoveryCodes: true,
      },
    });
    if (!owner.totpEnabledAt) {
      throw new ConflictException(
        'La verificación en dos pasos no está activa',
      );
    }
    this.ensureNotLocked(owner.totpLockedUntil);
    if (!(await argon2.verify(owner.passwordHash, password))) {
      throw new BadRequestException('Contraseña incorrecta');
    }
    if (!(await this.consumeCode(owner, code))) {
      await this.registerFailure(user.id);
      throw new BadRequestException('Código incorrecto');
    }
    await this.clear(user.id, user.id, 'auth.2fa_disabled');
  }

  // Segundo paso del login: el token intermedio y un código de la app o de
  // recuperación. Abre una sesión verificada.
  async login(challengeToken: string, code: string, meta: RequestMeta) {
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(challengeToken);
    } catch {
      throw new UnauthorizedException(
        'El inicio de sesión venció; vuelve a escribir tu contraseña',
      );
    }
    if (payload.purpose !== '2fa') {
      throw new UnauthorizedException('Token inválido');
    }
    const owner = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        isActive: true,
        totpEnabledAt: true,
        totpSecret: true,
        totpLastStep: true,
        totpLockedUntil: true,
        recoveryCodes: true,
      },
    });
    if (!owner || !owner.isActive || !owner.totpEnabledAt) {
      throw new UnauthorizedException('Token inválido');
    }
    this.ensureNotLocked(owner.totpLockedUntil);
    const used = await this.consumeCode(owner, code);
    if (!used) {
      await this.registerFailure(owner.id);
      await this.audit.record({
        actorId: owner.id,
        action: 'auth.2fa_failed',
        entityType: 'user',
        entityId: owner.id,
        ip: meta.ip,
      });
      throw new UnauthorizedException('Código incorrecto');
    }
    await this.prisma.user.update({
      where: { id: owner.id },
      data: { totpFailures: 0, totpLockedUntil: null },
    });
    await this.audit.record({
      actorId: owner.id,
      action: 'auth.login',
      entityType: 'user',
      entityId: owner.id,
      ip: meta.ip,
      metadata: { twoFactor: used },
    });
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: owner.id },
      include: { roles: { select: { role: true }, orderBy: { role: 'asc' } } },
    });
    const tokens = await this.auth.issueTokens(owner.id, meta, true);
    return { user: toPublicUser(user), ...tokens };
  }

  // El administrador la quita a quien perdió el teléfono y sus códigos.
  async reset(actor: AuthUser, userId: string) {
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { totpEnabledAt: true, totpPendingSecret: true },
    });
    if (!target) throw new NotFoundException('Usuario no encontrado');
    if (!target.totpEnabledAt && !target.totpPendingSecret) {
      throw new ConflictException(
        'Esa persona no tiene verificación en dos pasos',
      );
    }
    await this.clear(userId, actor.id, 'auth.2fa_reset');
  }

  // Un código de la app (nunca uno ya usado) o un código de recuperación,
  // que se borra al usarlo. Las condiciones del update evitan que dos
  // peticiones simultáneas usen el mismo código.
  private async consumeCode(
    owner: Owner,
    code: string,
  ): Promise<'totp' | 'recovery' | null> {
    const clean = code.replace(/\s/g, '');
    if (/^\d{6}$/.test(clean) && owner.totpSecret) {
      const secret = decryptSecret(owner.totpSecret, this.key);
      const step = verifyTotp(secret, clean, Date.now(), owner.totpLastStep);
      if (step === null) return null;
      const { count } = await this.prisma.user.updateMany({
        where: {
          id: owner.id,
          OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }],
        },
        data: { totpLastStep: step },
      });
      return count === 1 ? 'totp' : null;
    }
    const hash = hashRecoveryCode(clean);
    if (!owner.recoveryCodes.includes(hash)) return null;
    const { count } = await this.prisma.user.updateMany({
      where: { id: owner.id, recoveryCodes: { has: hash } },
      data: { recoveryCodes: owner.recoveryCodes.filter((h) => h !== hash) },
    });
    return count === 1 ? 'recovery' : null;
  }

  private ensureNotLocked(lockedUntil: Date | null) {
    if (lockedUntil && lockedUntil > new Date()) {
      throw new ForbiddenException(
        'Demasiados códigos incorrectos. Espera 15 minutos e inténtalo de nuevo',
      );
    }
  }

  private async registerFailure(userId: string) {
    const { totpFailures } = await this.prisma.user.update({
      where: { id: userId },
      data: { totpFailures: { increment: 1 } },
      select: { totpFailures: true },
    });
    if (totpFailures >= MAX_CODE_FAILURES) {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          totpFailures: 0,
          totpLockedUntil: new Date(Date.now() + LOCK_MS),
        },
      });
    }
  }

  private async clear(userId: string, actorId: string, action: string) {
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          totpSecret: null,
          totpPendingSecret: null,
          totpEnabledAt: null,
          totpLastStep: null,
          totpFailures: 0,
          totpLockedUntil: null,
          recoveryCodes: [],
        },
      });
      // Ninguna sesión abierta conserva la verificación.
      await tx.session.updateMany({ where: { userId }, data: { mfa: false } });
      await this.audit.record(
        { actorId, action, entityType: 'user', entityId: userId },
        tx,
      );
    });
  }
}
