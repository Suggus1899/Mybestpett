import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser, Roles } from '../auth/decorators.js';
import {
  adjustPointsSchema,
  listPointsSchema,
  type AdjustPointsDto,
  type ListPointsQuery,
} from './loyalty.schemas.js';
import { LoyaltyService } from './loyalty.service.js';

const id = z.uuid('Id inválido');

@Controller('points')
export class PointsController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get()
  mine(
    @CurrentUser() user: AuthUser,
    @Query({ schema: listPointsSchema }) query: ListPointsQuery,
  ) {
    return this.loyalty.summary(user.id, query);
  }
}

// Ajustes manuales: solo el administrador.
@Roles(['ADMIN'])
@Controller('manage/users/:id/points')
export class PointsManageController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get()
  list(
    @Param('id', { schema: id }) userId: string,
    @Query({ schema: listPointsSchema }) query: ListPointsQuery,
  ) {
    return this.loyalty.listForUser(userId, query);
  }

  @Post()
  adjust(
    @CurrentUser() actor: AuthUser,
    @Param('id', { schema: id }) userId: string,
    @Body({ schema: adjustPointsSchema }) dto: AdjustPointsDto,
  ) {
    return this.loyalty.adjust(actor, userId, dto);
  }
}
