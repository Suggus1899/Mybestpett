import 'server-only';
import { cookies, headers } from 'next/headers';
import { ACCESS_COOKIE, API_URL } from './config';
import { forwardHeaders } from './forward';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Sirve un comprobante de pago desde la API con la sesión de la persona. La API
// decide quién lo puede ver; aquí solo se copian el archivo y sus cabeceras
// seguras, y nunca se guarda en caché.
export async function proxyProof(req: Request, apiPath: string, ids: string[], back: string) {
  if (!ids.every((id) => UUID.test(id))) return new Response('No encontrado', { status: 404 });
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) {
    return Response.redirect(new URL(`/entrar?next=${encodeURIComponent(back)}`, req.url), 303);
  }
  let res: Response;
  try {
    res = await fetch(`${API_URL}${apiPath}`, {
      headers: { ...forwardHeaders(await headers()), Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
  } catch {
    return new Response('No pudimos conectar con el servidor', { status: 502 });
  }
  if (!res.ok) {
    const text = res.status === 404 ? 'Comprobante no encontrado' : 'No tienes acceso a este comprobante';
    return new Response(text, { status: res.status === 404 ? 404 : 403 });
  }
  const copy = new Headers({
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
  });
  for (const name of ['content-type', 'content-length', 'content-disposition']) {
    const value = res.headers.get(name);
    if (value) copy.set(name, value);
  }
  return new Response(res.body, { status: 200, headers: copy });
}
