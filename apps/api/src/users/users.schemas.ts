import { z } from 'zod';
import { Role } from '../generated/prisma/enums.js';

export const userIdSchema = z.uuid('Id de usuario inválido');

export const changeRoleSchema = z.object({
  role: z.enum(Role),
});

export const changeStatusSchema = z.object({
  isActive: z.boolean(),
});

export const listUsersSchema = z.object({
  role: z.enum(Role).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ChangeRoleDto = z.infer<typeof changeRoleSchema>;
export type ChangeStatusDto = z.infer<typeof changeStatusSchema>;
export type ListUsersQuery = z.infer<typeof listUsersSchema>;
