import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, resetDb } from './helpers.js';

// La IP real que reenvía la web se guarda en la sesión solo con el secreto.
describe('IP del cliente reenviada por la web (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const SECRET = 'secreto-de-la-web-para-pruebas-0123456789';
  const user = {
    email: 'ip@test.com',
    password: 'clave-segura-1',
    firstName: 'Ana',
    lastName: 'Pérez',
  };

  beforeAll(async () => {
    process.env.WEB_PROXY_SECRET = SECRET;
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(async () => {
    delete process.env.WEB_PROXY_SECRET;
    await resetDb(prisma);
    await app.close();
  });

  const sessionIp = async () =>
    (await prisma.session.findFirstOrThrow({ orderBy: { createdAt: 'desc' } }))
      .ip;

  it('guarda la IP reenviada cuando llega con el secreto', async () => {
    await request(app.getHttpServer())
      .post('/v1/auth/register')
      .set('x-petbf-web-key', SECRET)
      .set('x-petbf-client-ip', '190.202.10.20')
      .send(user)
      .expect(201);
    expect(await sessionIp()).toBe('190.202.10.20');
  });

  it('ignora la cabecera si el secreto no coincide', async () => {
    await request(app.getHttpServer())
      .post('/v1/auth/register')
      .set('x-petbf-web-key', 'adivinado')
      .set('x-petbf-client-ip', '190.202.10.20')
      .send(user)
      .expect(201);
    expect(await sessionIp()).not.toBe('190.202.10.20');
  });
});
