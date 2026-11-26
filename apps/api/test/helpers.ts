import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import type { Role } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

export async function createTestApp() {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

// Vacía todas las tablas de la aplicación entre pruebas.
export async function resetDb(prisma: PrismaService) {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = tables.map((t) => `"${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`,
  );
}

// Crea una persona con los roles dados y devuelve su access token.
export async function loginAs(
  app: NestExpressApplication,
  prisma: PrismaService,
  roles: Role[],
) {
  const email = `${roles.join('-').toLowerCase()}-${Math.random().toString(36).slice(2)}@test.com`;
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await argon2.hash('clave-de-prueba-1'),
      firstName: 'Prueba',
      lastName: roles.join(' '),
      roles: {
        create: [...new Set<Role>(['CUSTOMER', ...roles])].map((role) => ({
          role,
        })),
      },
    },
  });
  const res = await request(app.getHttpServer())
    .post('/v1/auth/login')
    .send({ email, password: 'clave-de-prueba-1' });
  return { id: user.id, token: res.body.accessToken as string };
}
