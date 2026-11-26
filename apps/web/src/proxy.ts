import { NextResponse, type NextRequest } from 'next/server';
import {
  ACCESS_COOKIE,
  API_URL,
  REFRESH_COOKIE,
  REFRESH_MAX_AGE,
} from './lib/config';

const secure = process.env.NODE_ENV === 'production';

// Renueva la sesión de forma transparente: si el access token ya venció (su
// cookie expiró) pero queda refresh token, pide uno nuevo a la API antes de
// renderizar la página.
export async function proxy(request: NextRequest) {
  const hasAccess = request.cookies.has(ACCESS_COOKIE);
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;
  // Los prefetch del router no renuevan: así se evita que varias peticiones
  // en paralelo roten el mismo token.
  const isPrefetch =
    request.headers.has('next-router-prefetch') ||
    request.headers.get('purpose') === 'prefetch';
  if (hasAccess || !refreshToken || isPrefetch) return NextResponse.next();

  let tokens: { accessToken: string; accessTokenExpiresIn: number; refreshToken: string } | null =
    null;
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    });
    if (res.ok) tokens = await res.json();
  } catch {
    // API caída: se sigue sin sesión y no se borra nada.
    return NextResponse.next();
  }

  if (!tokens) {
    const response = NextResponse.next();
    response.cookies.delete(REFRESH_COOKIE);
    return response;
  }

  // La página que se está renderizando debe ver ya el token nuevo.
  request.cookies.set(ACCESS_COOKIE, tokens.accessToken);
  request.cookies.set(REFRESH_COOKIE, tokens.refreshToken);
  const response = NextResponse.next({ request });
  const base = { httpOnly: true, secure, sameSite: 'lax' as const, path: '/' };
  response.cookies.set(ACCESS_COOKIE, tokens.accessToken, {
    ...base,
    maxAge: tokens.accessTokenExpiresIn,
  });
  response.cookies.set(REFRESH_COOKIE, tokens.refreshToken, {
    ...base,
    maxAge: REFRESH_MAX_AGE,
  });
  return response;
}

export const config = {
  // Todo menos archivos estáticos e imágenes.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)'],
};
