import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { hasAnyRole } from '../common/roles.js';
import type { AuthUser } from './auth.types.js';
import { Roles } from './decorators.js';

// Se ejecuta después de JwtAuthGuard. Sin @Roles basta con tener sesión.
// Con @Roles basta con tener uno de los roles indicados, o ser ADMIN.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

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
    return true;
  }
}
