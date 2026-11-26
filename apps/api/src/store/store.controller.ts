import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser, Public, Roles } from '../auth/decorators.js';
import {
  createZoneSchema,
  updatePaymentMethodSchema,
  updateZoneSchema,
  type CreateZoneDto,
  type UpdatePaymentMethodDto,
  type UpdateZoneDto,
} from './store.schemas.js';
import { StoreService } from './store.service.js';

const id = z.uuid('Id inválido');

@Public()
@Controller()
export class StorePublicController {
  constructor(private readonly store: StoreService) {}

  @Get('shipping-zones')
  zones() {
    return this.store.zones();
  }

  @Get('payment-methods')
  paymentMethods() {
    return this.store.paymentMethods();
  }
}

// Según el MVP, envíos y métodos de pago los gestiona el administrador.
@Roles(['ADMIN'])
@Controller('manage')
export class StoreManageController {
  constructor(private readonly store: StoreService) {}

  @Get('shipping-zones')
  zones() {
    return this.store.zones(true);
  }

  @Post('shipping-zones')
  createZone(
    @CurrentUser() actor: AuthUser,
    @Body({ schema: createZoneSchema }) dto: CreateZoneDto,
  ) {
    return this.store.createZone(actor, dto);
  }

  @Patch('shipping-zones/:id')
  updateZone(
    @CurrentUser() actor: AuthUser,
    @Param('id', { schema: id }) zoneId: string,
    @Body({ schema: updateZoneSchema }) dto: UpdateZoneDto,
  ) {
    return this.store.updateZone(actor, zoneId, dto);
  }

  @Get('payment-methods')
  paymentMethods() {
    return this.store.paymentMethods(true);
  }

  @Patch('payment-methods/:id')
  updatePaymentMethod(
    @CurrentUser() actor: AuthUser,
    @Param('id', { schema: id }) methodId: string,
    @Body({ schema: updatePaymentMethodSchema }) dto: UpdatePaymentMethodDto,
  ) {
    return this.store.updatePaymentMethod(actor, methodId, dto);
  }
}
