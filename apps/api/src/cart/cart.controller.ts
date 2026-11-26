import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
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
import { slugSchema } from '../common/slug.js';
import {
  addComboSchema,
  quoteSchema,
  type AddComboDto,
  type QuoteQuery,
} from '../promotions/promotions.schemas.js';
import { CartService } from './cart.service.js';

const id = z.uuid('Id inválido');

// Carrito de la persona con sesión (comprar exige cuenta).
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  // ?coupon=CODIGO prueba un cupón: 400 con el motivo si no aplica.
  @Get()
  get(
    @CurrentUser() user: AuthUser,
    @Query({ schema: quoteSchema }) query: QuoteQuery,
  ) {
    return this.cart.get(user.id, query.coupon);
  }

  @Post('combos/:slug')
  addCombo(
    @CurrentUser() user: AuthUser,
    @Param('slug', { schema: slugSchema }) slug: string,
    @Body({ schema: addComboSchema }) dto: AddComboDto,
  ) {
    return this.cart.addCombo(user.id, slug, dto.quantity);
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
