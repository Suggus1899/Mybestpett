import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, loginAs, resetDb } from './helpers.js';

// Puntos: 1 por dólar pagado en productos al entregar; 100 puntos = 1 $ al
// comprar. Se devuelven al cancelar y se ajustan al reembolsar.
describe('Puntos por compra (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let customer: { id: string; token: string };
  let operator: { id: string; token: string };
  let admin: { id: string; token: string };
  let collar: string;
  let zoneId: string;
  let methodId: string;
  let addressId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
  });
  afterAll(async () => {
    await resetDb(prisma);
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(prisma);
    const category = await prisma.category.create({
      data: { name: 'Perros', slug: 'perros' },
    });
    const product = await prisma.product.create({
      data: {
        name: 'Collar',
        slug: 'collar',
        description: '-',
        categoryId: category.id,
        variants: {
          create: { sku: 'COL-1', name: 'M', priceUsdCents: 1050, stock: 20 },
        },
      },
      include: { variants: true },
    });
    collar = product.variants[0].id;
    zoneId = (
      await prisma.shippingZone.create({
        data: {
          name: 'Caracas',
          states: ['Distrito Capital'],
          carrier: 'Delivery',
          priceUsdCents: 300,
        },
      })
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
    customer = await loginAs(app, prisma, []);
    operator = await loginAs(app, prisma, ['ORDERS_OPERATOR']);
    admin = await loginAs(app, prisma, ['ADMIN']);
    addressId = (
      await api()
        .post('/v1/addresses')
        .set(auth(customer.token))
        .send({
          recipientName: 'Ana Pérez',
          phone: '0412-1234567',
          state: 'Distrito Capital',
          city: 'Caracas',
          line1: 'Av. Urdaneta, edificio Sol',
        })
        .expect(201)
    ).body.id;
  });

  const balance = async (token = customer.token) =>
    (await api().get('/v1/points').set(auth(token)).expect(200)).body
      .balance as number;
  const give = (points: number, token = admin.token, userId = customer.id) =>
    api()
      .post(`/v1/manage/users/${userId}/points`)
      .set(auth(token))
      .send({ delta: points, note: 'Bienvenida de prueba' });
  async function buy(quantity: number, points?: number) {
    await api()
      .post('/v1/cart/items')
      .set(auth(customer.token))
      .send({ variantId: collar, quantity })
      .expect(201);
    return api()
      .post('/v1/orders')
      .set(auth(customer.token))
      .send({
        addressId,
        shippingZoneId: zoneId,
        paymentMethodId: methodId,
        acceptTerms: true,
        points,
      });
  }
  async function deliver(orderId: string) {
    await prisma.order.update({
      where: { id: orderId },
      data: { status: 'SHIPPED', paidAt: new Date() },
    });
    return api()
      .post(`/v1/manage/orders/${orderId}/status`)
      .set(auth(operator.token))
      .send({ status: 'DELIVERED' });
  }

  it('sin compras el saldo es 0 y pide sesión', async () => {
    await api().get('/v1/points').expect(401);
    const res = await api()
      .get('/v1/points')
      .set(auth(customer.token))
      .expect(200);
    expect(res.body).toMatchObject({
      balance: 0,
      valueUsdCents: 0,
      items: [],
      total: 0,
    });
  });

  it('gana 1 punto por dólar pagado en productos al entregar, una sola vez', async () => {
    const { body: order } = await buy(3); // 31,50 $ → 31 puntos (el envío no cuenta)
    expect(await balance()).toBe(0); // todavía no se entregó
    expect((await deliver(order.id)).status).toBe(201);
    expect(await balance()).toBe(31);
    const again = await api()
      .post(`/v1/manage/orders/${order.id}/status`)
      .set(auth(operator.token))
      .send({ status: 'DELIVERED' });
    expect(again.status).toBe(409);
    expect(await balance()).toBe(31);
    const mine = await api()
      .get(`/v1/orders/${order.id}`)
      .set(auth(customer.token))
      .expect(200);
    expect(mine.body.pointsEarned).toBe(31);
    const history = await api()
      .get('/v1/points')
      .set(auth(customer.token))
      .expect(200);
    expect(history.body.items[0]).toMatchObject({
      delta: 31,
      reason: 'EARNED',
      order: { number: order.number },
    });
  });

  it('canjea puntos de 100 en 100 sobre los productos y no gana por lo pagado con puntos', async () => {
    await give(500).expect(201);
    const res = await buy(3, 300); // 31,50 $ − 3 $ = 28,50 $
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      pointsRedeemed: 300,
      pointsDiscountUsdCents: 300,
      shippingUsdCents: 0,
      totalUsdCents: 2850,
      totalCharged: '28.5',
    });
    expect(await balance()).toBe(200);
    await deliver(res.body.id);
    expect(await balance()).toBe(228); // 200 + 28
  });

  it('el envío gratis se mide después de los puntos', async () => {
    await give(1000).expect(201);
    const res = await buy(3, 700); // 31,50 − 7 = 24,50 $ < 25 $
    expect(res.body).toMatchObject({
      shippingUsdCents: 300,
      totalUsdCents: 2750,
    });
  });

  it('rechaza canjes inválidos sin crear el pedido', async () => {
    await give(300).expect(201);
    const cases: [number, RegExp][] = [
      [150, /de 100 en 100/],
      [-100, /.+/],
      [400, /Tienes 300 puntos/],
    ];
    for (const [points, message] of cases) {
      const res = await buy(1, points);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toMatch(message);
      await api().delete('/v1/cart').set(auth(customer.token)).expect(200);
    }
    // 10,50 $ de productos: como máximo 1000 puntos.
    await give(2000).expect(201);
    const tooMany = await buy(1, 1100);
    expect(tooMany.status).toBe(400);
    expect(tooMany.body.message).toBe(
      'En este pedido puedes usar como máximo 1000 puntos',
    );
    expect(await prisma.order.count()).toBe(0);
    expect(await balance()).toBe(2300);
  });

  it('al cancelar el pedido los puntos vuelven', async () => {
    await give(500).expect(201);
    const { body: order } = await buy(2, 500);
    expect(await balance()).toBe(0);
    await api()
      .post(`/v1/orders/${order.id}/cancel`)
      .set(auth(customer.token))
      .expect(201);
    expect(await balance()).toBe(500);
    const history = await api()
      .get('/v1/points')
      .set(auth(customer.token))
      .expect(200);
    expect(history.body.items.map((e: { reason: string }) => e.reason)).toEqual(
      ['RESTORED', 'REDEEMED', 'ADJUSTED'],
    );
  });

  it('al reembolsar devuelve la parte canjeada y quita la parte ganada', async () => {
    await give(400).expect(201);
    const { body: order } = await buy(4, 400); // 42 $ − 4 $ = 38 $
    await deliver(order.id); // gana 38
    expect(await balance()).toBe(38);
    const item = order.items[0].id;
    const ret = await api()
      .post(`/v1/orders/${order.id}/returns`)
      .set(auth(customer.token))
      .send({
        reason: 'Dos collares no le quedaron',
        items: [{ orderItemId: item, quantity: 2 }],
      })
      .expect(201);
    expect(
      ret.body.refundUsdCents ??
        (await prisma.returnRequest.findFirstOrThrow()).refundUsdCents,
    ).toBe(1900);
    const returnId = (await prisma.returnRequest.findFirstOrThrow()).id;
    await api()
      .post(`/v1/manage/returns/${returnId}/approve`)
      .set(auth(operator.token))
      .send({})
      .expect(201);
    await api()
      .post(`/v1/manage/returns/${returnId}/refund`)
      .set(auth(admin.token))
      .send({ reference: 'ZELLE-123', restock: true })
      .expect(201);
    // Mitad del pedido: vuelven 200 canjeados y se quitan 19 ganados.
    expect(await balance()).toBe(38 + 200 - 19);
  });

  it('solo el administrador ajusta, con motivo, sin dejar el saldo en negativo', async () => {
    await give(100, operator.token).expect(403);
    await give(100, customer.token).expect(403);
    const zero = await give(0);
    expect(zero.status).toBe(400);
    expect(JSON.stringify(zero.body)).toMatch(/no puede ser 0/);
    await api()
      .post(`/v1/manage/users/${customer.id}/points`)
      .set(auth(admin.token))
      .send({ delta: 100, note: 'x' })
      .expect(400);
    expect((await give(250)).body).toEqual({ balance: 250 });
    const negative = await give(-300);
    expect(negative.status).toBe(400);
    expect(negative.body.message).toBe(
      'El saldo quedaría en negativo: tiene 250 puntos',
    );
    expect((await give(-250)).body).toEqual({ balance: 0 });
    await give(10, admin.token, '00000000-0000-4000-8000-000000000000').expect(
      404,
    );
    await api()
      .get('/v1/manage/users/no-es-uuid/points')
      .set(auth(admin.token))
      .expect(400);
    const list = await api()
      .get(`/v1/manage/users/${customer.id}/points`)
      .set(auth(admin.token))
      .expect(200);
    expect(list.body).toMatchObject({ balance: 0, total: 2 });
    expect(
      await prisma.auditLog.count({ where: { action: 'points.adjusted' } }),
    ).toBe(2);
  });
});
