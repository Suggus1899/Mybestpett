import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser } from '../auth/decorators.js';
import {
  addItemSchema,
  setQuantitySchema,
  type AddItemDto,
  type SetQuantityDto,
} from './cart.schemas.js';
import { CartService } from './cart.service.js';

const id = z.uuid('Id inválido');

// Carrito de la persona con sesión (comprar exige cuenta).
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.cart.get(user.id);
  }

  @Post('items')
  add(
    @CurrentUser() user: AuthUser,
    @Body({ schema: addItemSchema }) dto: AddItemDto,
  ) {
    return this.cart.add(user.id, dto);
  }

  @Put('items/:variantId')
  set(
    @CurrentUser() user: AuthUser,
    @Param('variantId', { schema: id }) variantId: string,
    @Body({ schema: setQuantitySchema }) dto: SetQuantityDto,
  ) {
    return this.cart.set(user.id, variantId, dto.quantity);
  }

  @Delete('items/:variantId')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('variantId', { schema: id }) variantId: string,
  ) {
    return this.cart.remove(user.id, variantId);
  }

  @Delete()
  clear(@CurrentUser() user: AuthUser) {
    return this.cart.clear(user.id);
  }
}
