import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { OrderStatus } from '../src/generated/prisma/enums.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, loginAs, resetDb } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;

// Devoluciones: el cliente las pide hasta 3 días después de la entrega, el
// operador las aprueba o rechaza y solo el administrador reembolsa.
describe('Devoluciones y reembolsos (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let customer: { id: string; token: string };
  let operator: { id: string; token: string };
  let admin: { id: string; token: string };
  let methodId: string;
  let variant: { collar: string; food: string };

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
    const collar = await prisma.product.create({
      data: {
        name: 'Collar',
        slug: 'collar',
        description: '-',
        categoryId: category.id,
        variants: {
          create: { sku: 'COL-M', name: 'M', priceUsdCents: 1000, stock: 5 },
        },
      },
      include: { variants: true },
    });
    const food = await prisma.product.create({
      data: {
        name: 'Croquetas',
        slug: 'croquetas',
        description: '-',
        categoryId: category.id,
        isReturnable: false,
        variants: {
          create: { sku: 'CRO-1', name: '1 kg', priceUsdCents: 800, stock: 5 },
        },
      },
      include: { variants: true },
    });
    variant = { collar: collar.variants[0].id, food: food.variants[0].id };
    methodId = (
      await prisma.paymentMethod.create({
        data: {
          code: 'PAGO_MOVIL',
          name: 'Pago Móvil',
          currency: 'VES',
          instructions: '-',
        },
      })
    ).id;
    customer = await loginAs(app, prisma, []);
    operator = await loginAs(app, prisma, ['ORDERS_OPERATOR']);
    admin = await loginAs(app, prisma, ['ADMIN']);
  });

  // Pedido de 3 collares y 1 bolsa de croquetas, cobrado en Bs a 245,50.
  async function deliveredOrder(
    opts: {
      userId?: string;
      deliveredAgo?: number;
      status?: OrderStatus;
    } = {},
  ) {
    const deliveredAt = new Date(Date.now() - (opts.deliveredAgo ?? DAY));
    const order = await prisma.order.create({
      data: {
        userId: opts.userId ?? customer.id,
        status: opts.status ?? 'DELIVERED',
        paymentMethodId: methodId,
        chargedCurrency: 'VES',
        usdVesRate: '245.50',
        subtotalUsdCents: 3800,
        shippingUsdCents: 0,
        totalUsdCents: 3800,
        totalCharged: '9329.00',
        recipientName: 'Ana',
        phone: '0412-1234567',
        state: 'Miranda',
        city: 'Los Teques',
        line1: 'Calle 1',
        shippingZoneName: 'Caracas',
        carrier: 'Delivery propio',
        paymentDueAt: new Date(),
        termsAcceptedAt: new Date(),
        paidAt: new Date(),
        deliveredAt:
          opts.status && opts.status !== 'DELIVERED' ? null : deliveredAt,
        items: {
          create: [
            {
              variantId: variant.collar,
              productName: 'Collar',
              productSlug: 'collar',
              variantName: 'M',
              sku: 'COL-M',
              unitPriceUsdCents: 1000,
              quantity: 3,
              isReturnable: true,
            },
            {
              variantId: variant.food,
              productName: 'Croquetas',
              productSlug: 'croquetas',
              variantName: '1 kg',
              sku: 'CRO-1',
              unitPriceUsdCents: 800,
              quantity: 1,
              isReturnable: false,
            },
          ],
        },
      },
      include: { items: true },
    });
    const item = (sku: string) => order.items.find((i) => i.sku === sku)!.id;
    return { id: order.id, collar: item('COL-M'), food: item('CRO-1') };
  }

  const ask = (
    orderId: string,
    items: { orderItemId: string; quantity: number }[],
    token = customer.token,
  ) =>
    api()
      .post(`/v1/orders/${orderId}/returns`)
      .set(auth(token))
      .send({ reason: 'El collar llegó con la hebilla rota', items });

  const stock = async (id: string) =>
    (await prisma.productVariant.findUniqueOrThrow({ where: { id } })).stock;

  describe('solicitud del cliente', () => {
    it('congela el monto en la moneda del pedido sin reembolsar el envío', async () => {
      const order = await deliveredOrder();
      const { body } = await ask(order.id, [
        { orderItemId: order.collar, quantity: 2 },
      ]).expect(201);
      expect(body.returns).toHaveLength(1);
      expect(body.returns[0]).toMatchObject({
        status: 'REQUESTED',
        refundUsdCents: 2000,
        currency: 'VES',
        refundAmount: '4910',
        items: [{ orderItemId: order.collar, quantity: 2 }],
      });
      expect(new Date(body.returnUntil).getTime()).toBeGreaterThan(Date.now());
    });

    it('exige sesión y responde 404 con el pedido de otra persona', async () => {
      const order = await deliveredOrder();
      await api()
        .post(`/v1/orders/${order.id}/returns`)
        .send({ reason: 'x'.repeat(10), items: [] })
        .expect(401);
      const other = await loginAs(app, prisma, []);
      await ask(
        order.id,
        [{ orderItemId: order.collar, quantity: 1 }],
        other.token,
      ).expect(404);
    });

    it('solo un pedido entregado y dentro de los 3 días', async () => {
      const shipped = await deliveredOrder({ status: 'SHIPPED' });
      const late = await deliveredOrder({ deliveredAgo: 3 * DAY + 60_000 });
      const almost = await deliveredOrder({ deliveredAgo: 3 * DAY - 60_000 });
      const notYet = await ask(shipped.id, [
        { orderItemId: shipped.collar, quantity: 1 },
      ]).expect(409);
      expect(notYet.body.message).toMatch(/entregamos/);
      const expired = await ask(late.id, [
        { orderItemId: late.collar, quantity: 1 },
      ]).expect(409);
      expect(expired.body.message).toMatch(/3 días/);
      await ask(almost.id, [
        { orderItemId: almost.collar, quantity: 1 },
      ]).expect(201);
      const lateView = await api()
        .get(`/v1/orders/${late.id}`)
        .set(auth(customer.token))
        .expect(200);
      expect(new Date(lateView.body.returnUntil).getTime()).toBeLessThan(
        Date.now(),
      );
      const shippedView = await api()
        .get(`/v1/orders/${shipped.id}`)
        .set(auth(customer.token))
        .expect(200);
      expect(shippedView.body.returnUntil).toBeNull();
    });

    it('no acepta alimento ni higiene, productos ajenos ni más de lo comprado', async () => {
      const order = await deliveredOrder();
      const other = await deliveredOrder();
      const food = await ask(order.id, [
        { orderItemId: order.food, quantity: 1 },
      ]).expect(400);
      expect(food.body.message).toMatch(/no admite devolución/);
      await ask(order.id, [{ orderItemId: other.collar, quantity: 1 }]).expect(
        400,
      );
      const many = await ask(order.id, [
        { orderItemId: order.collar, quantity: 4 },
      ]).expect(400);
      expect(many.body.message).toMatch(/como máximo 3/);
      expect(await prisma.returnRequest.count()).toBe(0);
    });

    it('valida motivo, cantidades y líneas repetidas', async () => {
      const order = await deliveredOrder();
      const send = (body: object) =>
        api()
          .post(`/v1/orders/${order.id}/returns`)
          .set(auth(customer.token))
          .send(body);
      const line = { orderItemId: order.collar, quantity: 1 };
      for (const body of [
        { reason: 'corto', items: [line] },
        { reason: 'x'.repeat(501), items: [line] },
        { reason: 'Motivo suficiente', items: [] },
        { reason: 'Motivo suficiente', items: [{ ...line, quantity: 0 }] },
        { reason: 'Motivo suficiente', items: [{ ...line, quantity: 1.5 }] },
        { reason: 'Motivo suficiente', items: [{ ...line, quantity: '1' }] },
        { reason: 'Motivo suficiente', items: [line, line] },
        {
          reason: 'Motivo suficiente',
          items: [{ orderItemId: 'abc', quantity: 1 }],
        },
        { items: [line] },
      ]) {
        await send(body).expect(400);
      }
      await api()
        .post('/v1/orders/no-es-uuid/returns')
        .set(auth(customer.token))
        .send({ reason: 'Motivo suficiente', items: [line] })
        .expect(400);
    });

    it('una devolución abierta a la vez, y lo ya devuelto no se vuelve a pedir', async () => {
      const order = await deliveredOrder();
      await ask(order.id, [{ orderItemId: order.collar, quantity: 2 }]).expect(
        201,
      );
      const twice = await ask(order.id, [
        { orderItemId: order.collar, quantity: 1 },
      ]).expect(409);
      expect(twice.body.message).toMatch(/abierta/);

      // Rechazada, las unidades quedan libres de nuevo.
      const [first] = await prisma.returnRequest.findMany();
      await api()
        .post(`/v1/manage/returns/${first.id}/reject`)
        .set(auth(operator.token))
        .send({ reason: 'Las fotos muestran uso' })
        .expect(201);
      await ask(order.id, [{ orderItemId: order.collar, quantity: 3 }]).expect(
        201,
      );
      const second = await prisma.returnRequest.findFirstOrThrow({
        where: { status: 'REQUESTED' },
      });
      await api()
        .post(`/v1/manage/returns/${second.id}/approve`)
        .set(auth(operator.token))
        .send({})
        .expect(201);
      await api()
        .post(`/v1/manage/returns/${second.id}/refund`)
        .set(auth(admin.token))
        .send({ reference: '123456', restock: false })
        .expect(201);
      // Los 3 collares ya se reembolsaron; las croquetas no se devuelven.
      const none = await ask(order.id, [
        { orderItemId: order.collar, quantity: 1 },
      ]).expect(400);
      expect(none.body.message).toMatch(/otra devolución/);
    });

    it('dos solicitudes a la vez: solo una queda abierta', async () => {
      const order = await deliveredOrder();
      const results = await Promise.all([
        ask(order.id, [{ orderItemId: order.collar, quantity: 1 }]),
        ask(order.id, [{ orderItemId: order.collar, quantity: 1 }]),
      ]);
      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        201, 409,
      ]);
      expect(await prisma.returnRequest.count()).toBe(1);
    });
  });

  describe('revisión y reembolso', () => {
    async function requested(qty = 3) {
      const order = await deliveredOrder();
      await ask(order.id, [
        { orderItemId: order.collar, quantity: qty },
      ]).expect(201);
      const found = await prisma.returnRequest.findFirstOrThrow({
        where: { orderId: order.id },
      });
      return { order, id: found.id };
    }

    it('solo el operador (o ADMIN) ve y revisa; el cliente no', async () => {
      const { id } = await requested();
      await api()
        .get('/v1/manage/returns')
        .set(auth(customer.token))
        .expect(403);
      await api()
        .post(`/v1/manage/returns/${id}/approve`)
        .set(auth(customer.token))
        .send({})
        .expect(403);
      const list = await api()
        .get('/v1/manage/returns')
        .set(auth(operator.token))
        .expect(200);
      expect(list.body.total).toBe(1);
      expect(list.body.items[0].order.code).toMatch(/^PB-/);
      const empty = await api()
        .get('/v1/manage/returns?status=APPROVED')
        .set(auth(admin.token))
        .expect(200);
      expect(empty.body.total).toBe(0);
      await api()
        .get('/v1/manage/returns?status=OTRO')
        .set(auth(admin.token))
        .expect(400);
      await api()
        .get(`/v1/manage/returns/${id}`)
        .set(auth(operator.token))
        .expect(200);
      await api()
        .get('/v1/manage/returns/00000000-0000-4000-8000-000000000000')
        .set(auth(operator.token))
        .expect(404);
    });

    it('rechazar exige motivo y el cliente lo ve', async () => {
      const { order, id } = await requested();
      await api()
        .post(`/v1/manage/returns/${id}/reject`)
        .set(auth(operator.token))
        .send({ reason: 'no' })
        .expect(400);
      await api()
        .post(`/v1/manage/returns/${id}/reject`)
        .set(auth(operator.token))
        .send({ reason: 'El producto tiene señales de uso' })
        .expect(201);
      const mine = await api()
        .get(`/v1/orders/${order.id}`)
        .set(auth(customer.token))
        .expect(200);
      expect(mine.body.returns[0]).toMatchObject({
        status: 'REJECTED',
        decisionNote: 'El producto tiene señales de uso',
      });
      expect(mine.body.returns[0].decidedById).toBeUndefined();
      // Ya revisada, no se vuelve a decidir.
      await api()
        .post(`/v1/manage/returns/${id}/approve`)
        .set(auth(operator.token))
        .send({})
        .expect(409);
    });

    it('el operador aprueba pero no reembolsa; el administrador sí, con auditoría', async () => {
      const { order, id } = await requested();
      // Sin aprobar no se reembolsa.
      await api()
        .post(`/v1/manage/returns/${id}/refund`)
        .set(auth(admin.token))
        .send({ reference: '123456', restock: true })
        .expect(409);
      await api()
        .post(`/v1/manage/returns/${id}/approve`)
        .set(auth(operator.token))
        .send({ note: 'Traer el collar a la tienda' })
        .expect(201);
      await api()
        .post(`/v1/manage/returns/${id}/refund`)
        .set(auth(operator.token))
        .send({ reference: '123456', restock: true })
        .expect(403);
      const before = await stock(variant.collar);
      const { body } = await api()
        .post(`/v1/manage/returns/${id}/refund`)
        .set(auth(admin.token))
        .send({ reference: ' ab 12-34 ', restock: true })
        .expect(201);
      expect(body).toMatchObject({
        status: 'REFUNDED',
        refundReference: 'AB12-34',
        restocked: true,
      });
      expect(await stock(variant.collar)).toBe(before + 3);
      const movement = await prisma.inventoryMovement.findFirstOrThrow({
        where: { reason: 'RETURN' },
      });
      expect(movement).toMatchObject({
        quantityDelta: 3,
        orderId: order.id,
        createdById: admin.id,
      });
      const log = await prisma.auditLog.findFirst({
        where: { action: 'return.refunded', entityId: id },
      });
      expect(log?.actorId).toBe(admin.id);
      // Las croquetas no se devolvieron: el pedido sigue entregado.
      const after = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
      });
      expect(after.status).toBe('DELIVERED');
      // Un segundo reembolso no se registra.
      await api()
        .post(`/v1/manage/returns/${id}/refund`)
        .set(auth(admin.token))
        .send({ reference: '999999', restock: true })
        .expect(409);
      expect(await stock(variant.collar)).toBe(before + 3);
    });

    it('sin reponer, el stock no cambia; si se devuelve todo, el pedido queda reembolsado', async () => {
      // Pedido solo con collares para poder devolverlo entero.
      const order = await deliveredOrder();
      await prisma.orderItem.update({
        where: { id: order.food },
        data: { isReturnable: true },
      });
      await ask(order.id, [
        { orderItemId: order.collar, quantity: 3 },
        { orderItemId: order.food, quantity: 1 },
      ]).expect(201);
      const { id } = await prisma.returnRequest.findFirstOrThrow();
      await api()
        .post(`/v1/manage/returns/${id}/approve`)
        .set(auth(admin.token))
        .send({})
        .expect(201);
      const before = await stock(variant.collar);
      await api()
        .post(`/v1/manage/returns/${id}/refund`)
        .set(auth(admin.token))
        .send({ reference: '7654321', restock: false })
        .expect(201);
      expect(await stock(variant.collar)).toBe(before);
      expect(await prisma.inventoryMovement.count()).toBe(0);
      const mine = await api()
        .get(`/v1/orders/${order.id}`)
        .set(auth(customer.token))
        .expect(200);
      expect(mine.body.status).toBe('REFUNDED');
      expect(mine.body.returnUntil).toBeNull();
      expect(mine.body.history.at(-1)).toMatchObject({ toStatus: 'REFUNDED' });
    });

    it('valida el reembolso', async () => {
      const { id } = await requested();
      await api()
        .post(`/v1/manage/returns/${id}/approve`)
        .set(auth(operator.token))
        .send({})
        .expect(201);
      for (const body of [
        { reference: '12', restock: true },
        { reference: 'ref con *', restock: true },
        { reference: '123456' },
        { reference: '123456', restock: 'sí' },
      ]) {
        await api()
          .post(`/v1/manage/returns/${id}/refund`)
          .set(auth(admin.token))
          .send(body)
          .expect(400);
      }
    });

    it('nadie revisa ni reembolsa la devolución de su propio pedido', async () => {
      const order = await deliveredOrder({ userId: admin.id });
      await ask(
        order.id,
        [{ orderItemId: order.collar, quantity: 1 }],
        admin.token,
      ).expect(201);
      const { id } = await prisma.returnRequest.findFirstOrThrow();
      await api()
        .post(`/v1/manage/returns/${id}/approve`)
        .set(auth(admin.token))
        .send({})
        .expect(403);
      await api()
        .post(`/v1/manage/returns/${id}/approve`)
        .set(auth(operator.token))
        .send({})
        .expect(201);
      await api()
        .post(`/v1/manage/returns/${id}/refund`)
        .set(auth(admin.token))
        .send({ reference: '123456', restock: true })
        .expect(403);
    });

    it('aprobar dos veces a la vez solo lo aplica una', async () => {
      const { id } = await requested();
      const results = await Promise.all([
        api()
          .post(`/v1/manage/returns/${id}/approve`)
          .set(auth(operator.token))
          .send({}),
        api()
          .post(`/v1/manage/returns/${id}/approve`)
          .set(auth(admin.token))
          .send({}),
      ]);
      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
        201, 409,
      ]);
      expect(
        await prisma.auditLog.count({ where: { action: 'return.approved' } }),
      ).toBe(1);
    });
  });
});
