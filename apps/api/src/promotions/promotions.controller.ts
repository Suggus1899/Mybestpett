import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser, Public, Roles } from '../auth/decorators.js';
import { slugSchema } from '../common/slug.js';
import {
  createComboSchema,
  createCouponSchema,
  listCombosManageSchema,
  listCouponsSchema,
  updateComboSchema,
  updateCouponSchema,
  type CreateComboDto,
  type CreateCouponDto,
  type ListCombosManageQuery,
  type ListCouponsQuery,
  type UpdateComboDto,
  type UpdateCouponDto,
} from './promotions.schemas.js';
import { PromotionsService } from './promotions.service.js';

const id = z.uuid('Id inválido');

@Public()
@Controller('combos')
export class CombosController {
  constructor(private readonly promotions: PromotionsService) {}

  @Get()
  list() {
    return this.promotions.listCombos();
  }

  @Get(':slug')
  get(@Param('slug', { schema: slugSchema }) slug: string) {
    return this.promotions.getCombo(slug);
  }
}

// Combos y cupones los gestiona el equipo de catálogo (y ADMIN).
@Roles(['CATALOG_MANAGER'])
@Controller('manage/combos')
export class CombosManageController {
  constructor(private readonly promotions: PromotionsService) {}

  @Get()
  list(
    @Query({ schema: listCombosManageSchema }) query: ListCombosManageQuery,
  ) {
    return this.promotions.listCombosManage(query);
  }

  @Post()
  create(
    @CurrentUser() actor: AuthUser,
    @Body({ schema: createComboSchema }) dto: CreateComboDto,
  ) {
    return this.promotions.createCombo(actor, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', { schema: id }) comboId: string,
    @Body({ schema: updateComboSchema }) dto: UpdateComboDto,
  ) {
    return this.promotions.updateCombo(actor, comboId, dto);
  }
}

@Roles(['CATALOG_MANAGER'])
@Controller('manage/coupons')
export class CouponsManageController {
  constructor(private readonly promotions: PromotionsService) {}

  @Get()
  list(@Query({ schema: listCouponsSchema }) query: ListCouponsQuery) {
    return this.promotions.listCoupons(query);
  }

  @Post()
  create(
    @CurrentUser() actor: AuthUser,
    @Body({ schema: createCouponSchema }) dto: CreateCouponDto,
  ) {
    return this.promotions.createCoupon(actor, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', { schema: id }) couponId: string,
    @Body({ schema: updateCouponSchema }) dto: UpdateCouponDto,
  ) {
    return this.promotions.updateCoupon(actor, couponId, dto);
  }
}
