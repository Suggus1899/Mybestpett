import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, loginAs, resetDb } from './helpers.js';

describe('Inventario (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(() => app.close());

  beforeEach(async () => {
    await resetDb(prisma);
    const perros = await prisma.category.create({
      data: { name: 'Perros', slug: 'perros' },
    });
    const gatos = await prisma.category.create({
      data: { name: 'Gatos', slug: 'gatos' },
    });
    await prisma.product.create({
      data: {
        name: 'Croquetas',
        slug: 'croquetas',
        description: '-',
        categoryId: perros.id,
        variants: {
          create: [
            { sku: 'CRO-3', name: '3 kg', priceUsdCents: 1500, stock: 0 },
            { sku: 'CRO-15', name: '15 kg', priceUsdCents: 5000, stock: 3 },
          ],
        },
      },
    });
    await prisma.product.create({
      data: {
        name: 'Arena para gatos',
        slug: 'arena',
        description: '-',
        categoryId: gatos.id,
        variants: {
          create: [
            { sku: 'ARE-10', name: '10 kg', priceUsdCents: 800, stock: 40 },
          ],
        },
      },
    });
    await prisma.product.create({
      data: {
        name: 'Producto retirado',
        slug: 'retirado',
        description: '-',
        categoryId: gatos.id,
        isActive: false,
        variants: {
          create: [
            { sku: 'RET-1', name: 'único', priceUsdCents: 100, stock: 9 },
          ],
        },
      },
    });
    await prisma.animal.create({
      data: {
        name: 'Luna',
        slug: 'luna',
        listingType: 'ADOPTION',
        species: 'CAT',
        description: '-',
      },
    });
  });

  it('un cliente no puede verlo; pagos y pedidos sí', async () => {
    const customer = await loginAs(app, prisma, []);
    await api()
      .get('/v1/manage/inventory')
      .set('Authorization', `Bearer ${customer.token}`)
      .expect(403);
    const operator = await loginAs(app, prisma, ['ORDERS_OPERATOR']);
    await api()
      .get('/v1/manage/inventory')
      .set('Authorization', `Bearer ${operator.token}`)
      .expect(200);
  });

  it('lista por stock ascendente y marca agotados y stock bajo', async () => {
    const manager = await loginAs(app, prisma, ['CATALOG_MANAGER']);
    const res = await api()
      .get('/v1/manage/inventory')
      .set('Authorization', `Bearer ${manager.token}`)
      .expect(200);
    expect(
      res.body.items.map((i: { sku: string; status: string }) => [
        i.sku,
        i.status,
      ]),
    ).toEqual([
      ['CRO-3', 'out'],
      ['CRO-15', 'low'],
      ['ARE-10', 'in'],
    ]);
  });

  it('filtra por estado, búsqueda, categoría e inactivos', async () => {
    const manager = await loginAs(app, prisma, ['CATALOG_MANAGER']);
    const get = async (qs: string) =>
      (
        await api()
          .get(`/v1/manage/inventory?${qs}`)
          .set('Authorization', `Bearer ${manager.token}`)
          .expect(200)
      ).body;

    expect((await get('status=out')).total).toBe(1);
    expect((await get('status=low&lowThreshold=2')).total).toBe(0);
    expect((await get('q=are-10')).items[0].sku).toBe('ARE-10');
    expect((await get('q=croq')).total).toBe(2);
    expect((await get('category=gatos')).total).toBe(1);
    expect((await get('category=gatos&includeInactive=true')).total).toBe(2);
  });

  it('resume unidades, valor y animales disponibles', async () => {
    const manager = await loginAs(app, prisma, ['CATALOG_MANAGER']);
    const res = await api()
      .get('/v1/manage/inventory/summary')
      .set('Authorization', `Bearer ${manager.token}`)
      .expect(200);
    expect(res.body).toEqual({
      lowThreshold: 5,
      variants: 3,
      units: 43,
      outOfStock: 1,
      lowStock: 1,
      valueUsdCents: 3 * 5000 + 40 * 800,
      animalsForSale: 0,
      animalsForAdoption: 1,
    });
  });
});
