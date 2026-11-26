import { validateEnv } from '../config/env.js';
import { money, templates, when } from './templates.js';

const order = {
  code: 'PB-000042',
  firstName: 'Ana',
  url: 'https://petbf.test/pedidos/abc',
  total: '$13,00',
  methodName: 'Zelle',
};

describe('plantillas de correo', () => {
  it('formatea montos como la tienda', () => {
    expect(money('3191.5', 'VES')).toBe('Bs. 3.191,50');
    expect(money('13', 'USD')).toBe('$13,00');
    expect(money('12.1', 'EUR')).toBe('12,10 €');
    expect(money('5', 'USDT')).toBe('5,00 USDT');
  });

  it('muestra la hora de Venezuela', () => {
    // 16:00 UTC son las 12:00 en Caracas (UTC-4).
    expect(when(new Date('2026-11-26T16:00:00Z'))).toMatch(
      /26 de noviembre de 2026.*12:00/,
    );
  });

  it('saluda, incluye el enlace al pedido y firma', () => {
    const email = templates.paymentVerified(order);
    expect(email.subject).toBe('Pedido PB-000042: pago confirmado');
    expect(email.text.startsWith('Hola, Ana:')).toBe(true);
    expect(email.text).toContain(
      'Ver el pedido: https://petbf.test/pedidos/abc',
    );
    expect(email.text.endsWith('Equipo Petbf')).toBe(true);
  });

  it('omite la guía o las indicaciones cuando no hay', () => {
    expect(templates.shipped(order, 'MRW', null).text).toContain(
      'salió con MRW.',
    );
    expect(templates.returnApproved(order, null).text).not.toContain(
      'Indicaciones',
    );
    expect(templates.cancelled(order, null).text).not.toContain('Motivo');
  });
});

describe('variables de correo', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    JWT_ACCESS_SECRET: 'x'.repeat(32),
  };

  it('por defecto escribe los correos en el registro', () => {
    expect(validateEnv(base)).toMatchObject({
      EMAIL_PROVIDER: 'log',
      WEB_URL: 'http://localhost:3000',
    });
  });

  it('Resend exige su clave', () => {
    expect(() => validateEnv({ ...base, EMAIL_PROVIDER: 'resend' })).toThrow(
      /RESEND_API_KEY/,
    );
    expect(() =>
      validateEnv({ ...base, EMAIL_PROVIDER: 'resend', RESEND_API_KEY: '' }),
    ).toThrow(/RESEND_API_KEY/);
    expect(
      validateEnv({
        ...base,
        EMAIL_PROVIDER: 'resend',
        RESEND_API_KEY: 're_1234567890',
      }).EMAIL_PROVIDER,
    ).toBe('resend');
    expect(() => validateEnv({ ...base, EMAIL_PROVIDER: 'smtp' })).toThrow(
      /EMAIL_PROVIDER/,
    );
  });
});
