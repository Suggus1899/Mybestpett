import 'server-only';
import { redirect } from 'next/navigation';
import { getCurrentUser, type Role, type SessionUser } from './session';

export const STAFF_ROLES: Role[] = [
  'ADMIN',
  'ORDERS_OPERATOR',
  'CATALOG_MANAGER',
  'ADOPTION_COORDINATOR',
];

export function hasAnyRole(user: SessionUser, roles: Role[]): boolean {
  return user.roles.includes('ADMIN') || user.roles.some((r) => roles.includes(r));
}

export function isStaff(user: SessionUser | null): boolean {
  return Boolean(user && hasAnyRole(user, STAFF_ROLES));
}

// Comprobación en cada página del panel. Es solo para la interfaz: la API
// vuelve a validar sesión y rol en cada petición, que es lo que protege los datos.
export async function requireRoles(roles: Role[], next: string) {
  const user = await getCurrentUser();
  if (!user) redirect(`/entrar?next=${encodeURIComponent(next)}`);
  return { user, allowed: hasAnyRole(user, roles) };
}
