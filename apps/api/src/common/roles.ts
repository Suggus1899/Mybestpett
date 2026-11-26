import type { AuthUser } from '../auth/auth.types.js';
import type { Role } from '../generated/prisma/client.js';

export function hasAnyRole(user: AuthUser | undefined, roles: Role[]): boolean {
  if (!user) return false;
  return (
    user.roles.includes('ADMIN') || user.roles.some((r) => roles.includes(r))
  );
}
