import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Env } from '../config/env.js';
import { hasAnyRole } from '../common/roles.js';
import type { AuthUser } from './auth.types.js';
import { Roles } from './decorators.js';

// Se ejecuta después de JwtAuthGuard. Sin @Roles basta con tener sesión.
// Con @Roles basta con tener uno de los roles indicados, o ser ADMIN, y que la
// sesión haya pasado la verificación en dos pasos (STAFF_2FA_REQUIRED).
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService<Env, true>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride(Roles, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;

    const user: AuthUser | undefined = context.switchToHttp().getRequest().user;
    if (!hasAnyRole(user, roles)) {
      throw new ForbiddenException('No tienes permiso para esta acción');
    }
    if (this.config.get('STAFF_2FA_REQUIRED', { infer: true }) && !user?.mfa) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'TWO_FACTOR_REQUIRED',
        message: 'Entra con la verificación en dos pasos para usar el panel',
      });
    }
    return true;
  }
}
