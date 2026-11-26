import {
  buildToken,
  generateSecret,
  hashSecret,
  parseToken,
  secretMatches,
} from './refresh-token.js';

describe('refresh token', () => {
  const sessionId = '4ccfe6d2-8c26-48a8-8154-ec2c42f3ba9d';

  it('construye y vuelve a leer el token', () => {
    const secret = generateSecret();
    expect(parseToken(buildToken(sessionId, secret))).toEqual({
      sessionId,
      secret,
    });
  });

  it('rechaza formatos inválidos', () => {
    expect(parseToken('')).toBeNull();
    expect(parseToken('no-es-uuid.secreto')).toBeNull();
    expect(parseToken(`${sessionId}`)).toBeNull();
    expect(parseToken(`${sessionId}.a.b`)).toBeNull();
  });

  it('compara el secreto con su hash', () => {
    const secret = generateSecret();
    const hash = hashSecret(secret);
    expect(secretMatches(secret, hash)).toBe(true);
    expect(secretMatches(generateSecret(), hash)).toBe(false);
  });
});
