import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// La web llama a la API desde su servidor, así que req.ip sería siempre el de
// Next y el límite por IP frenaría a todos los clientes a la vez. La web
// reenvía la IP real en una cabecera, firmada con un secreto compartido
// (WEB_PROXY_SECRET). Sin el secreto correcto la cabecera se ignora: un
// cliente cualquiera (por ejemplo la app móvil) no puede fingir otra IP.
export const WEB_KEY_HEADER = 'x-petbf-web-key';
export const CLIENT_IP_HEADER = 'x-petbf-client-ip';

interface RequestLike {
  ip?: string;
  headers: Record<string, string | string[] | undefined>;
}

// Compara en tiempo constante (sobre hashes, para que la longitud no importe).
function sameSecret(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export function clientIp(
  req: RequestLike,
  secret = process.env.WEB_PROXY_SECRET,
): string | null {
  const key = req.headers[WEB_KEY_HEADER];
  const forwarded = req.headers[CLIENT_IP_HEADER];
  if (
    secret &&
    typeof key === 'string' &&
    typeof forwarded === 'string' &&
    isIP(forwarded) !== 0 &&
    sameSecret(key, secret)
  ) {
    return forwarded;
  }
  return req.ip ?? null;
}

// El límite de peticiones cuenta por la IP real del cliente.
@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    return Promise.resolve(clientIp(req as RequestLike) ?? 'desconocida');
  }
}
