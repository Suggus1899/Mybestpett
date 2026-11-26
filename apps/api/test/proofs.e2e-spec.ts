import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { PaymentStatus } from '../src/generated/prisma/enums.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, loginAs, resetDb } from './helpers.js';

const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4,
]);
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n');

// Comprobantes de pago: el cliente los adjunta a su pago en revisión y solo
// él y el equipo de pagos los pueden ver.
describe('Comprobantes de pago (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let customer: { id: string; token: string };
  let operator: { id: string; token: string };
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
  });

  async function reportedPayment(
    status: PaymentStatus = 'REPORTED',
    userId = customer.id,
  ) {
    const order = await prisma.order.create({
      data: {
        userId,
        status: status === 'REPORTED' ? 'PAYMENT_REPORTED' : 'PAID',
        paymentMethodId: methodId,
        chargedCurrency: 'USD',
        subtotalUsdCents: 1000,
        shippingUsdCents: 300,
        totalUsdCents: 1300,
        totalCharged: '13.00',
        recipientName: 'Ana',
        phone: '0412-1234567',
        state: 'Miranda',
        city: 'Los Teques',
        line1: 'Calle 1',
        shippingZoneName: 'Caracas',
        carrier: 'Delivery propio',
        paymentDueAt: new Date(Date.now() + 3_600_000),
        termsAcceptedAt: new Date(),
        payments: {
          create: {
            methodId,
            currency: 'USD',
            amount: '13.00',
            reference: `REF${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
            paidAt: new Date(),
            status,
          },
        },
      },
      include: { payments: true },
    });
    return {
      orderId: order.id,
      paymentId: order.payments[0].id,
      reference: order.payments[0].reference,
    };
  }

  const upload = (
    p: { orderId: string; paymentId: string },
    file: Buffer,
    name = 'comprobante.png',
    token = customer.token,
  ) =>
    api()
      .put(`/v1/orders/${p.orderId}/payments/${p.paymentId}/proof`)
      .set(auth(token))
      .attach('file', file, name);

  it('adjunta una imagen y el cliente y el equipo la ven con cabeceras seguras', async () => {
    const p = await reportedPayment();
    const { body } = await upload(p, PNG).expect(200);
    expect(body).toMatchObject({
      contentType: 'image/png',
      sizeBytes: PNG.length,
    });

    const mine = await api()
      .get(`/v1/orders/${p.orderId}/payments/${p.paymentId}/proof`)
      .set(auth(customer.token))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(Buffer.compare(mine.body as Buffer, PNG)).toBe(0);
    expect(mine.headers['content-type']).toBe('image/png');
    expect(mine.headers['content-disposition']).toBe(
      `inline; filename="comprobante-${p.reference}.png"`,
    );
    expect(mine.headers['cache-control']).toBe('private, no-store');
    expect(mine.headers['x-content-type-options']).toBe('nosniff');
    expect(mine.headers['content-security-policy']).toContain('sandbox');

    const staff = await api()
      .get(`/v1/manage/payments/${p.paymentId}/proof`)
      .set(auth(operator.token))
      .expect(200);
    expect(staff.headers['content-type']).toBe('image/png');

    // Los datos del pedido y la cola del equipo muestran que hay comprobante, sin el archivo.
    const order = await api()
      .get(`/v1/orders/${p.orderId}`)
      .set(auth(customer.token))
      .expect(200);
    expect(order.body.payments[0].proof).toMatchObject({
      contentType: 'image/png',
      sizeBytes: PNG.length,
    });
    expect(order.body.payments[0].proof.data).toBeUndefined();
    const queue = await api()
      .get('/v1/manage/payments')
      .set(auth(operator.token))
      .expect(200);
    expect(queue.body.items[0].proof).toMatchObject({
      contentType: 'image/png',
    });
    const manage = await api()
      .get(`/v1/manage/orders/${p.orderId}`)
      .set(auth(operator.token))
      .expect(200);
    expect(manage.body.payments[0].proof.data).toBeUndefined();
  });

  it('un PDF se descarga en lugar de abrirse y reemplaza al anterior', async () => {
    const p = await reportedPayment();
    await upload(p, PNG).expect(200);
    await upload(p, PDF, 'recibo.pdf').expect(200);
    expect(await prisma.paymentProof.count()).toBe(1);
    const res = await api()
      .get(`/v1/manage/payments/${p.paymentId}/proof`)
      .set(auth(operator.token))
      .expect(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="comprobante-.*\.pdf"$/,
    );
  });

  it('detecta el tipo por el contenido: un HTML con nombre de imagen se rechaza', async () => {
    const p = await reportedPayment();
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    const res = await upload(p, html, 'foto.png').expect(400);
    expect(res.body.message).toMatch(/JPG, PNG o WebP, o un PDF/);
    await upload(
      p,
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      'x.svg',
    ).expect(400);
    expect(await prisma.paymentProof.count()).toBe(0);
  });

  it('exige archivo, rechaza más de 5 MB y campos extra', async () => {
    const p = await reportedPayment();
    await api()
      .put(`/v1/orders/${p.orderId}/payments/${p.paymentId}/proof`)
      .set(auth(customer.token))
      .expect(400);
    const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    await upload(p, big).expect(413);
    await api()
      .put(`/v1/orders/${p.orderId}/payments/${p.paymentId}/proof`)
      .set(auth(customer.token))
      .field('otro', 'x')
      .attach('file', PNG, 'a.png')
      .expect(400);
    // Dos archivos tampoco.
    await api()
      .put(`/v1/orders/${p.orderId}/payments/${p.paymentId}/proof`)
      .set(auth(customer.token))
      .attach('file', PNG, 'a.png')
      .attach('file', PNG, 'b.png')
      .expect(400);
    expect(await prisma.paymentProof.count()).toBe(0);
  });

  it('un pago ya revisado no admite comprobante', async () => {
    const p = await reportedPayment('VERIFIED');
    const res = await upload(p, PNG).expect(409);
    expect(res.body.message).toMatch(/ya fue revisado/);
  });

  it('nadie más sube ni ve el comprobante de mi pago', async () => {
    const p = await reportedPayment();
    await upload(p, PNG).expect(200);
    const other = await loginAs(app, prisma, []);
    await upload(p, PNG, 'x.png', other.token).expect(404);
    await api()
      .get(`/v1/orders/${p.orderId}/payments/${p.paymentId}/proof`)
      .set(auth(other.token))
      .expect(404);
    // El cliente no entra a la ruta del equipo.
    await api()
      .get(`/v1/manage/payments/${p.paymentId}/proof`)
      .set(auth(customer.token))
      .expect(403);
    await api().get(`/v1/manage/payments/${p.paymentId}/proof`).expect(401);
    await api()
      .get(`/v1/orders/${p.orderId}/payments/${p.paymentId}/proof`)
      .expect(401);
    // El pago debe ser de ese pedido.
    const mine2 = await reportedPayment();
    await upload(
      { orderId: mine2.orderId, paymentId: p.paymentId },
      PNG,
    ).expect(404);
  });

  it('sin comprobante responde 404 y valida los ids', async () => {
    const p = await reportedPayment();
    const res = await api()
      .get(`/v1/manage/payments/${p.paymentId}/proof`)
      .set(auth(operator.token))
      .expect(404);
    expect(res.body.message).toBe('Este pago no tiene comprobante');
    await api()
      .get('/v1/manage/payments/00000000-0000-4000-8000-000000000000/proof')
      .set(auth(operator.token))
      .expect(404);
    await api()
      .get('/v1/manage/payments/no-uuid/proof')
      .set(auth(operator.token))
      .expect(400);
    await upload({ orderId: 'x', paymentId: p.paymentId }, PNG).expect(400);
  });
});
