import { z } from 'zod';
import { Role } from '../generated/prisma/enums.js';

export const userIdSchema = z.uuid('Id de usuario inválido');

// Lista completa de roles que tendrá la persona (reemplaza la anterior).
export const setRolesSchema = z.object({
  roles: z.array(z.enum(Role)).max(Object.keys(Role).length),
});

export const changeStatusSchema = z.object({
  isActive: z.boolean(),
});

export const listUsersSchema = z.object({
  role: z.enum(Role).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type SetRolesDto = z.infer<typeof setRolesSchema>;
export type ChangeStatusDto = z.infer<typeof changeStatusSchema>;
export type ListUsersQuery = z.infer<typeof listUsersSchema>;
