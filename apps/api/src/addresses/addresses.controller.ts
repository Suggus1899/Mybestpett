import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators.js';
import {
  createAddressSchema,
  updateAddressSchema,
  type CreateAddressDto,
  type UpdateAddressDto,
} from './addresses.schemas.js';
import { AddressesService } from './addresses.service.js';

const id = z.uuid('Id inválido');

// Direcciones de envío de la persona con sesión.
@Controller('addresses')
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.addresses.list(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body({ schema: createAddressSchema }) dto: CreateAddressDto,
  ) {
    return this.addresses.create(user.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', { schema: id }) addressId: string,
    @Body({ schema: updateAddressSchema }) dto: UpdateAddressDto,
  ) {
    return this.addresses.update(user.id, addressId, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', { schema: id }) addressId: string,
  ) {
    return this.addresses.remove(user.id, addressId);
  }
}
