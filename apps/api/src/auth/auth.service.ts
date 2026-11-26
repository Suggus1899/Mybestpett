import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import type { Env } from '../config/env.js';
import { AuditService } from '../audit/audit.service.js';
import { Prisma, type Role, type User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { hasAnyRole } from '../common/roles.js';
import type {
  AccessTokenPayload,
  AuthUser,
  RequestMeta,
} from './auth.types.js';
import type { LoginDto, RefreshDto, RegisterDto } from './auth.schemas.js';
import {
  buildToken,
  generateSecret,
  hashSecret,
  parseToken,
  secretMatches,
} from './refresh-token.js';

export interface AuthTokens {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
}

// Token intermedio entre la contraseña y el código: 5 minutos.
export const CHALLENGE_TTL_SECONDS = 300;

export const STAFF_ROLES: Role[] = [
  'ADMIN',
  'ORDERS_OPERATOR',
  'CATALOG_MANAGER',
  'ADOPTION_COORDINATOR',
];

export type PublicUser = Pick<
  User,
  'id' | 'email' | 'firstName' | 'lastName' | 'phone' | 'createdAt'
> & { roles: Role[] };

const publicUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  createdAt: true,
  roles: { select: { role: true }, orderBy: { role: 'asc' } },
} as const;

type UserWithRoles = Omit<PublicUser, 'roles'> & { roles: { role: Role }[] };

export function toPublicUser(user: UserWithRoles): PublicUser {
  const { id, email, firstName, lastName, phone, createdAt } = user;
  return {
    id,
    email,
    firstName,
    lastName,
    phone,
    createdAt,
    roles: user.roles.map((r) => r.role),
  };
}

@Injectable()
export class AuthService {
  // Hash de referencia para comparar cuando el correo no existe, así el tiempo
  // de respuesta no revela si una cuenta está registrada.
  private readonly dummyHash = argon2.hash('petbf-dummy-password');

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
    private readonly audit: AuditService,
  ) {}

  async register(dto: RegisterDto, meta: RequestMeta) {
    const passwordHash = await argon2.hash(dto.password);
    let user: PublicUser;
    try {
      const created = await this.prisma.user.create({
        data: {
          email: dto.email,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
          roles: { create: { role: 'CUSTOMER' } },
        },
        select: publicUserSelect,
      });
      user = toPublicUser(created);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Ya existe una cuenta con ese correo');
      }
      throw error;
    }

    await this.audit.record({
      actorId: user.id,
      action: 'auth.registered',
      entityType: 'user',
      entityId: user.id,
      ip: meta.ip,
    });
    const tokens = await this.issueTokens(user.id, meta);
    return { user, ...tokens };
  }

  async login(dto: LoginDto, meta: RequestMeta) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { roles: { select: { role: true }, orderBy: { role: 'asc' } } },
    });
    const valid = await argon2.verify(
      user?.passwordHash ?? (await this.dummyHash),
      dto.password,
    );
    if (!user || !valid || !user.isActive) {
      await this.audit.record({
        actorId: user?.id ?? null,
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: user?.id ?? null,
        metadata: { email: dto.email },
        ip: meta.ip,
      });
      throw new UnauthorizedException('Correo o contraseña incorrectos');
    }

    // Con 2FA, la contraseña sola no abre sesión: falta el código.
    if (user.totpEnabledAt) {
      const payload: AccessTokenPayload = { sub: user.id, purpose: '2fa' };
      return {
        twoFactorRequired: true as const,
        challengeToken: await this.jwt.signAsync(payload, {
          expiresIn: CHALLENGE_TTL_SECONDS,
        }),
      };
    }

    await this.audit.record({
      actorId: user.id,
      action: 'auth.login',
      entityType: 'user',
      entityId: user.id,
      ip: meta.ip,
    });
    const tokens = await this.issueTokens(user.id, meta);
    return { user: toPublicUser(user), ...tokens };
  }

  // Rotación: cada uso del refresh token entrega uno nuevo e invalida el anterior.
  async refresh(dto: RefreshDto, meta: RequestMeta): Promise<AuthTokens> {
    const parsed = parseToken(dto.refreshToken);
    if (!parsed) throw new UnauthorizedException('Sesión inválida');

    const session = await this.prisma.session.findUnique({
      where: { id: parsed.sessionId },
      include: { user: { select: { isActive: true } } },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      !session.user.isActive
    ) {
      throw new UnauthorizedException('Sesión inválida');
    }

    if (!secretMatches(parsed.secret, session.refreshTokenHash)) {
      // Alguien usó un token ya rotado: puede ser un robo. Se cierra la sesión.
      await this.prisma.session.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      await this.audit.record({
        actorId: session.userId,
        action: 'auth.refresh_reuse_detected',
        entityType: 'session',
        entityId: session.id,
        ip: meta.ip,
      });
      throw new UnauthorizedException('Sesión inválida');
    }

    const secret = generateSecret();
    // updateMany con el hash anterior evita que dos peticiones simultáneas
    // roten el mismo token.
    const { count } = await this.prisma.session.updateMany({
      where: { id: session.id, refreshTokenHash: session.refreshTokenHash },
      data: {
        refreshTokenHash: hashSecret(secret),
        lastUsedAt: new Date(),
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
    if (count === 0) throw new UnauthorizedException('Sesión inválida');

    return {
      accessToken: await this.signAccessToken(session.userId, session.id),
      accessTokenExpiresIn: this.accessTtl(),
      refreshToken: buildToken(session.id, secret),
    };
  }

  async logout(dto: RefreshDto): Promise<void> {
    const parsed = parseToken(dto.refreshToken);
    if (!parsed) return;
    const session = await this.prisma.session.findUnique({
      where: { id: parsed.sessionId },
    });
    if (
      !session ||
      session.revokedAt ||
      !secretMatches(parsed.secret, session.refreshTokenHash)
    ) {
      return;
    }
    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
  }

  async me(auth: AuthUser) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: auth.id },
      select: { ...publicUserSelect, totpEnabledAt: true },
    });
    const { totpEnabledAt, ...rest } = user;
    return {
      ...toPublicUser(rest),
      twoFactor: {
        enabled: totpEnabledAt !== null,
        // Solo el equipo la configura; para él es obligatoria si así se indica.
        available: hasAnyRole(auth, STAFF_ROLES),
        required:
          hasAnyRole(auth, STAFF_ROLES) &&
          this.config.get('STAFF_2FA_REQUIRED', { infer: true }),
        verified: auth.mfa,
      },
    };
  }

  async issueTokens(
    userId: string,
    meta: RequestMeta,
    mfa = false,
  ): Promise<AuthTokens> {
    const secret = generateSecret();
    const ttlDays = this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true });
    const session = await this.prisma.session.create({
      data: {
        userId,
        refreshTokenHash: hashSecret(secret),
        ip: meta.ip,
        userAgent: meta.userAgent,
        expiresAt: new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000),
        mfa,
      },
    });
    return {
      accessToken: await this.signAccessToken(userId, session.id),
      accessTokenExpiresIn: this.accessTtl(),
      refreshToken: buildToken(session.id, secret),
    };
  }

  private signAccessToken(userId: string, sessionId: string) {
    const payload: AccessTokenPayload = { sub: userId, sid: sessionId };
    return this.jwt.signAsync(payload);
  }

  private accessTtl() {
    return this.config.get('JWT_ACCESS_TTL_SECONDS', { infer: true });
  }
}
