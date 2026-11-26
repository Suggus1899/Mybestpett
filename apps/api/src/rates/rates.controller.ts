import { Body, Controller, Get, Post } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser, Public, Roles } from '../auth/decorators.js';
import { createRatesSchema, type CreateRatesDto } from './rates.schemas.js';
import { RatesService } from './rates.service.js';

@Controller('exchange-rates')
export class RatesController {
  constructor(private readonly rates: RatesService) {}

  @Public()
  @Get('current')
  current() {
    return this.rates.current();
  }

  @Roles(['ORDERS_OPERATOR'])
  @Get()
  history() {
    return this.rates.history();
  }

  // El MVP define que la tasa del BCV la carga el administrador cada día.
  @Roles(['ADMIN'])
  @Post()
  create(
    @CurrentUser() actor: AuthUser,
    @Body({ schema: createRatesSchema }) dto: CreateRatesDto,
  ) {
    return this.rates.create(actor, dto);
  }
}
