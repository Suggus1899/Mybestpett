import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service.js';
import {
  loginSchema,
  refreshSchema,
  registerSchema,
  type LoginDto,
  type RefreshDto,
  type RegisterDto,
} from './auth.schemas.js';
import type { AuthUser, RequestMeta } from './auth.types.js';
import { CurrentUser, Public } from './decorators.js';
import { ReqMeta } from './request-meta.js';

// Límite más estricto en las rutas que reciben contraseñas.
const strict = { default: { limit: 10, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle(strict)
  @Post('register')
  register(
    @Body({ schema: registerSchema }) dto: RegisterDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.auth.register(dto, meta);
  }

  @Public()
  @Throttle(strict)
  @HttpCode(200)
  @Post('login')
  login(
    @Body({ schema: loginSchema }) dto: LoginDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.auth.login(dto, meta);
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  refresh(
    @Body({ schema: refreshSchema }) dto: RefreshDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.auth.refresh(dto, meta);
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  logout(@Body({ schema: refreshSchema }) dto: RefreshDto) {
    return this.auth.logout(dto);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }
}
