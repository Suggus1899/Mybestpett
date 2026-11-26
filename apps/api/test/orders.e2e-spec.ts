import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { OrdersService } from '../src/orders/orders.service.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, loginAs, resetDb } from './helpers.js';

// Flujo de compra completo: direcciones, carrito, checkout, pago reportado,
// verificación del equipo, despacho y cancelaciones. Incluye los casos de error.
describe('Carrito, pedidos y pagos (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  // Datos de cada prueba.
  let token: string; // cliente
  let userId: string;
  let operator: string; // operador de pagos y pedidos
  let addressId: string;
  let zone: { caracas: string; nacional: string; inactive: string };
  let method: {
    pagoMovil: string;
    zelle: string;
    eur: string;
    inactive: string;
  };
  let variant: { cheap: string; big: string; last: string; inactive: string };

  const address = {
    recipientName: 'Ana Pérez',
    phone: '0412-1234567',
    state: 'Distrito Capital',
    city: 'Caracas',
    line1: 'Av. Urdaneta, edificio Sol, piso 3',
  };

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
        name: 'Croquetas',
        slug: 'croquetas',
        description: '-',
        categoryId: category.id,
        isReturnable: false,
        variants: {
          create: [
            { sku: 'CRO-1', name: '1 kg', priceUsdCents: 800, stock: 10 },
            { sku: 'CRO-15', name: '15 kg', priceUsdCents: 3000, stock: 5 },
            { sku: 'CRO-ULT', name: 'Última', priceUsdCents: 1000, stock: 1 },
            {
              sku: 'CRO-OFF',
              name: 'Retirada',
              priceUsdCents: 500,
              stock: 9,
              isActive: false,
            },
          ],
        },
      },
      include: { variants: true },
    });
    const bySku = (sku: string) =>
      product.variants.find((v) => v.sku === sku)!.id;
    variant = {
      cheap: bySku('CRO-1'),
      big: bySku('CRO-15'),
      last: bySku('CRO-ULT'),
      inactive: bySku('CRO-OFF'),
    };

    const zones = await Promise.all([
      prisma.shippingZone.create({
        data: {
          name: 'Caracas',
          states: ['Distrito Capital', 'Miranda'],
          carrier: 'Delivery propio',
          priceUsdCents: 300,
        },
      }),
      prisma.shippingZone.create({
        data: {
          name: 'Nacional',
          states: ['Zulia', 'Lara'],
          carrier: 'Encomienda',
          priceUsdCents: 600,
        },
      }),
      prisma.shippingZone.create({
        data: {
          name: 'Cerrada',
          states: ['Distrito Capital'],
          carrier: 'X',
          priceUsdCents: 0,
          isActive: false,
        },
      }),
    ]);
    zone = {
      caracas: zones[0].id,
      nacional: zones[1].id,
      inactive: zones[2].id,
    };

    const methods = await Promise.all([
      prisma.paymentMethod.create({
        data: {
          code: 'PAGO_MOVIL',
          name: 'Pago Móvil',
          currency: 'VES',
          instructions: 'Banco X, 0412…',
        },
      }),
      prisma.paymentMethod.create({
        data: {
          code: 'ZELLE',
          name: 'Zelle',
          currency: 'USD',
          instructions: 'pagos@petbf.test',
        },
      }),
      prisma.paymentMethod.create({
        data: {
          code: 'TRANSFER_EUR',
          name: 'Euros',
          currency: 'EUR',
          instructions: 'IBAN …',
        },
      }),
      prisma.paymentMethod.create({
        data: {
          code: 'USDT',
          name: 'USDT',
          currency: 'USDT',
          instructions: 'TRC20 …',
          isActive: false,
        },
      }),
    ]);
    method = {
      pagoMovil: methods[0].id,
      zelle: methods[1].id,
      eur: methods[2].id,
      inactive: methods[3].id,
    };

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await prisma.exchangeRate.createMany({
      data: [
        {
          base: 'USD',
          quote: 'VES',
          rate: '245.5',
          source: 'BCV',
          effectiveAt: yesterday,
        },
        {
          base: 'EUR',
          quote: 'VES',
          rate: '268.1',
          source: 'BCV',
          effectiveAt: yesterday,
        },
      ],
    });

    ({ token, id: userId } = await loginAs(app, prisma, []));
    ({ token: operator } = await loginAs(app, prisma, ['ORDERS_OPERATOR']));
    addressId = (
      await api()
        .post('/v1/addresses')
        .set(auth(token))
        .send(address)
        .expect(201)
    ).body.id;
  });

  const addToCart = (variantId: string, quantity = 1, t = token) =>
    api().post('/v1/cart/items').set(auth(t)).send({ variantId, quantity });

  const checkout = (overrides: Record<string, unknown> = {}, t = token) =>
    api()
      .post('/v1/orders')
      .set(auth(t))
      .send({
        addressId,
        shippingZoneId: zone.caracas,
        paymentMethodId: method.zelle,
        acceptTerms: true,
        ...overrides,
      });

  const stockOf = async (id: string) =>
    (await prisma.productVariant.findUniqueOrThrow({ where: { id } })).stock;

  // Pedido listo en PENDING_PAYMENT (2 × 8 $ por Zelle = 16 $ + 3 $ de envío).
  async function placeOrder(
    overrides: Record<string, unknown> = {},
    t = token,
  ) {
    await addToCart(variant.cheap, 2, t).expect(201);
    return (await checkout(overrides, t).expect(201)).body;
  }

  const payment = (overrides: Record<string, unknown> = {}) => ({
    reference: '0012 3456 78',
    originBank: 'Banesco',
    amount: '19.00',
    paidAt: new Date().toISOString(),
    ...overrides,
  });

  async function reportedPayment(orderId: string, ref = '00123456') {
    const res = await api()
      .post(`/v1/orders/${orderId}/payments`)
      .set(auth(token))
      .send(payment({ reference: ref }))
      .expect(201);
    return res.body.payments[0].id as string;
  }

  // ---------- Direcciones ----------

  describe('direcciones', () => {
    it('exige sesión', async () => {
      await api().get('/v1/addresses').expect(401);
      await api().post('/v1/addresses').send(address).expect(401);
    });

    it('la primera es la predeterminada y una nueva puede tomar su lugar', async () => {
      const second = await api()
        .post('/v1/addresses')
        .set(auth(token))
        .send({
          ...address,
          city: 'Los Teques',
          state: 'Miranda',
          isDefault: true,
        })
        .expect(201);
      const list = (
        await api().get('/v1/addresses').set(auth(token)).expect(200)
      ).body;
      expect(list).toHaveLength(2);
      expect(list[0].id).toBe(second.body.id);
      expect(
        list.filter((a: { isDefault: boolean }) => a.isDefault),
      ).toHaveLength(1);
    });

    it('al borrar la predeterminada, otra pasa a serlo', async () => {
      const other = await api()
        .post('/v1/addresses')
        .set(auth(token))
        .send(address)
        .expect(201);
      expect(other.body.isDefault).toBe(false);
      await api()
        .delete(`/v1/addresses/${addressId}`)
        .set(auth(token))
        .expect(204);
      const list = (await api().get('/v1/addresses').set(auth(token))).body;
      expect(list).toEqual([
        expect.objectContaining({ id: other.body.id, isDefault: true }),
      ]);
    });

    it.each([
      ['estado que no existe', { ...address, state: 'Narnia' }],
      ['estado en minúsculas', { ...address, state: 'zulia' }],
      ['teléfono inválido', { ...address, phone: '12' }],
      ['sin destinatario', { ...address, recipientName: '  ' }],
      ['dirección de 201', { ...address, line1: 'a'.repeat(201) }],
      ['sin ciudad', { ...address, city: undefined }],
    ])('rechaza %s', async (_c, body) => {
      await api().post('/v1/addresses').set(auth(token)).send(body).expect(400);
    });

    it('guarda los opcionales vacíos como null', async () => {
      const res = await api()
        .post('/v1/addresses')
        .set(auth(token))
        .send({ ...address, municipality: '  ', referencePoint: '' })
        .expect(201);
      expect(res.body.municipality).toBeNull();
      expect(res.body.referencePoint).toBeNull();
    });

    it('no deja ver ni tocar la dirección de otra persona', async () => {
      const { token: other } = await loginAs(app, prisma, []);
      expect((await api().get('/v1/addresses').set(auth(other))).body).toEqual(
        [],
      );
      await api()
        .patch(`/v1/addresses/${addressId}`)
        .set(auth(other))
        .send({ city: 'X' })
        .expect(404);
      await api()
        .delete(`/v1/addresses/${addressId}`)
        .set(auth(other))
        .expect(404);
    });

    it('rechaza una edición vacía y un id que no es uuid', async () => {
      await api()
        .patch(`/v1/addresses/${addressId}`)
        .set(auth(token))
        .send({})
        .expect(400);
      await api()
        .patch('/v1/addresses/123')
        .set(auth(token))
        .send({ city: 'X' })
        .expect(400);
    });

    it('admite como máximo 10 direcciones', async () => {
      for (let i = 0; i < 9; i++) {
        await api()
          .post('/v1/addresses')
          .set(auth(token))
          .send(address)
          .expect(201);
      }
      await api()
        .post('/v1/addresses')
        .set(auth(token))
        .send(address)
        .expect(400);
    });
  });

  // ---------- Zonas y métodos ----------

  describe('zonas de envío y métodos de pago', () => {
    it('el público ve solo los activos', async () => {
      const zones = (await api().get('/v1/shipping-zones').expect(200)).body;
      expect(zones.map((z: { name: string }) => z.name).sort()).toEqual([
        'Caracas',
        'Nacional',
      ]);
      const methods = (await api().get('/v1/payment-methods').expect(200)).body;
      expect(methods).toHaveLength(3);
    });

    it('solo el administrador los edita y queda auditado', async () => {
      await api()
        .patch(`/v1/manage/payment-methods/${method.zelle}`)
        .set(auth(operator))
        .send({ instructions: 'x' })
        .expect(403);
      const { token: admin } = await loginAs(app, prisma, ['ADMIN']);
      const res = await api()
        .patch(`/v1/manage/payment-methods/${method.zelle}`)
        .set(auth(admin))
        .send({
          instructions: 'Zelle: caja@petbf.test',
          code: 'USDT',
          currency: 'VES',
        })
        .expect(200);
      expect(res.body.instructions).toBe('Zelle: caja@petbf.test');
      // El código y la moneda no se pueden cambiar.
      expect(res.body.code).toBe('ZELLE');
      expect(res.body.currency).toBe('USD');
      expect(
        await prisma.auditLog.count({
          where: { action: 'payment_method.updated' },
        }),
      ).toBe(1);
    });

    it('valida las zonas', async () => {
      const { token: admin } = await loginAs(app, prisma, ['ADMIN']);
      const base = {
        name: 'Andes',
        states: ['Mérida'],
        carrier: 'MRW',
        priceUsdCents: 500,
      };
      const created = await api()
        .post('/v1/manage/shipping-zones')
        .set(auth(admin))
        .send(base)
        .expect(201);
      expect(created.body.freeOverUsdCents).toBe(2500);
      for (const body of [
        { ...base, states: [] },
        { ...base, states: ['Mérida', 'Mérida'] },
        { ...base, states: ['Atlantis'] },
        { ...base, priceUsdCents: -1 },
        { ...base, priceUsdCents: 1.5 },
      ]) {
        await api()
          .post('/v1/manage/shipping-zones')
          .set(auth(admin))
          .send(body)
          .expect(400);
      }
      await api()
        .patch(`/v1/manage/shipping-zones/${created.body.id}`)
        .set(auth(admin))
        .send({})
        .expect(400);
    });
  });

  // ---------- Carrito ----------

  describe('carrito', () => {
    it('exige sesión', async () => {
      await api().get('/v1/cart').expect(401);
      await api()
        .post('/v1/cart/items')
        .send({ variantId: variant.cheap })
        .expect(401);
    });

    it('suma, cambia y quita cantidades con el precio actual', async () => {
      await addToCart(variant.cheap).expect(201);
      const res = await addToCart(variant.cheap, 2).expect(201);
      expect(res.body.items[0]).toMatchObject({
        quantity: 3,
        unitPriceUsdCents: 800,
        lineTotalUsdCents: 2400,
        issue: null,
      });
      expect(res.body.subtotalUsdCents).toBe(2400);

      const set = await api()
        .put(`/v1/cart/items/${variant.cheap}`)
        .set(auth(token))
        .send({ quantity: 1 })
        .expect(200);
      expect(set.body.itemCount).toBe(1);
      const removed = await api()
        .delete(`/v1/cart/items/${variant.cheap}`)
        .set(auth(token))
        .expect(200);
      expect(removed.body.items).toEqual([]);
      expect(removed.body.canCheckout).toBe(false);
    });

    it('no deja pedir más de lo que hay en stock', async () => {
      const res = await addToCart(variant.big, 6).expect(409);
      expect(res.body.message).toBe(
        'Solo hay 5 disponibles de esta presentación',
      );
      await addToCart(variant.big, 5).expect(201);
      await addToCart(variant.big, 1).expect(409);
    });

    it('rechaza presentaciones inactivas, agotadas o inexistentes', async () => {
      await addToCart(variant.inactive).expect(404);
      await addToCart('00000000-0000-4000-8000-000000000000').expect(404);
      await prisma.productVariant.update({
        where: { id: variant.cheap },
        data: { stock: 0 },
      });
      expect((await addToCart(variant.cheap).expect(409)).body.message).toBe(
        'Producto agotado',
      );
    });

    it.each([
      ['cantidad 0', { quantity: 0 }],
      ['cantidad negativa', { quantity: -1 }],
      ['cantidad decimal', { quantity: 1.5 }],
      ['cantidad 21', { quantity: 21 }],
      ['cantidad como texto', { quantity: '2' }],
      ['id inválido', { variantId: 'abc' }],
    ])('rechaza %s', async (_c, body) => {
      await api()
        .post('/v1/cart/items')
        .set(auth(token))
        .send({ variantId: variant.cheap, ...body })
        .expect(400);
    });

    it('no pasa de 20 unidades sumando poco a poco', async () => {
      await prisma.productVariant.update({
        where: { id: variant.cheap },
        data: { stock: 100 },
      });
      await addToCart(variant.cheap, 20).expect(201);
      await addToCart(variant.cheap, 1).expect(400);
    });

    it('marca las líneas que dejaron de estar disponibles y bloquea el checkout', async () => {
      await addToCart(variant.big, 3).expect(201);
      await addToCart(variant.cheap, 1).expect(201);
      await prisma.productVariant.update({
        where: { id: variant.big },
        data: { stock: 2 },
      });
      let cart = (await api().get('/v1/cart').set(auth(token))).body;
      expect(
        cart.items.find((i: { sku: string }) => i.sku === 'CRO-15'),
      ).toMatchObject({ issue: 'insufficient_stock', available: 2 });
      expect(cart.canCheckout).toBe(false);
      expect(cart.subtotalUsdCents).toBe(800); // solo cuenta lo comprable

      await prisma.productVariant.update({
        where: { id: variant.big },
        data: { isActive: false },
      });
      cart = (await api().get('/v1/cart').set(auth(token))).body;
      expect(
        cart.items.find((i: { sku: string }) => i.sku === 'CRO-15').issue,
      ).toBe('unavailable');
    });

    it('cada persona tiene su propio carrito', async () => {
      await addToCart(variant.cheap).expect(201);
      const { token: other } = await loginAs(app, prisma, []);
      expect((await api().get('/v1/cart').set(auth(other))).body.items).toEqual(
        [],
      );
    });
  });

  // ---------- Checkout ----------

  describe('checkout', () => {
    it('crea el pedido, descuenta el stock, vacía el carrito y da 2 horas para pagar', async () => {
      const before = Date.now();
      const order = await placeOrder();
      expect(order).toMatchObject({
        code: expect.stringMatching(/^PB-\d{6}$/),
        status: 'PENDING_PAYMENT',
        subtotalUsdCents: 1600,
        shippingUsdCents: 300,
        totalUsdCents: 1900,
        chargedCurrency: 'USD',
        totalCharged: '19',
        usdVesRate: '245.5',
        recipientName: 'Ana Pérez',
        state: 'Distrito Capital',
        shippingZoneName: 'Caracas',
        carrier: 'Delivery propio',
        paymentMethod: expect.objectContaining({
          code: 'ZELLE',
          instructions: 'pagos@petbf.test',
        }),
      });
      expect(order.items).toEqual([
        expect.objectContaining({
          sku: 'CRO-1',
          quantity: 2,
          unitPriceUsdCents: 800,
          isReturnable: false,
        }),
      ]);
      const due = new Date(order.paymentDueAt).getTime() - before;
      expect(due).toBeGreaterThan(2 * 60 * 60 * 1000 - 5000);
      expect(due).toBeLessThan(2 * 60 * 60 * 1000 + 5000);
      expect(order.history).toEqual([
        expect.objectContaining({ toStatus: 'PENDING_PAYMENT' }),
      ]);

      expect(await stockOf(variant.cheap)).toBe(8);
      expect((await api().get('/v1/cart').set(auth(token))).body.items).toEqual(
        [],
      );
      const movements = await prisma.inventoryMovement.findMany();
      expect(movements).toEqual([
        expect.objectContaining({
          variantId: variant.cheap,
          quantityDelta: -2,
          reason: 'SALE',
        }),
      ]);
      expect(
        await prisma.auditLog.count({ where: { action: 'order.created' } }),
      ).toBe(1);
    });

    it('el envío es gratis desde 25 $', async () => {
      await addToCart(variant.cheap, 3).expect(201); // 24 $
      expect((await checkout().expect(201)).body).toMatchObject({
        shippingUsdCents: 300,
        totalUsdCents: 2700,
      });
      await addToCart(variant.big, 1).expect(201); // 30 $
      expect((await checkout().expect(201)).body).toMatchObject({
        shippingUsdCents: 0,
        totalUsdCents: 3000,
      });
    });

    it('cobra en bolívares y en euros con la tasa del BCV congelada', async () => {
      const ves = await placeOrder({ paymentMethodId: method.pagoMovil });
      // 19 $ × 245,50 = 4.664,50 Bs
      expect(ves).toMatchObject({
        chargedCurrency: 'VES',
        totalCharged: '4664.5',
      });
      const eur = await placeOrder({ paymentMethodId: method.eur });
      // 19 × 245,50 ÷ 268,10 = 17,397… → 17,40 €
      expect(eur).toMatchObject({
        chargedCurrency: 'EUR',
        totalCharged: '17.4',
        eurVesRate: '268.1',
      });

      // Una tasa nueva no cambia los pedidos ya creados.
      await prisma.exchangeRate.create({
        data: {
          base: 'USD',
          quote: 'VES',
          rate: '300',
          source: 'BCV',
          effectiveAt: new Date(),
        },
      });
      const again = (await api().get(`/v1/orders/${ves.id}`).set(auth(token)))
        .body;
      expect(again).toMatchObject({
        totalCharged: '4664.5',
        usdVesRate: '245.5',
      });
    });

    it('sin tasa cargada no cobra en bolívares, pero sí en dólares', async () => {
      await prisma.exchangeRate.deleteMany();
      await addToCart(variant.cheap).expect(201);
      const res = await checkout({ paymentMethodId: method.pagoMovil }).expect(
        409,
      );
      expect(res.body.message).toMatch(/tasa del BCV/);
      expect(await stockOf(variant.cheap)).toBe(10);
      expect((await checkout().expect(201)).body.usdVesRate).toBeNull();
    });

    it('no cambia el precio aunque el catálogo cambie después', async () => {
      const order = await placeOrder();
      await prisma.productVariant.update({
        where: { id: variant.cheap },
        data: { priceUsdCents: 9999, name: 'Otro' },
      });
      const again = (await api().get(`/v1/orders/${order.id}`).set(auth(token)))
        .body;
      expect(again.items[0]).toMatchObject({
        unitPriceUsdCents: 800,
        variantName: '1 kg',
      });
    });

    it.each([
      ['sin aceptar términos', { acceptTerms: false }],
      ['términos como texto', { acceptTerms: 'true' }],
      ['sin dirección', { addressId: undefined }],
      ['zona que no es uuid', { shippingZoneId: 'caracas' }],
    ])('rechaza %s', async (_c, body) => {
      await addToCart(variant.cheap).expect(201);
      await checkout(body).expect(400);
      expect(await stockOf(variant.cheap)).toBe(10);
    });

    it('rechaza un carrito vacío', async () => {
      expect((await checkout().expect(400)).body.message).toBe(
        'El carrito está vacío',
      );
    });

    it('la zona debe llegar al estado de la dirección y estar activa', async () => {
      await addToCart(variant.cheap).expect(201);
      const res = await checkout({ shippingZoneId: zone.nacional }).expect(400);
      expect(res.body.message).toBe(
        'La zona «Nacional» no llega a Distrito Capital',
      );
      await checkout({ shippingZoneId: zone.inactive }).expect(400);
    });

    it('rechaza métodos inactivos y direcciones ajenas', async () => {
      await addToCart(variant.cheap).expect(201);
      await checkout({ paymentMethodId: method.inactive }).expect(400);
      const { token: other } = await loginAs(app, prisma, []);
      await addToCart(variant.cheap, 1, other).expect(201);
      await checkout({}, other).expect(404); // usa la dirección de la otra persona
    });

    it('si el stock se acabó después de añadir, no crea nada', async () => {
      await addToCart(variant.big, 3).expect(201);
      await addToCart(variant.cheap, 1).expect(201);
      await prisma.productVariant.update({
        where: { id: variant.big },
        data: { stock: 1 },
      });
      expect((await checkout().expect(409)).body.message).toMatch(
        /Revisa tu carrito: Croquetas/,
      );
      expect(await prisma.order.count()).toBe(0);
      expect(await stockOf(variant.cheap)).toBe(10);
      expect(
        (await api().get('/v1/cart').set(auth(token))).body.items,
      ).toHaveLength(2);
    });

    it('dos personas compran la última unidad a la vez: solo una la consigue', async () => {
      const { token: other } = await loginAs(app, prisma, []);
      const otherAddress = (
        await api().post('/v1/addresses').set(auth(other)).send(address)
      ).body.id;
      await addToCart(variant.last, 1).expect(201);
      await addToCart(variant.last, 1, other).expect(201);
      const results = await Promise.all([
        checkout(),
        checkout({ addressId: otherAddress }, other),
      ]);
      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([201, 409]);
      expect(await stockOf(variant.last)).toBe(0);
      expect(await prisma.order.count()).toBe(1);
    });

    it('enviar el checkout dos veces seguidas crea un solo pedido', async () => {
      await addToCart(variant.cheap, 1).expect(201);
      const results = await Promise.all([checkout(), checkout()]);
      expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([201, 400]);
      expect(await stockOf(variant.cheap)).toBe(9);
    });
  });

  // ---------- Pedidos del cliente ----------

  describe('mis pedidos', () => {
    it('lista solo los propios y oculta los ajenos', async () => {
      const order = await placeOrder();
      const { token: other } = await loginAs(app, prisma, []);
      expect((await api().get('/v1/orders').set(auth(other))).body.total).toBe(
        0,
      );
      await api().get(`/v1/orders/${order.id}`).set(auth(other)).expect(404);
      await api()
        .post(`/v1/orders/${order.id}/cancel`)
        .set(auth(other))
        .expect(404);
      const mine = (await api().get('/v1/orders').set(auth(token))).body;
      expect(mine.items).toEqual([
        expect.objectContaining({
          id: order.id,
          code: order.code,
          _count: { items: 1 },
        }),
      ]);
    });

    it('el cliente cancela antes de reportar y el stock vuelve', async () => {
      const order = await placeOrder();
      const res = await api()
        .post(`/v1/orders/${order.id}/cancel`)
        .set(auth(token))
        .expect(201);
      expect(res.body.status).toBe('CANCELLED');
      expect(await stockOf(variant.cheap)).toBe(10);
      await api()
        .post(`/v1/orders/${order.id}/cancel`)
        .set(auth(token))
        .expect(409);
    });

    it('no puede cancelar después de reportar el pago', async () => {
      const order = await placeOrder();
      await reportedPayment(order.id);
      const res = await api()
        .post(`/v1/orders/${order.id}/cancel`)
        .set(auth(token))
        .expect(409);
      expect(res.body.message).toMatch(/Ya reportaste el pago/);
    });

    it('no expone quién verificó el pago', async () => {
      const order = await placeOrder();
      await reportedPayment(order.id);
      const res = await api().get(`/v1/orders/${order.id}`).set(auth(token));
      expect(res.body.payments[0]).not.toHaveProperty('verifiedById');
      expect(res.body.payments[0]).not.toHaveProperty('methodId');
    });
  });

  // ---------- Pagos ----------

  describe('reporte de pago', () => {
    it('pasa el pedido a pago reportado con la referencia normalizada', async () => {
      const order = await placeOrder();
      const res = await api()
        .post(`/v1/orders/${order.id}/payments`)
        .set(auth(token))
        .send(payment())
        .expect(201);
      expect(res.body.status).toBe('PAYMENT_REPORTED');
      expect(res.body.payments[0]).toMatchObject({
        reference: '0012345678',
        amount: '19',
        currency: 'USD',
        status: 'REPORTED',
      });
    });

    it('no admite un segundo reporte mientras el primero espera', async () => {
      const order = await placeOrder();
      await reportedPayment(order.id);
      await api()
        .post(`/v1/orders/${order.id}/payments`)
        .set(auth(token))
        .send(payment({ reference: '99999999' }))
        .expect(409);
    });

    it.each([
      ['referencia corta', { reference: '123' }],
      ['referencia con símbolos', { reference: '12#45$78' }],
      ['referencia de 41', { reference: '1'.repeat(41) }],
      ['monto cero', { amount: '0' }],
      ['monto negativo', { amount: '-5' }],
      ['monto con coma', { amount: '19,00' }],
      ['monto con 3 decimales', { amount: '19.001' }],
      ['monto como número', { amount: 19 }],
      ['fecha inválida', { paidAt: 'ayer' }],
      ['fecha sin zona horaria', { paidAt: '2026-11-26T10:00:00' }],
      ['banco de 81', { originBank: 'b'.repeat(81) }],
    ])('rechaza %s', async (_c, body) => {
      const order = await placeOrder();
      await api()
        .post(`/v1/orders/${order.id}/payments`)
        .set(auth(token))
        .send(payment(body))
        .expect(400);
    });

    it('rechaza fechas en el futuro o anteriores al pedido', async () => {
      const order = await placeOrder();
      const hour = 60 * 60 * 1000;
      for (const paidAt of [
        new Date(Date.now() + hour),
        new Date(Date.now() - 24 * hour),
      ]) {
        await api()
          .post(`/v1/orders/${order.id}/payments`)
          .set(auth(token))
          .send(payment({ paidAt: paidAt.toISOString() }))
          .expect(409);
      }
    });

    it('si pasaron las 2 horas, cancela el pedido en lugar de aceptar el reporte', async () => {
      const order = await placeOrder();
      await prisma.order.update({
        where: { id: order.id },
        data: { paymentDueAt: new Date(Date.now() - 1000) },
      });
      const res = await api()
        .post(`/v1/orders/${order.id}/payments`)
        .set(auth(token))
        .send(payment())
        .expect(409);
      expect(res.body.message).toMatch(/venció/);
      expect(
        (await prisma.order.findUniqueOrThrow({ where: { id: order.id } }))
          .status,
      ).toBe('CANCELLED');
      expect(await stockOf(variant.cheap)).toBe(10);
    });

    it('nadie más puede reportar el pago de mi pedido', async () => {
      const order = await placeOrder();
      const { token: other } = await loginAs(app, prisma, []);
      await api()
        .post(`/v1/orders/${order.id}/payments`)
        .set(auth(other))
        .send(payment())
        .expect(404);
    });
  });

  describe('verificación del equipo', () => {
    it('solo el operador (o ADMIN) ve la cola y revisa pagos', async () => {
      const order = await placeOrder();
      const paymentId = await reportedPayment(order.id);
      const { token: catalog } = await loginAs(app, prisma, [
        'CATALOG_MANAGER',
      ]);
      for (const t of [token, catalog]) {
        await api().get('/v1/manage/payments').set(auth(t)).expect(403);
        await api()
          .post(`/v1/manage/payments/${paymentId}/verify`)
          .set(auth(t))
          .expect(403);
        await api().get('/v1/manage/orders').set(auth(t)).expect(403);
      }
      const queue = (
        await api().get('/v1/manage/payments').set(auth(operator)).expect(200)
      ).body;
      expect(queue.items).toEqual([
        expect.objectContaining({
          id: paymentId,
          amount: '19',
          order: expect.objectContaining({
            code: order.code,
            totalCharged: '19',
          }),
        }),
      ]);
    });

    it('verificar deja el pedido pagado y queda auditado', async () => {
      const order = await placeOrder();
      const paymentId = await reportedPayment(order.id);
      const res = await api()
        .post(`/v1/manage/payments/${paymentId}/verify`)
        .set(auth(operator))
        .expect(201);
      expect(res.body.status).toBe('PAID');
      expect(res.body.paidAt).not.toBeNull();
      expect(res.body.payments[0]).toMatchObject({ status: 'VERIFIED' });
      expect(
        res.body.history.map((h: { toStatus: string }) => h.toStatus),
      ).toEqual(['PENDING_PAYMENT', 'PAYMENT_REPORTED', 'PAID']);
      expect(
        await prisma.auditLog.count({ where: { action: 'payment.verified' } }),
      ).toBe(1);
      await api()
        .post(`/v1/manage/payments/${paymentId}/verify`)
        .set(auth(operator))
        .expect(409);
      await api()
        .post(`/v1/manage/payments/${paymentId}/reject`)
        .set(auth(operator))
        .send({ reason: 'No llegó' })
        .expect(409);
    });

    it('nadie revisa el pago de su propio pedido', async () => {
      const { token: me, id: meId } = await loginAs(app, prisma, [
        'ORDERS_OPERATOR',
      ]);
      const mine = (
        await api().post('/v1/addresses').set(auth(me)).send(address)
      ).body.id;
      const order = await placeOrder({ addressId: mine }, me);
      const res = await api()
        .post(`/v1/orders/${order.id}/payments`)
        .set(auth(me))
        .send(payment())
        .expect(201);
      expect(meId).toBeTruthy();
      await api()
        .post(`/v1/manage/payments/${res.body.payments[0].id}/verify`)
        .set(auth(me))
        .expect(403);
      await api()
        .post(`/v1/manage/payments/${res.body.payments[0].id}/reject`)
        .set(auth(me))
        .send({ reason: 'Intento' })
        .expect(403);
    });

    it('una referencia verificada no paga otro pedido con el mismo método', async () => {
      const first = await placeOrder();
      await api()
        .post(
          `/v1/manage/payments/${await reportedPayment(first.id, 'REF-777')}/verify`,
        )
        .set(auth(operator))
        .expect(201);
      const second = await placeOrder();
      const res = await api()
        .post(`/v1/orders/${second.id}/payments`)
        .set(auth(token))
        .send(payment({ reference: ' ref-777 ' }))
        .expect(409);
      expect(res.body.message).toBe('Esa referencia ya se usó en otro pago');
      // Con otro método la misma referencia es válida.
      const third = await placeOrder({ paymentMethodId: method.pagoMovil });
      await api()
        .post(`/v1/orders/${third.id}/payments`)
        .set(auth(token))
        .send(payment({ reference: 'REF-777' }))
        .expect(201);
    });

    it('si dos pedidos reportan la misma referencia, solo se verifica uno', async () => {
      const a = await placeOrder();
      const b = await placeOrder();
      const pa = await reportedPayment(a.id, 'DUP-1');
      const pb = await reportedPayment(b.id, 'DUP-1');
      await api()
        .post(`/v1/manage/payments/${pa}/verify`)
        .set(auth(operator))
        .expect(201);
      await api()
        .post(`/v1/manage/payments/${pb}/verify`)
        .set(auth(operator))
        .expect(409);
      expect(
        (await prisma.order.findUniqueOrThrow({ where: { id: b.id } })).status,
      ).toBe('PAYMENT_REPORTED');
    });

    it('rechazar exige motivo, devuelve el pedido a pendiente y da otras 2 horas', async () => {
      const order = await placeOrder();
      const paymentId = await reportedPayment(order.id);
      await api()
        .post(`/v1/manage/payments/${paymentId}/reject`)
        .set(auth(operator))
        .send({ reason: 'no' })
        .expect(400);
      await api()
        .post(`/v1/manage/payments/${paymentId}/reject`)
        .set(auth(operator))
        .send({})
        .expect(400);
      await prisma.order.update({
        where: { id: order.id },
        data: { paymentDueAt: new Date(Date.now() + 60_000) },
      });
      const res = await api()
        .post(`/v1/manage/payments/${paymentId}/reject`)
        .set(auth(operator))
        .send({ reason: 'El monto no coincide' })
        .expect(201);
      expect(res.body.status).toBe('PENDING_PAYMENT');
      expect(new Date(res.body.paymentDueAt).getTime()).toBeGreaterThan(
        Date.now() + 110 * 60_000,
      );

      const mine = (await api().get(`/v1/orders/${order.id}`).set(auth(token)))
        .body;
      expect(mine.payments[0]).toMatchObject({
        status: 'REJECTED',
        rejectionReason: 'El monto no coincide',
      });
      // Puede reportar de nuevo.
      await api()
        .post(`/v1/orders/${order.id}/payments`)
        .set(auth(token))
        .send(payment({ reference: '55556666' }))
        .expect(201);
    });

    it('un pago inexistente responde 404 y un id inválido 400', async () => {
      await api()
        .post('/v1/manage/payments/00000000-0000-4000-8000-000000000000/verify')
        .set(auth(operator))
        .expect(404);
      await api()
        .post('/v1/manage/payments/abc/verify')
        .set(auth(operator))
        .expect(400);
      await api()
        .get('/v1/manage/payments?status=PAGADO')
        .set(auth(operator))
        .expect(400);
    });
  });

  // ---------- Despacho ----------

  describe('estados del pedido', () => {
    async function paidOrder() {
      const order = await placeOrder();
      await api()
        .post(`/v1/manage/payments/${await reportedPayment(order.id, `PAID-${order.number}`)}/verify`)
        .set(auth(operator))
        .expect(201);
      return order.id as string;
    }
    const advance = (id: string, body: object) =>
      api()
        .post(`/v1/manage/orders/${id}/status`)
        .set(auth(operator))
        .send(body);

    it('avanza de pagado a preparación, enviado y entregado, con historial', async () => {
      const id = await paidOrder();
      await advance(id, { status: 'PREPARING' }).expect(201);
      await advance(id, { status: 'SHIPPED' }).expect(400); // falta la guía
      const shipped = await advance(id, {
        status: 'SHIPPED',
        trackingCode: 'MRW-123',
        carrier: 'MRW',
      }).expect(201);
      expect(shipped.body).toMatchObject({
        status: 'SHIPPED',
        trackingCode: 'MRW-123',
        carrier: 'MRW',
      });
      const done = await advance(id, {
        status: 'DELIVERED',
        note: 'Recibió el portero',
      }).expect(201);
      expect(done.body.deliveredAt).not.toBeNull();
      expect(
        done.body.history.map((h: { toStatus: string }) => h.toStatus),
      ).toEqual([
        'PENDING_PAYMENT',
        'PAYMENT_REPORTED',
        'PAID',
        'PREPARING',
        'SHIPPED',
        'DELIVERED',
      ]);
      expect(done.body.history.at(-1).changedBy).toMatchObject({
        firstName: 'Prueba',
      });
    });

    it('no salta estados ni vuelve atrás', async () => {
      const id = await paidOrder();
      await advance(id, { status: 'DELIVERED' }).expect(409);
      await advance(id, { status: 'SHIPPED', trackingCode: 'X-1234' }).expect(
        409,
      );
      await advance(id, { status: 'PAID' }).expect(400);
      await advance(id, { status: 'CANCELLED' }).expect(400);
      const pending = await placeOrder();
      await advance(pending.id, { status: 'PREPARING' }).expect(409);
    });

    it('el equipo cancela un pedido sin pago verificado y el stock vuelve', async () => {
      const order = await placeOrder();
      const paymentId = await reportedPayment(order.id);
      await api()
        .post(`/v1/manage/orders/${order.id}/cancel`)
        .set(auth(operator))
        .send({ reason: 'x' })
        .expect(400);
      const res = await api()
        .post(`/v1/manage/orders/${order.id}/cancel`)
        .set(auth(operator))
        .send({ reason: 'Cliente lo pidió por teléfono' })
        .expect(201);
      expect(res.body.status).toBe('CANCELLED');
      expect(
        (await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } }))
          .status,
      ).toBe('REJECTED');
      expect(await stockOf(variant.cheap)).toBe(10);
      const movements = await prisma.inventoryMovement.findMany({
        where: { orderId: order.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(movements.map((m) => [m.reason, m.quantityDelta])).toEqual([
        ['SALE', -2],
        ['CANCELLATION', 2],
      ]);
    });

    it('un pedido pagado no se cancela: se reembolsa', async () => {
      const id = await paidOrder();
      await api()
        .post(`/v1/manage/orders/${id}/cancel`)
        .set(auth(operator))
        .send({ reason: 'Ya no lo quiere' })
        .expect(409);
    });

    it('busca por código o correo y ordena la cola de pagados del más antiguo al más nuevo', async () => {
      const first = await paidOrder();
      const second = await paidOrder();
      const queue = (
        await api().get('/v1/manage/orders?status=PAID').set(auth(operator))
      ).body;
      expect(queue.items.map((o: { id: string }) => o.id)).toEqual([
        first,
        second,
      ]);
      const code = (
        await api().get(`/v1/manage/orders/${second}`).set(auth(operator))
      ).body.code;
      const byCode = (
        await api()
          .get(`/v1/manage/orders?q=${code.toLowerCase()}`)
          .set(auth(operator))
      ).body;
      expect(byCode.items.map((o: { id: string }) => o.id)).toEqual([second]);
      const email = (
        await prisma.user.findUniqueOrThrow({ where: { id: userId } })
      ).email;
      expect(
        (
          await api()
            .get(`/v1/manage/orders?q=${encodeURIComponent(email)}`)
            .set(auth(operator))
        ).body.total,
      ).toBe(2);
      await api()
        .get('/v1/manage/orders?status=ENVIADO')
        .set(auth(operator))
        .expect(400);
    });
  });

  // ---------- Vencimiento automático ----------

  describe('cancelación a las 2 horas', () => {
    it('cancela los vencidos sin reporte, devuelve el stock una sola vez', async () => {
      const overdue = await placeOrder();
      const reported = await placeOrder();
      await reportedPayment(reported.id);
      const fresh = await placeOrder();
      const past = new Date(Date.now() - 1000);
      await prisma.order.updateMany({
        where: { id: { in: [overdue.id, reported.id] } },
        data: { paymentDueAt: past },
      });

      const orders = app.get(OrdersService);
      expect(await orders.expireOverdue()).toBe(1);
      expect(await orders.expireOverdue()).toBe(0);

      const status = async (id: string) =>
        (await prisma.order.findUniqueOrThrow({ where: { id } })).status;
      expect(await status(overdue.id)).toBe('CANCELLED');
      expect(await status(reported.id)).toBe('PAYMENT_REPORTED'); // ya reportó: lo decide el equipo
      expect(await status(fresh.id)).toBe('PENDING_PAYMENT');
      expect(await stockOf(variant.cheap)).toBe(10 - 4);
      const history = await prisma.orderStatusHistory.findFirstOrThrow({
        where: { orderId: overdue.id, toStatus: 'CANCELLED' },
      });
      expect(history).toMatchObject({
        changedById: null,
        note: 'No se reportó el pago a tiempo',
      });
    });
  });

  // ---------- Ajustes de stock ----------

  it('un ajuste manual de stock deja un movimiento de inventario', async () => {
    const { token: catalog } = await loginAs(app, prisma, ['CATALOG_MANAGER']);
    await api()
      .patch(`/v1/manage/variants/${variant.cheap}`)
      .set(auth(catalog))
      .send({ stock: 25 })
      .expect(200);
    await api()
      .patch(`/v1/manage/variants/${variant.cheap}`)
      .set(auth(catalog))
      .send({ priceUsdCents: 900 })
      .expect(200);
    const movements = await prisma.inventoryMovement.findMany({
      where: { variantId: variant.cheap },
    });
    expect(movements).toEqual([
      expect.objectContaining({ quantityDelta: 15, reason: 'ADJUSTMENT' }),
    ]);
  });
});
