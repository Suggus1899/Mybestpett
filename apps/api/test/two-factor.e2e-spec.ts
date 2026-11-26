import type { NestExpressApplication } from '@nestjs/platform-express';
import * as argon2 from 'argon2';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { stepAt, totpCode } from '../src/auth/totp.js';

// Verificación en dos pasos del equipo, obligatoria para usar el panel.
// Este archivo arranca la API con STAFF_2FA_REQUIRED=true; los demás la apagan.
describe('Verificación en dos pasos (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let resetDb: (prisma: PrismaService) => Promise<void>;
  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const PASSWORD = 'clave-de-prueba-1';
  const previous = process.env.STAFF_2FA_REQUIRED;

  beforeAll(async () => {
    process.env.STAFF_2FA_REQUIRED = 'true';
    // La configuración se lee al importar el módulo: después de fijar la variable.
    const helpers = await import('./helpers.js');
    resetDb = helpers.resetDb;
    ({ app, prisma } = await helpers.createTestApp());
  });
  afterAll(async () => {
    await resetDb(prisma);
    await app.close();
    process.env.STAFF_2FA_REQUIRED = previous;
  });
  beforeEach(async () => {
    await resetDb(prisma);
  });

  async function person(roles: ('ADMIN' | 'ORDERS_OPERATOR')[] = []) {
    const email = `p-${Math.random().toString(36).slice(2)}@test.com`;
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await argon2.hash(PASSWORD),
        firstName: 'Prueba',
        lastName: 'Dos pasos',
        roles: {
          create: ['CUSTOMER' as const, ...roles].map((role) => ({ role })),
        },
      },
    });
    return { id: user.id, email };
  }

  const login = (email: string, password = PASSWORD) =>
    api().post('/v1/auth/login').send({ email, password }).expect(200);

  // Configura y activa 2FA. Devuelve el secreto, los códigos y el token de esa sesión.
  async function enroll(email: string) {
    const { body } = await login(email);
    const token = body.accessToken as string;
    const setup = await api()
      .post('/v1/auth/2fa/setup')
      .set(auth(token))
      .expect(200);
    const secret = setup.body.secret as string;
    const enabled = await api()
      .post('/v1/auth/2fa/enable')
      .set(auth(token))
      .send({ code: totpCode(secret, stepAt(Date.now())) })
      .expect(200);
    return {
      secret,
      token,
      recoveryCodes: enabled.body.recoveryCodes as string[],
      refreshToken: body.refreshToken,
    };
  }

  // Código válido de un paso que aún no se usó.
  const nextCode = (secret: string, offset = 1) =>
    totpCode(secret, stepAt(Date.now()) + offset);

  describe('panel', () => {
    it('sin 2FA, el equipo no entra al panel pero sí a su cuenta', async () => {
      const staff = await person(['ORDERS_OPERATOR']);
      const { body } = await login(staff.email);
      const res = await api()
        .get('/v1/manage/orders')
        .set(auth(body.accessToken))
        .expect(403);
      expect(res.body).toMatchObject({ code: 'TWO_FACTOR_REQUIRED' });
      const me = await api()
        .get('/v1/auth/me')
        .set(auth(body.accessToken))
        .expect(200);
      expect(me.body.twoFactor).toEqual({
        enabled: false,
        available: true,
        required: true,
        verified: false,
      });
      await api().get('/v1/orders').set(auth(body.accessToken)).expect(200);
    });

    it('con 2FA activada, la sesión queda verificada y entra al panel', async () => {
      const staff = await person(['ORDERS_OPERATOR']);
      const { token } = await enroll(staff.email);
      await api().get('/v1/manage/orders').set(auth(token)).expect(200);
      const me = await api().get('/v1/auth/me').set(auth(token)).expect(200);
      expect(me.body.twoFactor).toMatchObject({
        enabled: true,
        verified: true,
      });
    });

    it('a un cliente no se le pide ni se le ofrece', async () => {
      const customer = await person();
      const { body } = await login(customer.email);
      expect(body.accessToken).toBeDefined();
      const me = await api()
        .get('/v1/auth/me')
        .set(auth(body.accessToken))
        .expect(200);
      expect(me.body.twoFactor).toEqual({
        enabled: false,
        available: false,
        required: false,
        verified: false,
      });
      await api()
        .post('/v1/auth/2fa/setup')
        .set(auth(body.accessToken))
        .expect(403);
    });
  });

  describe('activación', () => {
    it('guarda el secreto cifrado y los códigos de recuperación como hash', async () => {
      const staff = await person(['ADMIN']);
      const { secret, recoveryCodes } = await enroll(staff.email);
      expect(recoveryCodes).toHaveLength(10);
      const stored = await prisma.user.findUniqueOrThrow({
        where: { id: staff.id },
      });
      expect(stored.totpSecret).not.toContain(secret);
      expect(stored.totpPendingSecret).toBeNull();
      expect(stored.recoveryCodes).toHaveLength(10);
      expect(stored.recoveryCodes.join()).not.toContain(
        recoveryCodes[0].replace('-', ''),
      );
      expect(
        await prisma.auditLog.count({
          where: { action: 'auth.2fa_enabled', actorId: staff.id },
        }),
      ).toBe(1);
    });

    it('el enlace otpauth incluye el correo y el secreto', async () => {
      const staff = await person(['ADMIN']);
      const { body } = await login(staff.email);
      const setup = await api()
        .post('/v1/auth/2fa/setup')
        .set(auth(body.accessToken))
        .expect(200);
      expect(setup.body.secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(setup.body.otpauthUrl).toContain(`secret=${setup.body.secret}`);
      expect(setup.body.otpauthUrl).toContain(encodeURIComponent(staff.email));
    });

    it('rechaza códigos incorrectos, sin clave previa o si ya está activa', async () => {
      const staff = await person(['ADMIN']);
      const { body } = await login(staff.email);
      const token = body.accessToken;
      await api()
        .post('/v1/auth/2fa/enable')
        .set(auth(token))
        .send({ code: '123456' })
        .expect(409);
      const setup = await api()
        .post('/v1/auth/2fa/setup')
        .set(auth(token))
        .expect(200);
      const wrong = totpCode(setup.body.secret, stepAt(Date.now()) + 5);
      await api()
        .post('/v1/auth/2fa/enable')
        .set(auth(token))
        .send({ code: wrong })
        .expect(400);
      for (const code of ['12345', 'abcdef', '', 'K7QF-M2XD']) {
        await api()
          .post('/v1/auth/2fa/enable')
          .set(auth(token))
          .send({ code })
          .expect(400);
      }
      await api()
        .post('/v1/auth/2fa/enable')
        .set(auth(token))
        .send({ code: totpCode(setup.body.secret, stepAt(Date.now())) })
        .expect(200);
      await api().post('/v1/auth/2fa/setup').set(auth(token)).expect(409);
    });
  });

  describe('inicio de sesión', () => {
    it('pide el código tras la contraseña y abre una sesión verificada', async () => {
      const staff = await person(['ORDERS_OPERATOR']);
      const { secret } = await enroll(staff.email);
      const first = await login(staff.email);
      expect(first.body).toEqual({
        twoFactorRequired: true,
        challengeToken: expect.any(String),
      });
      // El token intermedio no sirve como acceso.
      await api()
        .get('/v1/auth/me')
        .set(auth(first.body.challengeToken))
        .expect(401);

      const { body } = await api()
        .post('/v1/auth/2fa/login')
        .send({
          challengeToken: first.body.challengeToken,
          code: nextCode(secret),
        })
        .expect(200);
      expect(body.user.email).toBe(staff.email);
      await api()
        .get('/v1/manage/orders')
        .set(auth(body.accessToken))
        .expect(200);

      // Al renovar, la sesión sigue verificada.
      const refreshed = await api()
        .post('/v1/auth/refresh')
        .send({ refreshToken: body.refreshToken })
        .expect(200);
      await api()
        .get('/v1/manage/orders')
        .set(auth(refreshed.body.accessToken))
        .expect(200);
    });

    it('un código no sirve dos veces', async () => {
      const staff = await person(['ADMIN']);
      const { secret } = await enroll(staff.email);
      const code = nextCode(secret);
      const a = await login(staff.email);
      await api()
        .post('/v1/auth/2fa/login')
        .send({ challengeToken: a.body.challengeToken, code })
        .expect(200);
      const b = await login(staff.email);
      await api()
        .post('/v1/auth/2fa/login')
        .send({ challengeToken: b.body.challengeToken, code })
        .expect(401);
    });

    it('acepta un código de recuperación una sola vez', async () => {
      const staff = await person(['ADMIN']);
      const { recoveryCodes } = await enroll(staff.email);
      const typed = recoveryCodes[3].toLowerCase(); // sin importar mayúsculas
      const a = await login(staff.email);
      await api()
        .post('/v1/auth/2fa/login')
        .send({ challengeToken: a.body.challengeToken, code: typed })
        .expect(200);
      const b = await login(staff.email);
      await api()
        .post('/v1/auth/2fa/login')
        .send({ challengeToken: b.body.challengeToken, code: typed })
        .expect(401);
      const stored = await prisma.user.findUniqueOrThrow({
        where: { id: staff.id },
      });
      expect(stored.recoveryCodes).toHaveLength(9);
    });

    it('bloquea 15 minutos tras 5 códigos incorrectos', async () => {
      const staff = await person(['ADMIN']);
      const { secret } = await enroll(staff.email);
      const { body } = await login(staff.email);
      for (let i = 0; i < 5; i++) {
        await api()
          .post('/v1/auth/2fa/login')
          .send({ challengeToken: body.challengeToken, code: '000000' })
          .expect(401);
      }
      const locked = await api()
        .post('/v1/auth/2fa/login')
        .send({ challengeToken: body.challengeToken, code: nextCode(secret) })
        .expect(403);
      expect(locked.body.message).toMatch(/15 minutos/);
      expect(
        await prisma.auditLog.count({ where: { action: 'auth.2fa_failed' } }),
      ).toBe(5);
    });

    it('rechaza tokens intermedios vencidos, falsos o de acceso', async () => {
      const staff = await person(['ADMIN']);
      const { secret, token } = await enroll(staff.email);
      await api()
        .post('/v1/auth/2fa/login')
        .send({ challengeToken: 'x.y.z', code: nextCode(secret) })
        .expect(401);
      // Un token de acceso no sirve como intermedio.
      await api()
        .post('/v1/auth/2fa/login')
        .send({ challengeToken: token, code: nextCode(secret) })
        .expect(401);
      await api()
        .post('/v1/auth/2fa/login')
        .send({ code: '123456' })
        .expect(400);
    });

    it('la contraseña incorrecta no llega a pedir el código', async () => {
      const staff = await person(['ADMIN']);
      await enroll(staff.email);
      const res = await api()
        .post('/v1/auth/login')
        .send({ email: staff.email, password: 'otra-clave-1' })
        .expect(401);
      expect(res.body.challengeToken).toBeUndefined();
    });
  });

  describe('sesiones', () => {
    it('al cerrar sesión, el token de acceso deja de servir', async () => {
      const customer = await person();
      const { body } = await login(customer.email);
      await api().get('/v1/auth/me').set(auth(body.accessToken)).expect(200);
      await api()
        .post('/v1/auth/logout')
        .send({ refreshToken: body.refreshToken })
        .expect(204);
      await api().get('/v1/auth/me').set(auth(body.accessToken)).expect(401);
    });
  });

  describe('desactivar y restablecer', () => {
    it('desactivar pide contraseña y código, y la sesión pierde el panel', async () => {
      const staff = await person(['ORDERS_OPERATOR']);
      const { secret, token } = await enroll(staff.email);
      await api()
        .post('/v1/auth/2fa/disable')
        .set(auth(token))
        .send({ password: 'otra-clave', code: nextCode(secret) })
        .expect(400);
      await api()
        .post('/v1/auth/2fa/disable')
        .set(auth(token))
        .send({ password: PASSWORD, code: '000000' })
        .expect(400);
      await api()
        .post('/v1/auth/2fa/disable')
        .set(auth(token))
        .send({ password: PASSWORD, code: nextCode(secret) })
        .expect(204);
      await api().get('/v1/manage/orders').set(auth(token)).expect(403);
      // Sin 2FA, la contraseña vuelve a bastar para entrar (a la cuenta).
      const again = await login(staff.email);
      expect(again.body.accessToken).toBeDefined();
      await api()
        .post('/v1/auth/2fa/disable')
        .set(auth(again.body.accessToken))
        .send({ password: PASSWORD, code: '123456' })
        .expect(409);
    });

    it('el administrador la restablece a otra persona; nadie más puede', async () => {
      const admin = await person(['ADMIN']);
      const adminSession = await enroll(admin.email);
      const staff = await person(['ORDERS_OPERATOR']);
      const lost = await enroll(staff.email);

      await api()
        .delete(`/v1/users/${staff.id}/two-factor`)
        .set(auth(lost.token))
        .expect(403);
      await api()
        .delete(`/v1/users/${staff.id}/two-factor`)
        .set(auth(adminSession.token))
        .expect(204);
      // Sus sesiones abiertas pierden la verificación.
      await api().get('/v1/manage/orders').set(auth(lost.token)).expect(403);
      const again = await login(staff.email);
      expect(again.body.accessToken).toBeDefined();
      await api()
        .delete(`/v1/users/${staff.id}/two-factor`)
        .set(auth(adminSession.token))
        .expect(409);
      await api()
        .delete('/v1/users/00000000-0000-4000-8000-000000000000/two-factor')
        .set(auth(adminSession.token))
        .expect(404);
      expect(
        await prisma.auditLog.count({
          where: { action: 'auth.2fa_reset', actorId: admin.id },
        }),
      ).toBe(1);
    });
  });
});
