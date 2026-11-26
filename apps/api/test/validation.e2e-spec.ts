import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, loginAs, resetDb } from './helpers.js';

// Entradas inválidas, permisos y abusos: lo que un cliente o alguien del
// equipo podría enviar por error o a propósito.
describe('Validaciones y permisos (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const customer = {
    email: 'cliente@ejemplo.com',
    password: 'clave-segura-1',
    firstName: 'Ana',
    lastName: 'Pérez',
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(() => resetDb(prisma));
  // Deja la base vacía para lo que se ejecute después (por ejemplo Playwright).
  afterAll(async () => {
    await resetDb(prisma);
    await app.close();
  });

  describe('registro', () => {
    it.each([
      ['sin correo', { ...customer, email: undefined }],
      ['correo inválido', { ...customer, email: 'no-es-correo' }],
      ['sin contraseña', { ...customer, password: undefined }],
      ['contraseña de 7', { ...customer, password: '1234567' }],
      ['contraseña de 129', { ...customer, password: 'a'.repeat(129) }],
      ['nombre vacío', { ...customer, firstName: '   ' }],
      ['apellido de 81', { ...customer, lastName: 'a'.repeat(81) }],
      ['teléfono con letras', { ...customer, phone: '0412-ABC' }],
      ['teléfono corto', { ...customer, phone: '0412' }],
      ['nombre no texto', { ...customer, firstName: 123 }],
    ])('rechaza %s', async (_case, body) => {
      await api().post('/v1/auth/register').send(body).expect(400);
    });

    it('rechaza un cuerpo que no es un objeto', async () => {
      await api().post('/v1/auth/register').send([customer]).expect(400);
      await api()
        .post('/v1/auth/register')
        .set('Content-Type', 'application/json')
        .send('{"roto":')
        .expect(400);
    });

    it('ignora campos que el cliente no debe controlar (roles, activo)', async () => {
      const res = await api()
        .post('/v1/auth/register')
        .send({ ...customer, roles: ['ADMIN'], role: 'ADMIN', isActive: false })
        .expect(201);
      expect(res.body.user.roles).toEqual(['CUSTOMER']);
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: res.body.user.id },
      });
      expect(user.isActive).toBe(true);
    });

    it('acepta teléfonos venezolanos habituales', async () => {
      for (const [i, phone] of [
        '0412-1234567',
        '+58 412 1234567',
        '04121234567',
      ].entries()) {
        await api()
          .post('/v1/auth/register')
          .send({ ...customer, email: `tel${i}@ejemplo.com`, phone })
          .expect(201);
      }
    });
  });

  describe('login y tokens', () => {
    it('el correo no distingue mayúsculas ni espacios', async () => {
      await api().post('/v1/auth/register').send(customer);
      await api()
        .post('/v1/auth/login')
        .send({ email: '  CLIENTE@Ejemplo.com ', password: customer.password })
        .expect(200);
    });

    it('correo inexistente y contraseña mala dan el mismo mensaje', async () => {
      await api().post('/v1/auth/register').send(customer);
      const a = await api()
        .post('/v1/auth/login')
        .send({ email: 'nadie@ejemplo.com', password: 'x' })
        .expect(401);
      const b = await api()
        .post('/v1/auth/login')
        .send({ email: customer.email, password: 'mala-clave' })
        .expect(401);
      expect(a.body.message).toBe(b.body.message);
    });

    it('una cuenta desactivada no puede entrar', async () => {
      await api().post('/v1/auth/register').send(customer);
      await prisma.user.update({
        where: { email: customer.email },
        data: { isActive: false },
      });
      await api()
        .post('/v1/auth/login')
        .send({ email: customer.email, password: customer.password })
        .expect(401);
    });

    it('rechaza tokens mal formados, firmados con otra clave o sin firma', async () => {
      const { body } = await api().post('/v1/auth/register').send(customer);
      const forged = await new JwtService({
        secret: 'otra-clave-que-no-es-la-del-servidor-0123456789',
      }).signAsync({ sub: body.user.id });
      const [header, payload] = (body.accessToken as string).split('.');
      const unsigned = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${payload}.`;

      for (const value of [
        'Bearer',
        'Bearer ',
        'Bearer basura',
        `Token ${body.accessToken}`,
        `Bearer ${forged}`,
        `Bearer ${unsigned}`,
        `Bearer ${header}.${payload}.firma-falsa`,
      ]) {
        await api().get('/v1/auth/me').set('Authorization', value).expect(401);
      }
    });

    it('rechaza refresh tokens inventados o de sesiones vencidas', async () => {
      const { body } = await api().post('/v1/auth/register').send(customer);
      for (const refreshToken of [
        'basura',
        '00000000-0000-0000-0000-000000000000.secreto',
        `${body.refreshToken}x`,
        '',
      ]) {
        const res = await api().post('/v1/auth/refresh').send({ refreshToken });
        expect([400, 401]).toContain(res.status);
      }
      await prisma.session.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await api()
        .post('/v1/auth/refresh')
        .send({ refreshToken: body.refreshToken })
        .expect(401);
    });

    it('logout con un token inválido no revela nada', async () => {
      await api()
        .post('/v1/auth/logout')
        .send({ refreshToken: 'basura' })
        .expect(204);
    });
  });

  describe('gestión de usuarios', () => {
    it('valida ids, roles y paginación', async () => {
      const admin = await loginAs(app, prisma, ['ADMIN']);
      const other = await loginAs(app, prisma, []);
      await api()
        .put('/v1/users/no-es-uuid/roles')
        .set(auth(admin.token))
        .send({ roles: [] })
        .expect(400);
      await api()
        .put(`/v1/users/${other.id}/roles`)
        .set(auth(admin.token))
        .send({ roles: ['SUPERADMIN'] })
        .expect(400);
      await api()
        .put('/v1/users/00000000-0000-4000-8000-000000000000/roles')
        .set(auth(admin.token))
        .send({ roles: ['CATALOG_MANAGER'] })
        .expect(404);
      await api()
        .get('/v1/users?pageSize=500')
        .set(auth(admin.token))
        .expect(400);
      await api().get('/v1/users?role=JEFE').set(auth(admin.token)).expect(400);
      await api()
        .patch(`/v1/users/${admin.id}/status`)
        .set(auth(admin.token))
        .send({ isActive: false })
        .expect(400);
      await api()
        .patch(`/v1/users/${other.id}/status`)
        .set(auth(admin.token))
        .send({ isActive: 'no' })
        .expect(400);
    });

    it('nadie del equipo salvo ADMIN asigna roles', async () => {
      for (const role of [
        'ORDERS_OPERATOR',
        'CATALOG_MANAGER',
        'ADOPTION_COORDINATOR',
      ] as const) {
        const staff = await loginAs(app, prisma, [role]);
        await api()
          .put(`/v1/users/${staff.id}/roles`)
          .set(auth(staff.token))
          .send({ roles: ['ADMIN'] })
          .expect(403);
      }
    });
  });

  describe('catálogo', () => {
    let categoryId: string;
    let manager: { token: string };
    const valid = () => ({
      name: 'Pelota de goma',
      description: 'Juguete resistente.',
      categoryId,
      species: ['DOG'],
      variants: [{ sku: 'PEL-1', name: 'Única', priceUsdCents: 500, stock: 3 }],
    });

    beforeEach(async () => {
      categoryId = (
        await prisma.category.create({
          data: { name: 'Perros', slug: 'perros' },
        })
      ).id;
      manager = await loginAs(app, prisma, ['CATALOG_MANAGER']);
    });

    it.each([
      ['sin variantes', { variants: [] }],
      [
        'precio negativo',
        { variants: [{ sku: 'A-1', name: 'x', priceUsdCents: -1 }] },
      ],
      [
        'precio con decimales',
        { variants: [{ sku: 'A-1', name: 'x', priceUsdCents: 4.5 }] },
      ],
      [
        'precio como texto',
        { variants: [{ sku: 'A-1', name: 'x', priceUsdCents: '500' }] },
      ],
      [
        'stock negativo',
        { variants: [{ sku: 'A-1', name: 'x', priceUsdCents: 1, stock: -2 }] },
      ],
      [
        'SKU con espacios',
        { variants: [{ sku: 'A 1', name: 'x', priceUsdCents: 1 }] },
      ],
      [
        'oferta menor que el precio',
        {
          variants: [
            {
              sku: 'A-1',
              name: 'x',
              priceUsdCents: 500,
              compareAtUsdCents: 400,
            },
          ],
        },
      ],
      [
        'imagen sin https',
        { images: [{ url: 'http://cdn.test/a.jpg', alt: 'a' }] },
      ],
      [
        'imagen javascript:',
        { images: [{ url: 'javascript:alert(1)', alt: 'a' }] },
      ],
      [
        'imagen sin texto alternativo',
        { images: [{ url: 'https://cdn.test/a.jpg', alt: '' }] },
      ],
      ['categoría que no es uuid', { categoryId: '123' }],
      ['especie inválida', { species: ['DRAGON'] }],
      ['slug con mayúsculas', { slug: 'Pelota-Goma' }],
      ['descripción enorme', { description: 'a'.repeat(5001) }],
    ])('rechaza un producto con %s', async (_case, patch) => {
      await api()
        .post('/v1/manage/products')
        .set(auth(manager.token))
        .send({ ...valid(), ...patch })
        .expect(400);
    });

    it('una categoría inexistente da 400 y un slug repetido 409', async () => {
      await api()
        .post('/v1/manage/products')
        .set(auth(manager.token))
        .send({
          ...valid(),
          categoryId: '00000000-0000-4000-8000-000000000000',
        })
        .expect(400);
      await api()
        .post('/v1/manage/products')
        .set(auth(manager.token))
        .send(valid())
        .expect(201);
      await api()
        .post('/v1/manage/products')
        .set(auth(manager.token))
        .send({
          ...valid(),
          variants: [{ sku: 'PEL-2', name: 'x', priceUsdCents: 1 }],
        })
        .expect(409);
    });

    it('valida las ediciones de variantes', async () => {
      const { body } = await api()
        .post('/v1/manage/products')
        .set(auth(manager.token))
        .send(valid());
      const variantId = body.variants[0].id;
      await api()
        .patch(`/v1/manage/variants/${variantId}`)
        .set(auth(manager.token))
        .send({})
        .expect(400);
      await api()
        .patch(`/v1/manage/variants/${variantId}`)
        .set(auth(manager.token))
        .send({ stock: -1 })
        .expect(400);
      await api()
        .patch('/v1/manage/variants/00000000-0000-4000-8000-000000000000')
        .set(auth(manager.token))
        .send({ stock: 1 })
        .expect(404);
      // Quitar la oferta con null está permitido.
      await api()
        .patch(`/v1/manage/variants/${variantId}`)
        .set(auth(manager.token))
        .send({ compareAtUsdCents: null })
        .expect(200);
    });

    it('clientes, adopciones y pagos no editan el catálogo', async () => {
      const { body } = await api()
        .post('/v1/manage/products')
        .set(auth(manager.token))
        .send(valid());
      for (const roles of [
        [],
        ['ADOPTION_COORDINATOR'],
        ['ORDERS_OPERATOR'],
      ] as const) {
        const user = await loginAs(app, prisma, [...roles]);
        await api()
          .patch(`/v1/manage/variants/${body.variants[0].id}`)
          .set(auth(user.token))
          .send({ stock: 999 })
          .expect(403);
        await api()
          .post('/v1/manage/products')
          .set(auth(user.token))
          .send(valid())
          .expect(403);
      }
      await api()
        .patch(`/v1/manage/variants/${body.variants[0].id}`)
        .send({ stock: 1 })
        .expect(401);
    });

    it('valida los filtros públicos', async () => {
      await api().get('/v1/products?pageSize=61').expect(400);
      await api().get('/v1/products?page=0').expect(400);
      await api().get('/v1/products?q=a').expect(400);
      await api().get('/v1/products?species=DRAGON').expect(400);
      await api().get('/v1/products?sort=precio').expect(400);
      await api().get('/v1/products/Slug_Invalido').expect(400);
      await api().get('/v1/products/no-existe').expect(404);
      await api().get('/v1/products?category=no-existe').expect(200);
    });

    it('las categorías validan su padre', async () => {
      await api()
        .post('/v1/manage/categories')
        .set(auth(manager.token))
        .send({
          name: 'Juguetes',
          parentId: '00000000-0000-4000-8000-000000000000',
        })
        .expect(400);
      const sub = await api()
        .post('/v1/manage/categories')
        .set(auth(manager.token))
        .send({ name: 'Juguetes para perros', parentId: categoryId })
        .expect(201);
      expect(sub.body.slug).toBe('juguetes-para-perros');
      await api()
        .patch('/v1/manage/categories/00000000-0000-4000-8000-000000000000')
        .set(auth(manager.token))
        .send({ name: 'x' })
        .expect(404);
    });
  });

  describe('animales', () => {
    it('valida fechas, estados y la regla de precio al editar', async () => {
      const admin = await loginAs(app, prisma, ['ADMIN']);
      const base = {
        name: 'Rocky',
        listingType: 'SALE',
        species: 'DOG',
        description: 'Cachorro.',
        priceUsdCents: 15000,
      };
      await api()
        .post('/v1/manage/animals')
        .set(auth(admin.token))
        .send({ ...base, birthDate: '10/03/2025' })
        .expect(400);
      await api()
        .post('/v1/manage/animals')
        .set(auth(admin.token))
        .send({ ...base, status: 'VENDIDO' })
        .expect(400);
      const { body } = await api()
        .post('/v1/manage/animals')
        .set(auth(admin.token))
        .send(base)
        .expect(201);
      await api()
        .patch(`/v1/manage/animals/${body.id}`)
        .set(auth(admin.token))
        .send({ priceUsdCents: null })
        .expect(400);
      // El tipo de publicación no se puede cambiar después.
      const changed = await api()
        .patch(`/v1/manage/animals/${body.id}`)
        .set(auth(admin.token))
        .send({ listingType: 'ADOPTION', name: 'Rocky II' })
        .expect(200);
      expect(changed.body.listingType).toBe('SALE');
    });

    it('adopciones no edita un animal en venta y uno no disponible no se muestra', async () => {
      const catalog = await loginAs(app, prisma, ['CATALOG_MANAGER']);
      const adoptions = await loginAs(app, prisma, ['ADOPTION_COORDINATOR']);
      const { body } = await api()
        .post('/v1/manage/animals')
        .set(auth(catalog.token))
        .send({
          name: 'Kiwi',
          listingType: 'SALE',
          species: 'BIRD',
          breed: 'Periquito australiano',
          description: 'Periquito.',
          priceUsdCents: 2500,
        });
      await api()
        .patch(`/v1/manage/animals/${body.id}`)
        .set(auth(adoptions.token))
        .send({ status: 'SOLD' })
        .expect(403);
      await api()
        .patch(`/v1/manage/animals/${body.id}`)
        .set(auth(catalog.token))
        .send({ status: 'UNAVAILABLE' })
        .expect(200);
      await api().get(`/v1/animals/${body.slug}`).expect(404);
    });

    it('solo acepta especies domésticas y no fauna protegida', async () => {
      const admin = await loginAs(app, prisma, ['ADMIN']);
      const bird = {
        name: 'Paco',
        listingType: 'SALE',
        species: 'BIRD',
        description: 'Ave.',
        priceUsdCents: 3000,
      };
      const create = (extra: object) =>
        api()
          .post('/v1/manage/animals')
          .set(auth(admin.token))
          .send({ ...bird, ...extra });

      const wild = await create({ breed: 'Guacamaya' }).expect(400);
      expect(wild.body.message).toMatch(/fauna protegida/);
      await create({}).expect(400); // ave sin tipo
      await create({ species: 'REPTILE', breed: 'Morrocoy' }).expect(400);
      await create({ species: 'RODENT', breed: 'Chigüire' }).expect(400);
      await create({ species: 'OTHER', breed: 'Mono' }).expect(400);

      const { body } = await create({ breed: 'canario belga' }).expect(201);
      // Al editar se valida la combinación con lo ya guardado.
      await api()
        .patch(`/v1/manage/animals/${body.id}`)
        .set(auth(admin.token))
        .send({ breed: 'Turpial' })
        .expect(400);
      await api()
        .patch(`/v1/manage/animals/${body.id}`)
        .set(auth(admin.token))
        .send({ species: 'RODENT' })
        .expect(400);
      await api()
        .patch(`/v1/manage/animals/${body.id}`)
        .set(auth(admin.token))
        .send({ species: 'RODENT', breed: 'Hámster' })
        .expect(200);
      // Editar otros campos no exige volver a validar la especie.
      await api()
        .patch(`/v1/manage/animals/${body.id}`)
        .set(auth(admin.token))
        .send({ name: 'Paco II' })
        .expect(200);
    });

    it('publica la lista de especies aceptadas', async () => {
      const { body } = await api().get('/v1/animal-species').expect(200);
      const bird = body.find((r: { species: string }) => r.species === 'BIRD');
      expect(bird.kinds).toContain('Canario');
      expect(
        body.find((r: { species: string }) => r.species === 'REPTILE').allowed,
      ).toBe('none');
    });
  });

  describe('tasas e inventario', () => {
    it('valida la fecha y no publica una tasa con fecha futura', async () => {
      const admin = await loginAs(app, prisma, ['ADMIN']);
      await api()
        .post('/v1/exchange-rates')
        .set(auth(admin.token))
        .send({ usdVes: '245', effectiveDate: '26-11-2026' })
        .expect(400);
      await api()
        .post('/v1/exchange-rates')
        .set(auth(admin.token))
        .send({ usdVes: '300', effectiveDate: '2099-01-01' })
        .expect(201);
      const current = await api().get('/v1/exchange-rates/current').expect(200);
      expect(current.body.usdVes).toBeNull();
    });

    it('el historial es solo para el equipo de pagos', async () => {
      const customer = await loginAs(app, prisma, []);
      const operator = await loginAs(app, prisma, ['ORDERS_OPERATOR']);
      await api()
        .get('/v1/exchange-rates')
        .set(auth(customer.token))
        .expect(403);
      await api()
        .get('/v1/exchange-rates')
        .set(auth(operator.token))
        .expect(200);
    });

    it('valida los filtros del inventario', async () => {
      const manager = await loginAs(app, prisma, ['CATALOG_MANAGER']);
      for (const qs of [
        'status=agotado',
        'lowThreshold=0',
        'sort=precio',
        'pageSize=101',
      ]) {
        await api()
          .get(`/v1/manage/inventory?${qs}`)
          .set(auth(manager.token))
          .expect(400);
      }
      await api()
        .get('/v1/manage/inventory/summary?lowThreshold=-1')
        .set(auth(manager.token))
        .expect(400);
    });
  });

  // Regresión: los valores por defecto de los esquemas no deben pisar campos
  // que la edición no envía.
  describe('ediciones parciales', () => {
    it('cambiar solo el precio no toca el stock ni el estado', async () => {
      const category = await prisma.category.create({
        data: { name: 'Gatos', slug: 'gatos' },
      });
      const manager = await loginAs(app, prisma, ['CATALOG_MANAGER']);
      const { body } = await api()
        .post('/v1/manage/products')
        .set(auth(manager.token))
        .send({
          name: 'Rascador',
          description: 'Rascador de cartón.',
          categoryId: category.id,
          species: ['CAT'],
          isReturnable: false,
          variants: [
            {
              sku: 'RAS-1',
              name: 'Único',
              priceUsdCents: 1200,
              stock: 7,
              isActive: false,
            },
          ],
        });
      const variant = await api()
        .patch(`/v1/manage/variants/${body.variants[0].id}`)
        .set(auth(manager.token))
        .send({ priceUsdCents: 1100 })
        .expect(200);
      expect(variant.body).toMatchObject({
        priceUsdCents: 1100,
        stock: 7,
        isActive: false,
      });

      const product = await api()
        .patch(`/v1/manage/products/${body.id}`)
        .set(auth(manager.token))
        .send({ name: 'Rascador grande' })
        .expect(200);
      expect(product.body).toMatchObject({
        name: 'Rascador grande',
        species: ['CAT'],
        isReturnable: false,
        isActive: true,
      });
    });

    it('cambiar solo el nombre de un animal no toca su estado ni su salud', async () => {
      const admin = await loginAs(app, prisma, ['ADMIN']);
      const { body } = await api()
        .post('/v1/manage/animals')
        .set(auth(admin.token))
        .send({
          name: 'Toby',
          listingType: 'ADOPTION',
          species: 'DOG',
          sex: 'MALE',
          status: 'RESERVED',
          description: 'Perro mayor.',
          isVaccinated: true,
          isSterilized: true,
        });
      const res = await api()
        .patch(`/v1/manage/animals/${body.id}`)
        .set(auth(admin.token))
        .send({ name: 'Toby el sabio' })
        .expect(200);
      expect(res.body).toMatchObject({
        status: 'RESERVED',
        sex: 'MALE',
        isVaccinated: true,
        isSterilized: true,
      });
    });

    it('una categoría editada conserva su orden y estado', async () => {
      const manager = await loginAs(app, prisma, ['CATALOG_MANAGER']);
      const { body } = await api()
        .post('/v1/manage/categories')
        .set(auth(manager.token))
        .send({ name: 'Aves', sortOrder: 4, isActive: false });
      const res = await api()
        .patch(`/v1/manage/categories/${body.id}`)
        .set(auth(manager.token))
        .send({ name: 'Aves y pájaros' })
        .expect(200);
      expect(res.body).toMatchObject({ sortOrder: 4, isActive: false });
    });
  });
});
