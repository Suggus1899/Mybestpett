import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser, Public, Roles } from '../auth/decorators.js';
import { slugSchema } from '../common/slug.js';
import {
  listReviewsManageSchema,
  listReviewsSchema,
  moderateReviewSchema,
  upsertReviewSchema,
  type ListReviewsManageQuery,
  type ListReviewsQuery,
  type ModerateReviewDto,
  type UpsertReviewDto,
} from './reviews.schemas.js';
import { ReviewsService } from './reviews.service.js';

@Controller('products/:slug/reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Public()
  @Get()
  list(
    @Param('slug', { schema: slugSchema }) slug: string,
    @Query({ schema: listReviewsSchema }) query: ListReviewsQuery,
  ) {
    return this.reviews.list(slug, query);
  }

  @Get('mine')
  mine(
    @CurrentUser() user: AuthUser,
    @Param('slug', { schema: slugSchema }) slug: string,
  ) {
    return this.reviews.mine(user, slug);
  }

  @Put('mine')
  upsert(
    @CurrentUser() user: AuthUser,
    @Param('slug', { schema: slugSchema }) slug: string,
    @Body({ schema: upsertReviewSchema }) dto: UpsertReviewDto,
  ) {
    return this.reviews.upsert(user, slug, dto);
  }

  @HttpCode(204)
  @Delete('mine')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('slug', { schema: slugSchema }) slug: string,
  ) {
    return this.reviews.remove(user, slug);
  }
}

// Moderación: el gestor de catálogo (y ADMIN) oculta o vuelve a mostrar reseñas.
@Roles(['CATALOG_MANAGER'])
@Controller('manage/reviews')
export class ReviewsManageController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  list(
    @Query({ schema: listReviewsManageSchema }) query: ListReviewsManageQuery,
  ) {
    return this.reviews.listManage(query);
  }

  @Patch(':id')
  moderate(
    @CurrentUser() actor: AuthUser,
    @Param('id', { schema: z.uuid('Id inválido') }) id: string,
    @Body({ schema: moderateReviewSchema }) dto: ModerateReviewDto,
  ) {
    return this.reviews.moderate(actor, id, dto);
  }
}
