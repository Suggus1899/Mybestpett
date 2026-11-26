import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service.js';
import {
  disableTwoFactorSchema,
  enableTwoFactorSchema,
  loginSchema,
  refreshSchema,
  registerSchema,
  twoFactorLoginSchema,
  type DisableTwoFactorDto,
  type EnableTwoFactorDto,
  type LoginDto,
  type RefreshDto,
  type RegisterDto,
  type TwoFactorLoginDto,
} from './auth.schemas.js';
import { TwoFactorService } from './two-factor.service.js';
import type { AuthUser, RequestMeta } from './auth.types.js';
import { CurrentUser, Public } from './decorators.js';
import { ReqMeta } from './request-meta.js';

// Límite más estricto en las rutas que reciben contraseñas (10 por minuto
// y por IP; AUTH_THROTTLE_LIMIT ya validado al arrancar).
const strict = {
  default: {
    limit: () => Number(process.env.AUTH_THROTTLE_LIMIT ?? 10),
    ttl: 60_000,
  },
};

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly twoFactor: TwoFactorService,
  ) {}

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

  // ---------- Verificación en dos pasos ----------

  @Public()
  @Throttle(strict)
  @HttpCode(200)
  @Post('2fa/login')
  loginWithCode(
    @Body({ schema: twoFactorLoginSchema }) dto: TwoFactorLoginDto,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.twoFactor.login(dto.challengeToken, dto.code, meta);
  }

  @HttpCode(200)
  @Post('2fa/setup')
  setupTwoFactor(@CurrentUser() user: AuthUser) {
    return this.twoFactor.setup(user);
  }

  @Throttle(strict)
  @HttpCode(200)
  @Post('2fa/enable')
  enableTwoFactor(
    @CurrentUser() user: AuthUser,
    @Body({ schema: enableTwoFactorSchema }) dto: EnableTwoFactorDto,
  ) {
    return this.twoFactor.enable(user, dto.code.replace(/\s/g, ''));
  }

  @Throttle(strict)
  @HttpCode(204)
  @Post('2fa/disable')
  disableTwoFactor(
    @CurrentUser() user: AuthUser,
    @Body({ schema: disableTwoFactorSchema }) dto: DisableTwoFactorDto,
  ) {
    return this.twoFactor.disable(user, dto.password, dto.code);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }
}
