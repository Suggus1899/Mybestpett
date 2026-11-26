// La API cuenta el límite de peticiones y registra sesiones por IP. Como la web
// le habla desde su propio servidor, reenvía la IP real del visitante en una
// cabecera firmada con WEB_PROXY_SECRET (el mismo valor que en la API).
//
// La IP sale de x-real-ip o del primer valor de x-forwarded-for, que en Vercel
// (o detrás de un proxy bien configurado) los fija la plataforma y no el
// navegador. Sin secreto configurado no se envía nada.
export function forwardHeaders(headers: Headers): Record<string, string> {
  const secret = process.env.WEB_PROXY_SECRET;
  if (!secret) return {};
  const ip = headers.get('x-real-ip') ?? headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (!ip) return {};
  return { 'x-petbf-web-key': secret, 'x-petbf-client-ip': ip };
}
