import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Put,
  Query,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { CurrentUser, Roles } from '../auth/decorators.js';
import {
  changeStatusSchema,
  listUsersSchema,
  setRolesSchema,
  userIdSchema,
  type ChangeStatusDto,
  type ListUsersQuery,
  type SetRolesDto,
} from './users.schemas.js';
import { UsersService } from './users.service.js';

// Gestión de cuentas: solo el rol ADMIN (Gus).
@Roles(['ADMIN'])
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Query({ schema: listUsersSchema }) query: ListUsersQuery) {
    return this.users.list(query);
  }

  @Put(':id/roles')
  setRoles(
    @CurrentUser() actor: AuthUser,
    @Param('id', { schema: userIdSchema }) id: string,
    @Body({ schema: setRolesSchema }) dto: SetRolesDto,
  ) {
    return this.users.setRoles(actor, id, dto);
  }

  @Patch(':id/status')
  changeStatus(
    @CurrentUser() actor: AuthUser,
    @Param('id', { schema: userIdSchema }) id: string,
    @Body({ schema: changeStatusSchema }) dto: ChangeStatusDto,
  ) {
    return this.users.changeStatus(actor, id, dto);
  }
}
