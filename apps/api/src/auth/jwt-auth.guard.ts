import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AccessTokenPayload, AuthUser } from './auth.types.js';
import { IS_PUBLIC_KEY } from './decorators.js';

// Guard global: toda ruta exige un access token válido salvo las @Public().
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Falta el token de acceso');
    }

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Token inválido o vencido');
    }
    if (payload.purpose) {
      throw new UnauthorizedException('Token inválido o vencido');
    }

    // Se lee el usuario en cada petición para que un cambio de rol o una
    // desactivación tengan efecto inmediato, sin esperar a que venza el token.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        isActive: true,
        roles: { select: { role: true } },
        sessions: payload.sid
          ? {
              where: { id: payload.sid },
              select: { mfa: true, revokedAt: true, expiresAt: true },
            }
          : false,
      },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Usuario no disponible');
    }
    // Al cerrar sesión, el token de acceso deja de servir de inmediato.
    const session = user.sessions?.[0];
    if (
      payload.sid &&
      (!session || session.revokedAt || session.expiresAt <= new Date())
    ) {
      throw new UnauthorizedException('Sesión cerrada');
    }

    request.user = {
      id: user.id,
      email: user.email,
      roles: user.roles.map((r) => r.role),
      sessionId: payload.sid ?? null,
      mfa: session?.mfa ?? false,
    } satisfies AuthUser;
    return true;
  }
}
