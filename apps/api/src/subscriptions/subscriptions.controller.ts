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
import { CurrentUser } from '../auth/decorators.js';
import {
  createSubscriptionSchema,
  listSubscriptionsSchema,
  updateSubscriptionSchema,
  type CreateSubscriptionDto,
  type ListSubscriptionsQuery,
  type UpdateSubscriptionDto,
} from './subscriptions.schemas.js';
import { SubscriptionsService } from './subscriptions.service.js';

const id = z.uuid('Id inválido');

@Controller('subscriptions')
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query({ schema: listSubscriptionsSchema }) query: ListSubscriptionsQuery,
  ) {
    return this.subscriptions.list(user.id, query);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body({ schema: createSubscriptionSchema }) dto: CreateSubscriptionDto,
  ) {
    return this.subscriptions.create(user, dto);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', { schema: id }) subId: string,
  ) {
    return this.subscriptions.get(user.id, subId);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', { schema: id }) subId: string,
    @Body({ schema: updateSubscriptionSchema }) dto: UpdateSubscriptionDto,
  ) {
    return this.subscriptions.update(user, subId, dto);
  }

  @Post(':id/pause')
  pause(
    @CurrentUser() user: AuthUser,
    @Param('id', { schema: id }) subId: string,
  ) {
    return this.subscriptions.pause(user, subId);
  }

  @Post(':id/resume')
  resume(
    @CurrentUser() user: AuthUser,
    @Param('id', { schema: id }) subId: string,
  ) {
    return this.subscriptions.resume(user, subId);
  }

  @Post(':id/cancel')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', { schema: id }) subId: string,
  ) {
    return this.subscriptions.cancel(user, subId);
  }
}
