import {
  base32Decode,
  base32Encode,
  decryptSecret,
  deriveKey,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  otpauthUrl,
  stepAt,
  totpCode,
  verifyTotp,
} from './totp.js';

// Vectores del RFC 6238 (SHA-1, secreto "12345678901234567890"), en 6 dígitos.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it('coincide con los vectores del RFC 6238', () => {
    expect(totpCode(RFC_SECRET, stepAt(59_000))).toBe('287082');
    expect(totpCode(RFC_SECRET, stepAt(1_111_111_109_000))).toBe('081804');
    expect(totpCode(RFC_SECRET, stepAt(1_234_567_890_000))).toBe('005924');
    expect(totpCode(RFC_SECRET, stepAt(20_000_000_000_000))).toBe('353130');
  });

  it('base32 ida y vuelta, sin importar espacios ni minúsculas', () => {
    const data = Buffer.from([0, 1, 2, 250, 255, 7, 9]);
    expect(base32Decode(base32Encode(data))).toEqual(data);
    expect(base32Decode('gezd gnbv')).toEqual(base32Decode('GEZDGNBV'));
    expect(() => base32Decode('ABC1')).toThrow();
  });

  it('acepta el paso actual y uno de margen, no más', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const now = 1_800_000_000_000;
    const step = stepAt(now);
    expect(verifyTotp(secret, totpCode(secret, step), now)).toBe(step);
    expect(verifyTotp(secret, totpCode(secret, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(secret, totpCode(secret, step + 1), now)).toBe(step + 1);
    expect(verifyTotp(secret, totpCode(secret, step - 2), now)).toBeNull();
    expect(verifyTotp(secret, totpCode(secret, step + 2), now)).toBeNull();
  });

  it('no deja reutilizar un código ya usado ni uno anterior', () => {
    const secret = generateTotpSecret();
    const now = 1_800_000_000_000;
    const step = stepAt(now);
    expect(verifyTotp(secret, totpCode(secret, step), now, step)).toBeNull();
    expect(
      verifyTotp(secret, totpCode(secret, step - 1), now, step),
    ).toBeNull();
    expect(verifyTotp(secret, totpCode(secret, step + 1), now, step)).toBe(
      step + 1,
    );
  });

  it('rechaza formatos inválidos', () => {
    const secret = generateTotpSecret();
    for (const code of ['', '12345', '1234567', 'abcdef', '12 345', '١٢٣٤٥٦']) {
      expect(verifyTotp(secret, code)).toBeNull();
    }
  });

  it('arma el enlace otpauth para la app', () => {
    const url = otpauthUrl('ABCDEF', 'ana@petbf.com');
    expect(url).toBe(
      'otpauth://totp/Petbf%3Aana%40petbf.com?secret=ABCDEF&issuer=Petbf&algorithm=SHA1&digits=6&period=30',
    );
  });
});

describe('códigos de recuperación', () => {
  it('genera 10 distintos con formato XXXX-XXXX', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[A-Z2-7]{4}-[A-Z2-7]{4}$/);
  });

  it('el hash ignora guiones, espacios y minúsculas', () => {
    expect(hashRecoveryCode('k7qf m2xd')).toBe(hashRecoveryCode('K7QF-M2XD'));
    expect(hashRecoveryCode('K7QF-M2XE')).not.toBe(
      hashRecoveryCode('K7QF-M2XD'),
    );
  });
});

describe('cifrado del secreto', () => {
  const key = deriveKey('x'.repeat(32));

  it('descifra lo que cifra y cada cifrado es distinto', () => {
    const a = encryptSecret('SECRETO', key);
    const b = encryptSecret('SECRETO', key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe('SECRETO');
  });

  it('falla con otra clave o si se altera', () => {
    const payload = encryptSecret('SECRETO', key);
    expect(() =>
      decryptSecret(payload, deriveKey('otra-clave'.repeat(4))),
    ).toThrow();
    const [iv, tag, data] = payload.split('.');
    const tampered = [
      iv,
      tag,
      Buffer.from('XXXXXXX').toString('base64url'),
    ].join('.');
    expect(() => decryptSecret(tampered, key)).toThrow();
    expect(data).toBeTruthy();
  });
});
