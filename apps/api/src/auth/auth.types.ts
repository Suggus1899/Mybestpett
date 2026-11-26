import type { Role } from '../generated/prisma/client.js';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

export interface AccessTokenPayload {
  sub: string;
  role: Role;
}

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}
