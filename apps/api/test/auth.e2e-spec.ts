import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { resetDb } from './helpers.js';

describe('Auth y roles (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  const customer = {
    email: 'Cliente@Ejemplo.com',
    password: 'clave-segura-1',
    firstName: 'Ana',
    lastName: 'Pérez',
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDb(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());

  it('registra, normaliza el correo y no expone el hash', async () => {
    const res = await api()
      .post('/v1/auth/register')
      .send(customer)
      .expect(201);
    expect(res.body.user.email).toBe('cliente@ejemplo.com');
    expect(res.body.user.roles).toEqual(['CUSTOMER']);
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.accessToken).toBeTypeOf('string');

    await api().post('/v1/auth/register').send(customer).expect(409);
  });

  it('rechaza datos inválidos con 400', async () => {
    await api()
      .post('/v1/auth/register')
      .send({ ...customer, password: 'corta' })
      .expect(400);
  });

  it('exige sesión en /auth/me', async () => {
    await api().get('/v1/auth/me').expect(401);
    const { body } = await api().post('/v1/auth/register').send(customer);
    const me = await api()
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200);
    expect(me.body.email).toBe('cliente@ejemplo.com');
  });

  it('rota el refresh token y cierra la sesión si se reutiliza uno viejo', async () => {
    const { body } = await api().post('/v1/auth/register').send(customer);
    const first = body.refreshToken;

    const rotated = await api()
      .post('/v1/auth/refresh')
      .send({ refreshToken: first })
      .expect(200);
    expect(rotated.body.refreshToken).not.toBe(first);

    await api()
      .post('/v1/auth/refresh')
      .send({ refreshToken: first })
      .expect(401);
    // Tras detectar la reutilización, el token nuevo tampoco sirve.
    await api()
      .post('/v1/auth/refresh')
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(401);
  });

  it('logout invalida el refresh token', async () => {
    const { body } = await api().post('/v1/auth/register').send(customer);
    await api()
      .post('/v1/auth/logout')
      .send({ refreshToken: body.refreshToken })
      .expect(204);
    await api()
      .post('/v1/auth/refresh')
      .send({ refreshToken: body.refreshToken })
      .expect(401);
  });

  it('login con contraseña incorrecta da 401 y queda auditado', async () => {
    await api().post('/v1/auth/register').send(customer);
    await api()
      .post('/v1/auth/login')
      .send({ email: customer.email, password: 'otra-clave-x' })
      .expect(401);
    const failed = await prisma.auditLog.count({
      where: { action: 'auth.login_failed' },
    });
    expect(failed).toBe(1);
  });

  describe('gestión de usuarios', () => {
    async function loginAsAdmin() {
      await prisma.user.create({
        data: {
          email: 'admin@ejemplo.com',
          passwordHash: await argon2.hash('clave-admin-123'),
          firstName: 'Gus',
          lastName: 'Admin',
          roles: { create: [{ role: 'CUSTOMER' }, { role: 'ADMIN' }] },
        },
      });
      const { body } = await api()
        .post('/v1/auth/login')
        .send({ email: 'admin@ejemplo.com', password: 'clave-admin-123' });
      return body as { accessToken: string; user: { id: string } };
    }

    it('un cliente no puede listar usuarios', async () => {
      const { body } = await api().post('/v1/auth/register').send(customer);
      await api()
        .get('/v1/users')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .expect(403);
    });

    it('el admin asigna varios roles y queda en la auditoría', async () => {
      const admin = await loginAsAdmin();
      const { body: reg } = await api()
        .post('/v1/auth/register')
        .send(customer);

      const res = await api()
        .put(`/v1/users/${reg.user.id}/roles`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ roles: ['CATALOG_MANAGER', 'ADOPTION_COORDINATOR'] })
        .expect(200);
      // CUSTOMER se conserva siempre.
      expect(res.body.roles).toEqual([
        'CUSTOMER',
        'CATALOG_MANAGER',
        'ADOPTION_COORDINATOR',
      ]);

      const log = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'user.roles_changed', entityId: reg.user.id },
      });
      expect(log.actorId).toBe(admin.user.id);
      expect(log.metadata).toEqual({
        from: ['CUSTOMER'],
        to: ['CUSTOMER', 'CATALOG_MANAGER', 'ADOPTION_COORDINATOR'],
      });

      const filtered = await api()
        .get('/v1/users?role=CATALOG_MANAGER')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);
      expect(filtered.body.total).toBe(1);
    });

    it('un gestor de catálogo no puede gestionar cuentas', async () => {
      const admin = await loginAsAdmin();
      const { body: reg } = await api()
        .post('/v1/auth/register')
        .send(customer);
      await api()
        .put(`/v1/users/${reg.user.id}/roles`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ roles: ['CATALOG_MANAGER'] });

      await api()
        .get('/v1/users')
        .set('Authorization', `Bearer ${reg.accessToken}`)
        .expect(403);
    });

    it('el admin no puede quitarse su propio rol de admin', async () => {
      const admin = await loginAsAdmin();
      await api()
        .put(`/v1/users/${admin.user.id}/roles`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ roles: ['CUSTOMER'] })
        .expect(400);
    });

    it('desactivar una cuenta corta su acceso de inmediato', async () => {
      const admin = await loginAsAdmin();
      const { body: reg } = await api()
        .post('/v1/auth/register')
        .send(customer);

      await api()
        .patch(`/v1/users/${reg.user.id}/status`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ isActive: false })
        .expect(200);

      await api()
        .get('/v1/auth/me')
        .set('Authorization', `Bearer ${reg.accessToken}`)
        .expect(401);
      await api()
        .post('/v1/auth/refresh')
        .send({ refreshToken: reg.refreshToken })
        .expect(401);
    });
  });
});
