import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '../generated/prisma/client.js';
import type { AuthUser } from './auth.types.js';

export const IS_PUBLIC_KEY = 'isPublic';

// Marca una ruta como accesible sin sesión. Por defecto todas exigen sesión.
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

// Limita una ruta a ciertos roles: @Roles(['ADMIN']).
export const Roles = Reflector.createDecorator<Role[]>();

// Inyecta el usuario autenticado en el handler: @CurrentUser() user: AuthUser.
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthUser =>
    context.switchToHttp().getRequest().user,
);
