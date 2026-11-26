import type { Role } from '../generated/prisma/client.js';

export interface AuthUser {
  id: string;
  email: string;
  roles: Role[];
}

// Solo el id: los roles se leen de la base en cada petición.
export interface AccessTokenPayload {
  sub: string;
}

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}
