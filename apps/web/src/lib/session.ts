import 'server-only';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import {
  ACCESS_COOKIE,
  API_URL,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE,
} from './config';
import { forwardHeaders } from './forward';

// Los tokens viven en cookies httpOnly: el JavaScript del navegador no puede
// leerlos, lo que protege la sesión si alguna vez hay un fallo de XSS.

export type Role =
  | 'CUSTOMER'
  | 'ADMIN'
  | 'ORDERS_OPERATOR'
  | 'CATALOG_MANAGER'
  | 'ADOPTION_COORDINATOR';

export interface SessionUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  roles: Role[];
}

export interface AuthTokens {
  accessToken: string;
  accessTokenExpiresIn: number;
  refreshToken: string;
}

const secure = process.env.NODE_ENV === 'production';

export function accessCookieOptions(maxAge: number) {
  return { httpOnly: true, secure, sameSite: 'lax' as const, path: '/', maxAge };
}

export function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: REFRESH_MAX_AGE,
  };
}

export async function saveSession(tokens: AuthTokens) {
  const store = await cookies();
  store.set(
    ACCESS_COOKIE,
    tokens.accessToken,
    accessCookieOptions(tokens.accessTokenExpiresIn),
  );
  store.set(REFRESH_COOKIE, tokens.refreshToken, refreshCookieOptions());
}

export async function clearSession() {
  const store = await cookies();
  store.delete(ACCESS_COOKIE);
  store.delete(REFRESH_COOKIE);
}

// Una sola llamada a /auth/me por petición aunque varios componentes la pidan.
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return null;
  const res = await fetch(`${API_URL}/auth/me`, {
    headers: { ...forwardHeaders(await headers()), Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) return null;
  return res.json();
});
