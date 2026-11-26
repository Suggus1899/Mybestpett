import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, loginAs, resetDb } from './helpers.js';

describe('Catálogo, animales y tasas (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  async function seedCategory() {
    const perros = await prisma.category.create({
      data: { name: 'Perros', slug: 'perros' },
    });
    const alimento = await prisma.category.create({
      data: {
        name: 'Alimento para perros',
        slug: 'perros-alimento',
        parentId: perros.id,
      },
    });
    return { perros, alimento };
  }

  const product = (categoryId: string) => ({
    name: 'Croquetas Adulto Pollo',
    description: 'Alimento completo para perros adultos.',
    categoryId,
    species: ['DOG'],
    isReturnable: false,
    variants: [
      {
        sku: 'cro-3kg',
        name: '3 kg',
        priceUsdCents: 1500,
        compareAtUsdCents: 1800,
        stock: 4,
      },
      { sku: 'CRO-15KG', name: '15 kg', priceUsdCents: 5500, stock: 0 },
    ],
    images: [
      { url: 'https://cdn.petbf.test/cro.jpg', alt: 'Saco de croquetas' },
    ],
  });

  describe('productos', () => {
    it('solo el equipo de catálogo puede crear productos', async () => {
      const { alimento } = await seedCategory();
      const customer = await loginAs(app, prisma, []);
      await api()
        .post('/v1/manage/products')
        .set('Authorization', `Bearer ${customer.token}`)
        .send(product(alimento.id))
        .expect(403);
      await api()
        .post('/v1/manage/products')
        .send(product(alimento.id))
        .expect(401);
    });

    it('crea, lista con filtros y muestra la ficha pública sin revelar el stock', async () => {
      const { alimento } = await seedCategory();
      const manager = await loginAs(app, prisma, ['CATALOG_MANAGER']);
      const created = await api()
        .post('/v1/manage/products')
        .set('Authorization', `Bearer ${manager.token}`)
        .send(product(alimento.id))
        .expect(201);
      expect(created.body.slug).toBe('croquetas-adulto-pollo');
      expect(created.body.variants.map((v: { sku: string }) => v.sku)).toEqual([
        'CRO-3KG',
        'CRO-15KG',
      ]);

      // La categoría padre incluye la subcategoría.
      const list = await api()
        .get('/v1/products?category=perros&species=DOG')
        .expect(200);
      expect(list.body.total).toBe(1);
      expect(list.body.items[0]).toMatchObject({
        priceFromUsdCents: 1500,
        compareAtUsdCents: 1800,
        inStock: true,
        image: { url: 'https://cdn.petbf.test/cro.jpg' },
      });

      const search = await api()
        .get('/v1/products?q=croqu&onSale=true')
        .expect(200);
      expect(search.body.total).toBe(1);
      const none = await api().get('/v1/products?species=CAT').expect(200);
      expect(none.body.total).toBe(0);

      const detail = await api()
        .get('/v1/products/croquetas-adulto-pollo')
        .expect(200);
      expect(detail.body.variants[0]).toMatchObject({
        sku: 'CRO-3KG',
        inStock: true,
      });
      expect(detail.body.variants[0].stock).toBeUndefined();
      expect(detail.body.isReturnable).toBe(false);
    });

    it('oculta los productos inactivos al público pero no al equipo', async () => {
      const { alimento } = await seedCategory();
      const manager = await loginAs(app, prisma, ['CATALOG_MANAGER']);
      await api()
        .post('/v1/manage/products')
        .set('Authorization', `Bearer ${manager.token}`)
        .send({ ...product(alimento.id), isActive: false })
        .expect(201);

      await api().get('/v1/products/croquetas-adulto-pollo').expect(404);
      expect((await api().get('/v1/products')).body.total).toBe(0);
      const staff = await api()
        .get('/v1/manage/products?active=false')
        .set('Authorization', `Bearer ${manager.token}`)
        .expect(200);
      expect(staff.body.total).toBe(1);
    });

    it('audita cambios de precio y stock con el valor anterior', async () => {
      const { alimento } = await seedCategory();
      const manager = await loginAs(app, prisma, ['CATALOG_MANAGER']);
      const { body } = await api()
        .post('/v1/manage/products')
        .set('Authorization', `Bearer ${manager.token}`)
        .send(product(alimento.id));
      const variant = body.variants.find(
        (v: { sku: string }) => v.sku === 'CRO-3KG',
      );

      await api()
        .patch(`/v1/manage/variants/${variant.id}`)
        .set('Authorization', `Bearer ${manager.token}`)
        .send({ priceUsdCents: 1400, stock: 10 })
        .expect(200);

      const log = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'variant.updated', entityId: variant.id },
      });
      expect(log.metadata).toEqual({
        priceUsdCents: { from: 1500, to: 1400 },
        stock: { from: 4, to: 10 },
      });
    });

    it('rechaza una oferta cuyo precio anterior no es mayor', async () => {
      const { alimento } = await seedCategory();
      const manager = await loginAs(app, prisma, ['CATALOG_MANAGER']);
      const { body } = await api()
        .post('/v1/manage/products')
        .set('Authorization', `Bearer ${manager.token}`)
        .send(product(alimento.id));
      const variant = body.variants.find(
        (v: { sku: string }) => v.sku === 'CRO-3KG',
      );
      // 1800 de precio anterior con un precio nuevo de 2000: no tiene sentido.
      await api()
        .patch(`/v1/manage/variants/${variant.id}`)
        .set('Authorization', `Bearer ${manager.token}`)
        .send({ priceUsdCents: 2000 })
        .expect(400);
    });

    it('un SKU repetido da 409', async () => {
      const { alimento } = await seedCategory();
      const manager = await loginAs(app, prisma, ['CATALOG_MANAGER']);
      const send = (name: string) =>
        api()
          .post('/v1/manage/products')
          .set('Authorization', `Bearer ${manager.token}`)
          .send({ ...product(alimento.id), name });
      await send('Producto uno').expect(201);
      await send('Producto dos').expect(409);
    });
  });

  describe('animales', () => {
    const adoption = {
      name: 'Luna',
      listingType: 'ADOPTION',
      species: 'CAT',
      sex: 'FEMALE',
      birthDate: '2025-03-10',
      description: 'Gata tranquila, vacunada y esterilizada.',
      isVaccinated: true,
      isSterilized: true,
    };

    it('cada equipo gestiona su tipo de publicación', async () => {
      const catalog = await loginAs(app, prisma, ['CATALOG_MANAGER']);
      const adoptions = await loginAs(app, prisma, ['ADOPTION_COORDINATOR']);

      await api()
        .post('/v1/manage/animals')
        .set('Authorization', `Bearer ${catalog.token}`)
        .send(adoption)
        .expect(403);
      const created = await api()
        .post('/v1/manage/animals')
        .set('Authorization', `Bearer ${adoptions.token}`)
        .send(adoption)
        .expect(201);
      expect(created.body.priceUsdCents).toBeNull();

      const list = await api()
        .get('/v1/animals?listingType=ADOPTION')
        .expect(200);
      expect(list.body.total).toBe(1);
      await api().get(`/v1/animals/${created.body.slug}`).expect(200);
    });

    it('exige precio en venta y lo prohíbe en adopción', async () => {
      const admin = await loginAs(app, prisma, ['ADMIN']);
      await api()
        .post('/v1/manage/animals')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ ...adoption, listingType: 'SALE' })
        .expect(400);
      await api()
        .post('/v1/manage/animals')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ ...adoption, priceUsdCents: 5000 })
        .expect(400);
      await api()
        .post('/v1/manage/animals')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ ...adoption, listingType: 'SALE', priceUsdCents: 12000 })
        .expect(201);
    });

    it('un animal adoptado deja de aparecer en el listado', async () => {
      const admin = await loginAs(app, prisma, ['ADMIN']);
      const { body } = await api()
        .post('/v1/manage/animals')
        .set('Authorization', `Bearer ${admin.token}`)
        .send(adoption);
      await api()
        .patch(`/v1/manage/animals/${body.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ status: 'ADOPTED' })
        .expect(200);
      expect((await api().get('/v1/animals')).body.total).toBe(0);
    });
  });

  describe('tasas', () => {
    it('solo el admin carga la tasa y volver a cargarla el mismo día la corrige', async () => {
      const operator = await loginAs(app, prisma, ['ORDERS_OPERATOR']);
      const admin = await loginAs(app, prisma, ['ADMIN']);
      const body = {
        usdVes: '245.5',
        eurVes: '268.1234',
        effectiveDate: '2026-11-25',
      };

      await api()
        .post('/v1/exchange-rates')
        .set('Authorization', `Bearer ${operator.token}`)
        .send(body)
        .expect(403);
      await api()
        .post('/v1/exchange-rates')
        .set('Authorization', `Bearer ${admin.token}`)
        .send(body)
        .expect(201);
      await api()
        .post('/v1/exchange-rates')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ ...body, usdVes: '246' })
        .expect(201);

      const current = await api().get('/v1/exchange-rates/current').expect(200);
      expect(current.body.usdVes.rate).toBe('246');
      expect(current.body.eurVes.rate).toBe('268.1234');
      expect(await prisma.exchangeRate.count()).toBe(2);
      expect(
        await prisma.auditLog.count({ where: { action: 'rate.corrected' } }),
      ).toBe(2);
    });

    it('rechaza tasas mal escritas', async () => {
      const admin = await loginAs(app, prisma, ['ADMIN']);
      for (const usdVes of ['245,5', '0', '-3', 'abc']) {
        await api()
          .post('/v1/exchange-rates')
          .set('Authorization', `Bearer ${admin.token}`)
          .send({ usdVes })
          .expect(400);
      }
    });
  });
});
