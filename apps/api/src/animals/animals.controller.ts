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
  createAnimalSchema,
  listAnimalsSchema,
  updateAnimalSchema,
  type CreateAnimalDto,
  type ListAnimalsQuery,
  type UpdateAnimalDto,
} from './animals.schemas.js';
import { AnimalsService } from './animals.service.js';
import { LIVE_SPECIES } from './live-species.js';

@Controller()
export class AnimalsController {
  constructor(private readonly animals: AnimalsService) {}

  @Public()
  @Get('animals')
  list(@Query({ schema: listAnimalsSchema }) query: ListAnimalsQuery) {
    return this.animals.list(query);
  }

  // Qué especies y tipos se aceptan, para los formularios del panel y la app.
  @Public()
  @Get('animal-species')
  species() {
    return LIVE_SPECIES;
  }

  @Public()
  @Get('animals/:slug')
  get(@Param('slug', { schema: slugSchema }) slug: string) {
    return this.animals.get(slug);
  }

  // El servicio comprueba además el rol según sea venta o adopción.
  @Roles(['CATALOG_MANAGER', 'ADOPTION_COORDINATOR'])
  @Post('manage/animals')
  create(
    @CurrentUser() actor: AuthUser,
    @Body({ schema: createAnimalSchema }) dto: CreateAnimalDto,
  ) {
    return this.animals.create(actor, dto);
  }

  @Roles(['CATALOG_MANAGER', 'ADOPTION_COORDINATOR'])
  @Patch('manage/animals/:id')
  update(
    @CurrentUser() actor: AuthUser,
    @Param('id', { schema: z.uuid('Id inválido') }) id: string,
    @Body({ schema: updateAnimalSchema }) dto: UpdateAnimalDto,
  ) {
    return this.animals.update(actor, id, dto);
  }
}
