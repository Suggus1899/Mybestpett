import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// El refresh token es opaco: "<idDeSesión>.<secreto aleatorio>".
// En la base solo se guarda el SHA-256 del secreto. Como el secreto tiene
// 256 bits de azar, un hash rápido basta (no hace falta argon2 aquí).

export function generateSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function secretMatches(secret: string, storedHash: string): boolean {
  const a = Buffer.from(hashSecret(secret), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function buildToken(sessionId: string, secret: string): string {
  return `${sessionId}.${secret}`;
}

export function parseToken(
  token: string,
): { sessionId: string; secret: string } | null {
  const [sessionId, secret, ...rest] = token.split('.');
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!sessionId || !secret || rest.length > 0 || !uuid.test(sessionId)) {
    return null;
  }
  return { sessionId, secret };
}
