import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { OrderStatus } from '../src/generated/prisma/enums.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, loginAs, resetDb } from './helpers.js';

// Reseñas (solo de quien compró y recibió el producto), moderación del
// equipo, valoración en el catálogo y recomendaciones.
describe('Reseñas y recomendaciones (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let categoryId: string;
  let otherCategoryId: string;
  let methodId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await resetDb(prisma);
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    categoryId = (
      await prisma.category.create({ data: { name: 'Perros', slug: 'perros' } })
    ).id;
    otherCategoryId = (
      await prisma.category.create({ data: { name: 'Gatos', slug: 'gatos' } })
    ).id;
    methodId = (
      await prisma.paymentMethod.create({
        data: {
          code: 'ZELLE',
          name: 'Zelle',
          currency: 'USD',
          instructions: '-',
        },
      })
    ).id;
  });

  async function product(
    slug: string,
    opts: { stock?: number; active?: boolean; category?: string } = {},
  ) {
    const p = await prisma.product.create({
      data: {
        name: slug,
        slug,
        description: '-',
        categoryId: opts.category ?? categoryId,
        isActive: opts.active ?? true,
        variants: {
          create: {
            sku: slug.toUpperCase(),
            name: 'U',
            priceUsdCents: 1000,
            stock: opts.stock ?? 5,
          },
        },
      },
      include: { variants: true },
    });
    return { id: p.id, slug, variantId: p.variants[0].id };
  }

  // Pedido con los productos dados, en el estado indicado.
  async function order(
    userId: string,
    items: { variantId: string; slug: string }[],
    status: OrderStatus = 'DELIVERED',
  ) {
    await prisma.order.create({
      data: {
        userId,
        status,
        paymentMethodId: methodId,
        chargedCurrency: 'USD',
        subtotalUsdCents: 1000,
        shippingUsdCents: 0,
        totalUsdCents: 1000,
        totalCharged: '10.00',
        recipientName: 'Ana',
        phone: '0412-1234567',
        state: 'Miranda',
        city: 'Los Teques',
        line1: 'Calle 1',
        shippingZoneName: 'Caracas',
        carrier: 'Delivery',
        paymentDueAt: new Date(),
        termsAcceptedAt: new Date(),
        deliveredAt: status === 'DELIVERED' ? new Date() : null,
        items: {
          create: items.map((i) => ({
            variantId: i.variantId,
            productName: i.slug,
            productSlug: i.slug,
            variantName: 'U',
            sku: i.slug.toUpperCase(),
            unitPriceUsdCents: 1000,
            quantity: 1,
            isReturnable: true,
          })),
        },
      },
    });
  }

  const review = {
    rating: 5,
    title: 'Excelente',
    body: 'A mi perro le encantó, muy resistente.',
  };
  const put = (slug: string, token: string, body: object = review) =>
    api().put(`/v1/products/${slug}/reviews/mine`).set(auth(token)).send(body);

  describe('quién puede reseñar', () => {
    it('quien recibió el producto reseña; la reseña es pública con nombre corto', async () => {
      const collar = await product('collar');
      const buyer = await loginAs(app, prisma, []);
      await prisma.user.update({
        where: { id: buyer.id },
        data: { firstName: 'Ana', lastName: 'pérez' },
      });
      await order(buyer.id, [collar]);
      const mine = await api()
        .get('/v1/products/collar/reviews/mine')
        .set(auth(buyer.token))
        .expect(200);
      expect(mine.body).toEqual({ canReview: true, review: null });

      const { body } = await put('collar', buyer.token).expect(200);
      expect(body.review).toMatchObject({
        rating: 5,
        title: 'Excelente',
        status: 'VISIBLE',
      });

      const list = await api().get('/v1/products/collar/reviews').expect(200);
      expect(list.body.total).toBe(1);
      expect(list.body.items[0]).toMatchObject({
        author: 'Ana P.',
        rating: 5,
        verifiedPurchase: true,
      });
      expect(list.body.items[0].user).toBeUndefined();
      expect(JSON.stringify(list.body)).not.toContain('@test.com');
    });

    it('no reseña quien no compró, ni con el pedido sin entregar o reembolsado', async () => {
      const collar = await product('collar');
      const stranger = await loginAs(app, prisma, []);
      await put('collar', stranger.token).expect(403);
      for (const status of [
        'PENDING_PAYMENT',
        'PAID',
        'SHIPPED',
        'CANCELLED',
        'REFUNDED',
      ] as const) {
        const user = await loginAs(app, prisma, []);
        await order(user.id, [collar], status);
        const res = await put('collar', user.token).expect(403);
        expect(res.body.message).toMatch(/compraste y ya recibiste/);
      }
      const mine = await api()
        .get('/v1/products/collar/reviews/mine')
        .set(auth(stranger.token))
        .expect(200);
      expect(mine.body.canReview).toBe(false);
      await api()
        .put('/v1/products/collar/reviews/mine')
        .send(review)
        .expect(401);
    });

    it('una reseña por persona: volver a enviar la edita', async () => {
      const collar = await product('collar');
      const buyer = await loginAs(app, prisma, []);
      await order(buyer.id, [collar]);
      await order(buyer.id, [collar]);
      await put('collar', buyer.token).expect(200);
      await put('collar', buyer.token, {
        rating: 3,
        body: 'Cambié de opinión, se gastó rápido.',
      }).expect(200);
      const rows = await prisma.productReview.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ rating: 3, title: null });
    });

    it('valida estrellas, título y texto', async () => {
      const collar = await product('collar');
      const buyer = await loginAs(app, prisma, []);
      await order(buyer.id, [collar]);
      for (const body of [
        { ...review, rating: 0 },
        { ...review, rating: 6 },
        { ...review, rating: 4.5 },
        { ...review, rating: '5' },
        { ...review, body: 'corto' },
        { ...review, body: 'x'.repeat(1001) },
        { ...review, title: 'x'.repeat(81) },
        { rating: 5 },
      ]) {
        await put('collar', buyer.token, body).expect(400);
      }
      await put('no-existe', buyer.token).expect(404);
      await put('NO VALIDO', buyer.token).expect(400);
    });

    it('borra la propia y luego no hay nada que borrar', async () => {
      const collar = await product('collar');
      const buyer = await loginAs(app, prisma, []);
      await order(buyer.id, [collar]);
      await put('collar', buyer.token).expect(200);
      await api()
        .delete('/v1/products/collar/reviews/mine')
        .set(auth(buyer.token))
        .expect(204);
      await api()
        .delete('/v1/products/collar/reviews/mine')
        .set(auth(buyer.token))
        .expect(404);
    });
  });

  describe('resumen y orden', () => {
    it('calcula promedio y distribución, y ordena por estrellas', async () => {
      const collar = await product('collar');
      for (const rating of [5, 4, 4, 1]) {
        const user = await loginAs(app, prisma, []);
        await order(user.id, [collar]);
        await put('collar', user.token, { ...review, rating }).expect(200);
      }
      const { body } = await api()
        .get('/v1/products/collar/reviews?sort=worst')
        .expect(200);
      expect(body.summary).toEqual({
        count: 4,
        average: 3.5,
        distribution: [1, 0, 0, 2, 1],
      });
      expect(body.items.map((r: { rating: number }) => r.rating)).toEqual([
        1, 4, 4, 5,
      ]);
      const best = await api()
        .get('/v1/products/collar/reviews?sort=best')
        .expect(200);
      expect(best.body.items[0].rating).toBe(5);
      await api().get('/v1/products/collar/reviews?sort=otro').expect(400);

      const detail = await api().get('/v1/products/collar').expect(200);
      expect(detail.body.rating).toEqual({ average: 3.5, count: 4 });
      const cards = await api().get('/v1/products').expect(200);
      expect(cards.body.items[0].rating).toEqual({ average: 3.5, count: 4 });
    });

    it('sin reseñas, el promedio es null', async () => {
      await product('collar');
      const { body } = await api()
        .get('/v1/products/collar/reviews')
        .expect(200);
      expect(body.summary).toEqual({
        count: 0,
        average: null,
        distribution: [0, 0, 0, 0, 0],
      });
      const detail = await api().get('/v1/products/collar').expect(200);
      expect(detail.body.rating).toEqual({ average: null, count: 0 });
    });
  });

  describe('moderación', () => {
    it('el gestor oculta con motivo; deja de contar y el autor ve por qué', async () => {
      const collar = await product('collar');
      const buyer = await loginAs(app, prisma, []);
      await order(buyer.id, [collar]);
      await put('collar', buyer.token).expect(200);
      const [row] = await prisma.productReview.findMany();
      const manager = await loginAs(app, prisma, ['CATALOG_MANAGER']);

      await api()
        .patch(`/v1/manage/reviews/${row.id}`)
        .set(auth(buyer.token))
        .send({ status: 'HIDDEN', reason: 'Spam' })
        .expect(403);
      await api()
        .patch(`/v1/manage/reviews/${row.id}`)
        .set(auth(manager.token))
        .send({ status: 'HIDDEN' })
        .expect(400);
      await api()
        .patch(`/v1/manage/reviews/${row.id}`)
        .set(auth(manager.token))
        .send({ status: 'HIDDEN', reason: 'Incluye un teléfono personal' })
        .expect(200);

      const list = await api().get('/v1/products/collar/reviews').expect(200);
      expect(list.body.total).toBe(0);
      expect(list.body.summary.count).toBe(0);
      const mine = await api()
        .get('/v1/products/collar/reviews/mine')
        .set(auth(buyer.token))
        .expect(200);
      expect(mine.body.review).toMatchObject({
        status: 'HIDDEN',
        hiddenReason: 'Incluye un teléfono personal',
      });
      // Editarla no la vuelve a mostrar.
      await put('collar', buyer.token).expect(200);
      expect(
        (
          await prisma.productReview.findUniqueOrThrow({
            where: { id: row.id },
          })
        ).status,
      ).toBe('HIDDEN');

      await api()
        .patch(`/v1/manage/reviews/${row.id}`)
        .set(auth(manager.token))
        .send({ status: 'HIDDEN', reason: 'Otra vez' })
        .expect(409);
      await api()
        .patch(`/v1/manage/reviews/${row.id}`)
        .set(auth(manager.token))
        .send({ status: 'VISIBLE' })
        .expect(200);
      expect(
        (await api().get('/v1/products/collar/reviews').expect(200)).body.total,
      ).toBe(1);
      expect(await prisma.auditLog.count({ where: { entityId: row.id } })).toBe(
        2,
      );
    });

    it('lista con filtros y valida ids', async () => {
      const collar = await product('collar');
      for (const rating of [1, 5]) {
        const user = await loginAs(app, prisma, []);
        await order(user.id, [collar]);
        await put('collar', user.token, { ...review, rating }).expect(200);
      }
      const manager = await loginAs(app, prisma, ['CATALOG_MANAGER']);
      const low = await api()
        .get('/v1/manage/reviews?rating=1')
        .set(auth(manager.token))
        .expect(200);
      expect(low.body.total).toBe(1);
      expect(low.body.items[0].user.email).toMatch(/@test\.com$/);
      expect(low.body.items[0].product.slug).toBe('collar');
      const hidden = await api()
        .get('/v1/manage/reviews?status=HIDDEN')
        .set(auth(manager.token))
        .expect(200);
      expect(hidden.body.total).toBe(0);
      await api()
        .get('/v1/manage/reviews?rating=9')
        .set(auth(manager.token))
        .expect(400);
      await api()
        .patch('/v1/manage/reviews/no-uuid')
        .set(auth(manager.token))
        .send({ status: 'VISIBLE' })
        .expect(400);
      await api()
        .patch('/v1/manage/reviews/00000000-0000-4000-8000-000000000000')
        .set(auth(manager.token))
        .send({ status: 'VISIBLE' })
        .expect(404);
    });
  });

  describe('recomendaciones', () => {
    it('prioriza lo comprado junto, luego lo más vendido de la categoría', async () => {
      const collar = await product('collar');
      const correa = await product('correa');
      const placa = await product('placa');
      const cama = await product('cama');
      const gato = await product('rascador', { category: otherCategoryId });
      const buyer = await loginAs(app, prisma, []);
      await order(buyer.id, [collar, correa]);
      await order(buyer.id, [collar, correa]);
      await order(buyer.id, [collar, gato]); // otra categoría, pero comprado junto
      await order(buyer.id, [placa, cama]);
      await order(buyer.id, [placa]);
      // Un pedido cancelado no cuenta.
      await order(buyer.id, [collar, cama], 'CANCELLED');
      await order(buyer.id, [collar, cama], 'CANCELLED');
      await order(buyer.id, [collar, cama], 'CANCELLED');

      const { body } = await api()
        .get('/v1/products/collar/recommendations')
        .expect(200);
      expect(body.map((p: { slug: string }) => p.slug)).toEqual([
        'correa',
        'rascador',
        'placa',
        'cama',
      ]);
      expect(body[0]).toMatchObject({
        inStock: true,
        rating: { average: null, count: 0 },
      });
    });

    it('no recomienda productos inactivos, agotados ni el mismo', async () => {
      await product('collar');
      await product('agotado', { stock: 0 });
      await product('retirado', { active: false });
      await product('correa');
      const { body } = await api()
        .get('/v1/products/collar/recommendations')
        .expect(200);
      expect(body.map((p: { slug: string }) => p.slug)).toEqual(['correa']);
      await api().get('/v1/products/no-existe/recommendations').expect(404);
      await api().get('/v1/products/retirado/recommendations').expect(404);
    });
  });
});
