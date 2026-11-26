import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { EmailService, MAX_ATTEMPTS } from '../src/emails/email.service.js';
import { OrdersService } from '../src/orders/orders.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, loginAs, resetDb } from './helpers.js';

// Correos al cliente: se guardan en la bandeja junto con el cambio que los
// origina y un proceso los envía con reintentos.
describe('Correos al cliente (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let emails: EmailService;
  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let customer: { id: string; token: string; email: string };
  let operator: { id: string; token: string };
  let ids: { zone: string; method: string; variant: string; address: string };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    emails = app.get(EmailService);
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await resetDb(prisma);
    await app.close();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
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
          create: { sku: 'COL-M', name: 'M', priceUsdCents: 3000, stock: 20 },
        },
      },
      include: { variants: true },
    });
    const zone = await prisma.shippingZone.create({
      data: {
        name: 'Caracas',
        states: ['Miranda'],
        carrier: 'Delivery propio',
        priceUsdCents: 300,
      },
    });
    const method = await prisma.paymentMethod.create({
      data: {
        code: 'ZELLE',
        name: 'Zelle',
        currency: 'USD',
        instructions: 'pagos@petbf.test',
      },
    });
    const user = await loginAs(app, prisma, []);
    customer = {
      ...user,
      email: (await prisma.user.findUniqueOrThrow({ where: { id: user.id } }))
        .email,
    };
    operator = await loginAs(app, prisma, ['ORDERS_OPERATOR']);
    const address = await api()
      .post('/v1/addresses')
      .set(auth(customer.token))
      .send({
        recipientName: 'Ana',
        phone: '0412-1234567',
        state: 'Miranda',
        city: 'Los Teques',
        line1: 'Calle 1',
      })
      .expect(201);
    ids = {
      zone: zone.id,
      method: method.id,
      variant: product.variants[0].id,
      address: address.body.id,
    };
  });

  async function checkout() {
    await api()
      .post('/v1/cart/items')
      .set(auth(customer.token))
      .send({ variantId: ids.variant, quantity: 1 })
      .expect(201);
    const { body } = await api()
      .post('/v1/orders')
      .set(auth(customer.token))
      .send({
        addressId: ids.address,
        shippingZoneId: ids.zone,
        paymentMethodId: ids.method,
        acceptTerms: true,
      })
      .expect(201);
    return body as { id: string; code: string };
  }

  async function report(orderId: string, reference: string) {
    await api()
      .post(`/v1/orders/${orderId}/payments`)
      .set(auth(customer.token))
      .send({ reference, amount: '30.00', paidAt: new Date().toISOString() })
      .expect(201);
    const payment = await prisma.payment.findFirstOrThrow({
      where: { orderId, status: 'REPORTED' },
    });
    return payment.id;
  }

  const outbox = () =>
    prisma.emailOutbox.findMany({ orderBy: { createdAt: 'asc' } });
  const kinds = async () => (await outbox()).map((e) => e.kind);

  it('avisa en cada paso del pedido, al correo del cliente y con su enlace', async () => {
    const order = await checkout();
    const [created] = await outbox();
    expect(created).toMatchObject({
      to: customer.email,
      kind: 'order.pending_payment',
      status: 'PENDING',
    });
    expect(created.subject).toBe(
      `Pedido ${order.code}: paga $30,00 antes de 2 horas`,
    );
    expect(created.text).toContain('pagos@petbf.test');
    expect(created.text).toContain(`http://localhost:3000/pedidos/${order.id}`);

    // Rechazado: avisa con el motivo, sin el prefijo interno.
    const first = await report(order.id, 'MALO123');
    expect(await kinds()).toHaveLength(1); // reportar no envía nada
    await api()
      .post(`/v1/manage/payments/${first}/reject`)
      .set(auth(operator.token))
      .send({ reason: 'No aparece en Zelle' })
      .expect(201);
    const rejected = (await outbox()).at(-1)!;
    expect(rejected.subject).toBe(
      `Pedido ${order.code}: no pudimos confirmar tu pago`,
    );
    expect(rejected.text).toContain('Motivo: No aparece en Zelle');
    expect(rejected.text).not.toContain('Pago rechazado:');

    const second = await report(order.id, 'BUENO123');
    await api()
      .post(`/v1/manage/payments/${second}/verify`)
      .set(auth(operator.token))
      .expect(201);
    const advance = (body: object) =>
      api()
        .post(`/v1/manage/orders/${order.id}/status`)
        .set(auth(operator.token))
        .send(body)
        .expect(201);
    await advance({ status: 'PREPARING' });
    await advance({ status: 'SHIPPED', trackingCode: 'MRW-555' });
    await advance({ status: 'DELIVERED' });

    expect(await kinds()).toEqual([
      'order.pending_payment',
      'order.pending_payment',
      'order.paid',
      'order.shipped',
      'order.delivered',
    ]);
    const all = await outbox();
    expect(all.every((e) => e.to === customer.email)).toBe(true);
    expect(all[3].text).toContain('Delivery propio, guía MRW-555');
    expect(all[4].text).toMatch(/devolución hasta el/);
  });

  it('avisa la cancelación, sea del cliente o por el plazo vencido', async () => {
    const mine = await checkout();
    await api()
      .post(`/v1/orders/${mine.id}/cancel`)
      .set(auth(customer.token))
      .expect(201);
    const late = await checkout();
    await prisma.order.update({
      where: { id: late.id },
      data: { paymentDueAt: new Date(Date.now() - 1000) },
    });
    await app.get(OrdersService).expireOverdue();
    const cancelled = (await outbox()).filter(
      (e) => e.kind === 'order.cancelled',
    );
    expect(cancelled.map((e) => e.text)).toEqual([
      expect.stringContaining('Motivo: Cancelado por el cliente'),
      expect.stringContaining('Motivo: No se reportó el pago a tiempo'),
    ]);
  });

  it('si el pedido no se crea, no queda correo', async () => {
    await api()
      .post('/v1/orders')
      .set(auth(customer.token))
      .send({
        addressId: ids.address,
        shippingZoneId: ids.zone,
        paymentMethodId: ids.method,
        acceptTerms: true,
      })
      .expect(400); // carrito vacío
    expect(await prisma.emailOutbox.count()).toBe(0);
  });

  it('avisa la aprobación, el rechazo y el reembolso de una devolución', async () => {
    const order = await checkout();
    const payment = await report(order.id, 'PAGO1234');
    await api()
      .post(`/v1/manage/payments/${payment}/verify`)
      .set(auth(operator.token))
      .expect(201);
    for (const body of [
      { status: 'PREPARING' },
      { status: 'SHIPPED', trackingCode: 'MRW-1' },
      { status: 'DELIVERED' },
    ]) {
      await api()
        .post(`/v1/manage/orders/${order.id}/status`)
        .set(auth(operator.token))
        .send(body)
        .expect(201);
    }
    const item = await prisma.orderItem.findFirstOrThrow({
      where: { orderId: order.id },
    });
    const ask = () =>
      api()
        .post(`/v1/orders/${order.id}/returns`)
        .set(auth(customer.token))
        .send({
          reason: 'No le quedó al perro',
          items: [{ orderItemId: item.id, quantity: 1 }],
        })
        .expect(201);
    await ask();
    const first = await prisma.returnRequest.findFirstOrThrow();
    await api()
      .post(`/v1/manage/returns/${first.id}/reject`)
      .set(auth(operator.token))
      .send({ reason: 'Tiene marcas de uso' })
      .expect(201);
    await ask();
    const second = await prisma.returnRequest.findFirstOrThrow({
      where: { status: 'REQUESTED' },
    });
    await api()
      .post(`/v1/manage/returns/${second.id}/approve`)
      .set(auth(operator.token))
      .send({ note: 'Tráelo el lunes' })
      .expect(201);
    const admin = await loginAs(app, prisma, ['ADMIN']);
    await api()
      .post(`/v1/manage/returns/${second.id}/refund`)
      .set(auth(admin.token))
      .send({ reference: 'ZL-999', restock: true })
      .expect(201);

    const returns = (await outbox()).filter((e) =>
      e.kind.startsWith('return.'),
    );
    expect(returns.map((e) => e.kind)).toEqual([
      'return.rejected',
      'return.approved',
      'return.refunded',
    ]);
    expect(returns[0].text).toContain('Motivo: Tiene marcas de uso');
    expect(returns[1].text).toContain('Indicaciones: Tráelo el lunes');
    expect(returns[2].subject).toBe(
      `Pedido ${order.code}: te devolvimos $30,00`,
    );
    expect(returns[2].text).toContain('Referencia: ZL-999');
    // El pedido quedó reembolsado entero, pero no se manda un segundo aviso.
    expect(await kinds()).not.toContain('order.refunded');
  });

  describe('envío', () => {
    it('envía los pendientes y no repite los enviados', async () => {
      await checkout();
      const send = vi.spyOn(
        emails as never as { send: () => Promise<void> },
        'send',
      );
      expect(await emails.deliverPending()).toBe(1);
      expect(send).toHaveBeenCalledTimes(1);
      const [email] = await outbox();
      expect(email).toMatchObject({
        status: 'SENT',
        attempts: 1,
        lastError: null,
      });
      expect(email.sentAt).not.toBeNull();
      expect(await emails.deliverPending()).toBe(0);
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('reintenta con espera creciente y se rinde tras 5 intentos', async () => {
      await checkout();
      vi.spyOn(
        emails as never as { send: () => Promise<void> },
        'send',
      ).mockRejectedValue(new Error('proveedor caído'));
      let now = new Date();
      await emails.deliverPending(now);
      let [email] = await outbox();
      expect(email).toMatchObject({
        status: 'PENDING',
        attempts: 1,
        lastError: 'proveedor caído',
      });
      expect(email.nextAttemptAt.getTime()).toBe(now.getTime() + 60_000);
      // Antes de tiempo no se reintenta.
      await emails.deliverPending(new Date(now.getTime() + 30_000));
      expect((await outbox())[0].attempts).toBe(1);

      for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt++) {
        now = new Date(now.getTime() + 60 * 60_000);
        await emails.deliverPending(now);
      }
      [email] = await outbox();
      expect(email).toMatchObject({ status: 'FAILED', attempts: MAX_ATTEMPTS });
      await emails.deliverPending(new Date(now.getTime() + 24 * 60 * 60_000));
      expect((await outbox())[0].attempts).toBe(MAX_ATTEMPTS);
    });

    it('dos procesos a la vez no envían el mismo correo dos veces', async () => {
      await checkout();
      const send = vi.spyOn(
        emails as never as { send: () => Promise<void> },
        'send',
      );
      const results = await Promise.all([
        emails.deliverPending(),
        emails.deliverPending(),
      ]);
      expect(results.reduce((a, b) => a + b, 0)).toBe(1);
      expect(send).toHaveBeenCalledTimes(1);
    });
  });
});
