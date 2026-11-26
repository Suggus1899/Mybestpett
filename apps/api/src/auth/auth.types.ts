import type { Role } from '../generated/prisma/client.js';

export interface AuthUser {
  id: string;
  email: string;
  roles: Role[];
  sessionId: string | null;
  mfa: boolean; // la sesión pasó la verificación en dos pasos
}

// Ids de la persona y de la sesión: roles, estado y 2FA se leen de la base en
// cada petición. `purpose` marca el token intermedio del segundo paso, que no
// sirve como token de acceso.
export interface AccessTokenPayload {
  sub: string;
  sid?: string;
  purpose?: '2fa';
}

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}
