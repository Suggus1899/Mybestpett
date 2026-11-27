import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { OrdersService } from '../src/orders/orders.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { SubscriptionsService } from '../src/subscriptions/subscriptions.service.js';
import { createTestApp, loginAs, resetDb } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;

// Suscripción de alimento: entrega recurrente que crea un pedido cada N días.
describe('Suscripciones de entrega recurrente (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let service: SubscriptionsService;
  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let customer: { id: string; token: string };
  let variant: { food: string; toy: string };
  let zone: { caracas: string; zulia: string };
  let methodId: string;
  let addressId: string;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    service = app.get(SubscriptionsService);
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
    const food = await prisma.product.create({
      data: {
        name: 'Croquetas',
        slug: 'croquetas',
        description: '-',
        categoryId: category.id,
        isReturnable: false,
        subscribable: true,
        variants: {
          create: {
            sku: 'CRO-1',
            name: '15 kg',
            priceUsdCents: 3000,
            stock: 5,
          },
        },
      },
      include: { variants: true },
    });
    const toy = await prisma.product.create({
      data: {
        name: 'Pelota',
        slug: 'pelota',
        description: '-',
        categoryId: category.id,
        variants: {
          create: { sku: 'PEL-1', name: 'M', priceUsdCents: 500, stock: 9 },
        },
      },
      include: { variants: true },
    });
    variant = { food: food.variants[0].id, toy: toy.variants[0].id };
    const caracas = await prisma.shippingZone.create({
      data: {
        name: 'Caracas',
        states: ['Distrito Capital'],
        carrier: 'Delivery',
        priceUsdCents: 300,
      },
    });
    const zulia = await prisma.shippingZone.create({
      data: {
        name: 'Zulia',
        states: ['Zulia'],
        carrier: 'Encomienda',
        priceUsdCents: 600,
      },
    });
    zone = { caracas: caracas.id, zulia: zulia.id };
    methodId = (
      await prisma.paymentMethod.create({
        data: {
          code: 'ZELLE',
          name: 'Zelle',
          currency: 'USD',
          instructions: 'zelle@petbf.test',
        },
      })
    ).id;
    customer = await loginAs(app, prisma, []);
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

  const body = (overrides: object = {}) => ({
    variantId: variant.food,
    quantity: 2,
    intervalDays: 30,
    addressId,
    shippingZoneId: zone.caracas,
    paymentMethodId: methodId,
    ...overrides,
  });
  const subscribe = (overrides: object = {}, token = customer.token) =>
    api().post('/v1/subscriptions').set(auth(token)).send(body(overrides));
  const stock = async (id: string) =>
    (await prisma.productVariant.findUniqueOrThrow({ where: { id } })).stock;
  const makeDue = (id: string, ago = 1000) =>
    prisma.subscription.update({
      where: { id },
      data: { nextRunAt: new Date(Date.now() - ago) },
    });

  it('crea la suscripción y su primer pedido en el acto', async () => {
    const res = await subscribe().expect(201);
    expect(res.body).toMatchObject({
      quantity: 2,
      intervalDays: 30,
      status: 'ACTIVE',
      variant: { sku: 'CRO-1' },
      orders: [{ status: 'PENDING_PAYMENT', totalUsdCents: 6000 }],
    });
    const due = new Date(res.body.nextRunAt).getTime() - Date.now();
    expect(due).toBeGreaterThan(29 * DAY);
    expect(due).toBeLessThanOrEqual(30 * DAY);
    expect(await stock(variant.food)).toBe(3);
    const order = await prisma.order.findFirstOrThrow();
    expect(order.subscriptionId).toBe(res.body.id);
    // Se le da un día para pagar, no 2 horas.
    expect(order.paymentDueAt.getTime() - Date.now()).toBeGreaterThan(
      23 * 60 * 60 * 1000,
    );
    const email = await prisma.emailOutbox.findFirstOrThrow({
      where: { kind: 'order.pending_payment' },
    });
    expect(email.subject).toMatch(
      /^Tu entrega recurrente de Croquetas: pedido PB-/,
    );
    expect(
      await prisma.auditLog.count({
        where: { action: 'subscription.created' },
      }),
    ).toBe(1);
  });

  it('valida los datos y que el producto admita entrega recurrente', async () => {
    await api().post('/v1/subscriptions').send(body()).expect(401);
    const cases: [object, RegExp][] = [
      [{ quantity: 0 }, /cantidad mínima/],
      [{ quantity: 11 }, /cantidad máxima/],
      [{ quantity: 1.5 }, /entero/],
      [{ intervalDays: 6 }, /Mínimo cada 7 días/],
      [{ intervalDays: 91 }, /Máximo cada 90 días/],
      [{ variantId: 'x' }, /Id inválido/],
      [{ variantId: variant.toy }, /no se ofrece con entrega recurrente/],
      [{ shippingZoneId: zone.zulia }, /no llega a Distrito Capital/],
      [
        { paymentMethodId: '00000000-0000-4000-8000-000000000000' },
        /Método de pago no disponible/,
      ],
    ];
    for (const [overrides, message] of cases) {
      const res = await subscribe(overrides).expect(400);
      expect(JSON.stringify(res.body)).toMatch(message);
    }
    await subscribe({
      addressId: '00000000-0000-4000-8000-000000000000',
    }).expect(404);
    // Nada quedó a medias.
    expect(await prisma.subscription.count()).toBe(0);
    expect(await prisma.order.count()).toBe(0);
    expect(await stock(variant.food)).toBe(5);
  });

  it('sin stock para el primer pedido no se crea nada', async () => {
    const res = await subscribe({ quantity: 6 });
    expect(res.status).toBe(409);
    expect(await prisma.subscription.count()).toBe(0);
  });

  it('una sola suscripción abierta por producto; tras cancelar se puede otra', async () => {
    const first = await subscribe().expect(201);
    await subscribe().expect(409);
    await api()
      .post(`/v1/subscriptions/${first.body.id}/cancel`)
      .set(auth(customer.token))
      .expect(201);
    await subscribe().expect(201);
  });

  it('crea el pedido cuando toca, una sola vez aunque corran dos procesos', async () => {
    const { body: sub } = await subscribe().expect(201);
    expect(await service.runDue()).toBe(0); // todavía no toca
    await makeDue(sub.id);
    const [a, b] = await Promise.all([service.runDue(), service.runDue()]);
    expect(a + b).toBe(1);
    expect(
      await prisma.order.count({ where: { subscriptionId: sub.id } }),
    ).toBe(2);
    expect(await stock(variant.food)).toBe(1);
    const after = await prisma.subscription.findUniqueOrThrow({
      where: { id: sub.id },
    });
    expect(after.nextRunAt.getTime()).toBeGreaterThan(Date.now() + 29 * DAY);
    expect(after.failures).toBe(0);
    expect(await service.runDue()).toBe(0);
  });

  it('usa el precio de ese día', async () => {
    const { body: sub } = await subscribe({ quantity: 1 }).expect(201);
    await prisma.productVariant.update({
      where: { id: variant.food },
      data: { priceUsdCents: 3500 },
    });
    await makeDue(sub.id);
    await service.runDue();
    const orders = await prisma.order.findMany({
      orderBy: { createdAt: 'asc' },
    });
    expect(orders.map((o) => o.subtotalUsdCents)).toEqual([3000, 3500]);
  });

  it('pausada o cancelada no genera pedidos; al reanudar toca pronto', async () => {
    const { body: sub } = await subscribe({ quantity: 1 }).expect(201);
    await api()
      .post(`/v1/subscriptions/${sub.id}/resume`)
      .set(auth(customer.token))
      .expect(409);
    const paused = await api()
      .post(`/v1/subscriptions/${sub.id}/pause`)
      .set(auth(customer.token))
      .expect(201);
    expect(paused.body.status).toBe('PAUSED');
    await api()
      .post(`/v1/subscriptions/${sub.id}/pause`)
      .set(auth(customer.token))
      .expect(409);
    await makeDue(sub.id);
    expect(await service.runDue()).toBe(0);
    const resumed = await api()
      .post(`/v1/subscriptions/${sub.id}/resume`)
      .set(auth(customer.token))
      .expect(201);
    expect(resumed.body.status).toBe('ACTIVE');
    const next = new Date(resumed.body.nextRunAt).getTime() - Date.now();
    expect(next).toBeLessThanOrEqual(DAY);
    await api()
      .post(`/v1/subscriptions/${sub.id}/cancel`)
      .set(auth(customer.token))
      .expect(201);
    await api()
      .post(`/v1/subscriptions/${sub.id}/cancel`)
      .set(auth(customer.token))
      .expect(409);
    await api()
      .patch(`/v1/subscriptions/${sub.id}`)
      .set(auth(customer.token))
      .send({ quantity: 3 })
      .expect(409);
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { nextRunAt: new Date(Date.now() - 1000) },
    });
    expect(await service.runDue()).toBe(0);
  });

  it('cambia cantidad, días, dirección y método con sus validaciones', async () => {
    const { body: sub } = await subscribe({ quantity: 1 }).expect(201);
    const patch = (b: object, token = customer.token) =>
      api().patch(`/v1/subscriptions/${sub.id}`).set(auth(token)).send(b);
    await patch({}).expect(400);
    await patch({ quantity: 11 }).expect(400);
    await patch({ shippingZoneId: zone.zulia }).expect(400);
    await patch({
      paymentMethodId: '00000000-0000-4000-8000-000000000000',
    }).expect(400);
    const res = await patch({ quantity: 3, intervalDays: 14 }).expect(200);
    expect(res.body).toMatchObject({ quantity: 3, intervalDays: 14 });
    await makeDue(sub.id);
    await service.runDue();
    const last = await prisma.order.findFirstOrThrow({
      orderBy: { createdAt: 'desc' },
    });
    expect(last.subtotalUsdCents).toBe(9000);
    const next = (
      await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })
    ).nextRunAt;
    expect(next.getTime()).toBeLessThanOrEqual(Date.now() + 14 * DAY);
  });

  it('solo la persona dueña la ve y la modifica', async () => {
    const { body: sub } = await subscribe().expect(201);
    const other = await loginAs(app, prisma, []);
    await api()
      .get(`/v1/subscriptions/${sub.id}`)
      .set(auth(other.token))
      .expect(404);
    await api()
      .post(`/v1/subscriptions/${sub.id}/cancel`)
      .set(auth(other.token))
      .expect(404);
    await api()
      .patch(`/v1/subscriptions/${sub.id}`)
      .set(auth(other.token))
      .send({ quantity: 1 })
      .expect(404);
    const mine = await api()
      .get('/v1/subscriptions')
      .set(auth(customer.token))
      .expect(200);
    expect(mine.body.total).toBe(1);
    expect(
      (await api().get('/v1/subscriptions').set(auth(other.token)).expect(200))
        .body.total,
    ).toBe(0);
    await api()
      .get('/v1/subscriptions/no-es-uuid')
      .set(auth(customer.token))
      .expect(400);
  });

  it('si no hay stock reintenta al día siguiente y a la tercera se pausa y avisa', async () => {
    const { body: sub } = await subscribe({ quantity: 2 }).expect(201);
    await prisma.productVariant.update({
      where: { id: variant.food },
      data: { stock: 0 },
    });
    for (let attempt = 1; attempt <= 3; attempt++) {
      await makeDue(sub.id);
      expect(await service.runDue()).toBe(0);
      const row = await prisma.subscription.findUniqueOrThrow({
        where: { id: sub.id },
      });
      expect(row.failures).toBe(attempt);
      expect(row.lastError).toMatch(/Revisa tu carrito/);
      if (attempt < 3) {
        expect(row.status).toBe('ACTIVE');
        expect(row.nextRunAt.getTime()).toBeGreaterThan(
          Date.now() + 23 * 60 * 60 * 1000,
        );
      } else {
        expect(row.status).toBe('PAUSED');
      }
    }
    const email = await prisma.emailOutbox.findFirstOrThrow({
      where: { kind: 'subscription.paused' },
    });
    expect(email.subject).toBe('Pausamos tu suscripción de Croquetas');
    expect(email.text).toContain('/cuenta/suscripciones');
    expect(
      await prisma.auditLog.count({
        where: { action: 'subscription.auto_paused' },
      }),
    ).toBe(1);
    expect(await prisma.order.count()).toBe(1); // solo el primero
    // Al reponer el stock y reanudar, vuelve a funcionar.
    await prisma.productVariant.update({
      where: { id: variant.food },
      data: { stock: 9 },
    });
    await api()
      .post(`/v1/subscriptions/${sub.id}/resume`)
      .set(auth(customer.token))
      .expect(201);
    await makeDue(sub.id);
    expect(await service.runDue()).toBe(1);
    expect(
      (await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } }))
        .failures,
    ).toBe(0);
  });

  it('un fallo no frena a las demás suscripciones', async () => {
    const { body: broken } = await subscribe({ quantity: 2 }).expect(201);
    const other = await loginAs(app, prisma, []);
    const otherAddress = (
      await api()
        .post('/v1/addresses')
        .set(auth(other.token))
        .send({
          recipientName: 'Luis',
          phone: '0414-1112233',
          state: 'Distrito Capital',
          city: 'Caracas',
          line1: 'Calle 5',
        })
        .expect(201)
    ).body.id;
    const { body: fine } = await subscribe(
      { quantity: 1, addressId: otherAddress },
      other.token,
    ).expect(201);
    await prisma.address.delete({ where: { id: addressId } });
    await makeDue(broken.id);
    await makeDue(fine.id);
    expect(await service.runDue()).toBe(1);
    const row = await prisma.subscription.findUniqueOrThrow({
      where: { id: broken.id },
    });
    expect(row.failures).toBe(1);
    expect(row.lastError).toBe('La suscripción no tiene dirección de envío');
  });

  it('el pedido de una suscripción sin pagar vence y la suscripción sigue', async () => {
    const { body: sub } = await subscribe({ quantity: 1 }).expect(201);
    await prisma.order.updateMany({
      data: { paymentDueAt: new Date(Date.now() - 1000) },
    });
    const cancelled = await app.get(OrdersService).expireOverdue();
    expect(cancelled).toBe(1);
    expect(await stock(variant.food)).toBe(5);
    expect(
      (await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } }))
        .status,
    ).toBe('ACTIVE');
  });
});
