import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import type { Prisma } from '../src/generated/prisma/client.js';
import type { PrismaService } from '../src/prisma/prisma.service.js';
import { createTestApp, loginAs, resetDb } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;

// Combos y cupones: el equipo de catálogo los crea, el carrito descuenta los
// combos completos y el checkout aplica un cupón con todas sus reglas.
describe('Combos y cupones (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  let customer: { id: string; token: string };
  let manager: { id: string; token: string };
  let variant: { champu: string; toalla: string; collar: string; off: string };
  let zoneId: string;
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
    const category = await prisma.category.create({
      data: { name: 'Perros', slug: 'perros' },
    });
    const product = (
      name: string,
      slug: string,
      variants: Prisma.ProductVariantCreateWithoutProductInput[],
    ) =>
      prisma.product.create({
        data: {
          name,
          slug,
          description: '-',
          categoryId: category.id,
          variants: { create: variants },
        },
        include: { variants: true },
      });
    const champu = await product('Champú', 'champu', [
      { sku: 'CHA-1', name: '500 ml', priceUsdCents: 1000, stock: 10 },
      {
        sku: 'CHA-OFF',
        name: 'Retirado',
        priceUsdCents: 900,
        stock: 10,
        isActive: false,
      },
    ]);
    const toalla = await product('Toalla', 'toalla', [
      { sku: 'TOA-1', name: 'Grande', priceUsdCents: 800, stock: 3 },
    ]);
    const collar = await product('Collar', 'collar', [
      { sku: 'COL-1', name: 'M', priceUsdCents: 2000, stock: 10 },
    ]);
    variant = {
      champu: champu.variants.find((v) => v.sku === 'CHA-1')!.id,
      off: champu.variants.find((v) => v.sku === 'CHA-OFF')!.id,
      toalla: toalla.variants[0].id,
      collar: collar.variants[0].id,
    };
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
    manager = await loginAs(app, prisma, ['CATALOG_MANAGER']);
  });

  const kit = (overrides: object = {}) => ({
    name: 'Kit de baño',
    description: 'Champú y toalla para el baño en casa',
    priceUsdCents: 1500,
    items: [
      { sku: 'CHA-1', quantity: 1 },
      { sku: 'TOA-1', quantity: 1 },
    ],
    ...overrides,
  });
  const createCombo = (body: object = kit(), token = manager.token) =>
    api().post('/v1/manage/combos').set(auth(token)).send(body);
  const createCoupon = (body: object, token = manager.token) =>
    api()
      .post('/v1/manage/coupons')
      .set(auth(token))
      .send({ description: 'Promo de prueba', ...body });
  const addToCart = (
    variantId: string,
    quantity: number,
    token = customer.token,
  ) =>
    api()
      .post('/v1/cart/items')
      .set(auth(token))
      .send({ variantId, quantity })
      .expect(201);
  async function addressFor(token: string) {
    const res = await api()
      .post('/v1/addresses')
      .set(auth(token))
      .send({
        recipientName: 'Ana Pérez',
        phone: '0412-1234567',
        state: 'Distrito Capital',
        city: 'Caracas',
        line1: 'Av. Urdaneta, edificio Sol',
      })
      .expect(201);
    return res.body.id as string;
  }
  const checkout = async (token: string, couponCode?: string) =>
    api()
      .post('/v1/orders')
      .set(auth(token))
      .send({
        addressId: await addressFor(token),
        shippingZoneId: zoneId,
        paymentMethodId: methodId,
        acceptTerms: true,
        couponCode,
      });

  describe('combos', () => {
    it('el equipo crea un combo y la tienda lo muestra con el ahorro', async () => {
      const res = await createCombo().expect(201);
      expect(res.body).toMatchObject({
        slug: 'kit-de-bano',
        priceUsdCents: 1500,
        regularUsdCents: 1800,
        savingsUsdCents: 300,
        available: 3, // la toalla tiene 3
        isActive: true,
      });
      const list = await api().get('/v1/combos').expect(200);
      expect(list.body).toHaveLength(1);
      expect(
        list.body[0].items.map((i: { sku: string }) => i.sku).sort(),
      ).toEqual(['CHA-1', 'TOA-1']);
      await api().get('/v1/combos/kit-de-bano').expect(200);
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'combo.created' },
      });
      expect(audit?.actorId).toBe(manager.id);
    });

    it('valida precio, productos y permisos', async () => {
      await createCombo(kit(), customer.token).expect(403);
      const cases: [object, RegExp][] = [
        [kit({ priceUsdCents: 1800 }), /costar menos .*18\.00 \$/],
        [kit({ priceUsdCents: 0 }), /mayor que 0/],
        [
          kit({ items: [{ sku: 'CHA-1', quantity: 1 }] }),
          /al menos 2 unidades/,
        ],
        [
          kit({
            items: [
              { sku: 'CHA-1', quantity: 1 },
              { sku: 'CHA-1', quantity: 1 },
            ],
          }),
          /repetida/,
        ],
        [
          kit({
            items: [
              { sku: 'cha-off', quantity: 1 },
              { sku: 'TOA-1', quantity: 1 },
            ],
          }),
          /No está a la venta o no existe: CHA-OFF/,
        ],
        [kit({ description: 'corto' }), /mínimo 10/],
        [kit({ items: [] }), /necesita productos/],
      ];
      for (const [body, message] of cases) {
        const res = await createCombo(body).expect(400);
        expect(JSON.stringify(res.body)).toMatch(message);
      }
      await createCombo().expect(201);
      await createCombo().expect(409); // mismo slug
      // Dos unidades de lo mismo sí es un combo.
      await createCombo(
        kit({
          name: 'Dos champús',
          priceUsdCents: 1700,
          items: [{ sku: 'CHA-1', quantity: 2 }],
        }),
      ).expect(201);
    });

    it('se oculta si se desactiva, si un producto sale de la venta o si deja de ahorrar', async () => {
      const { body: combo } = await createCombo().expect(201);
      await api()
        .patch(`/v1/manage/combos/${combo.id}`)
        .set(auth(manager.token))
        .send({ isActive: false })
        .expect(200);
      await api().get('/v1/combos/kit-de-bano').expect(404);
      await api()
        .patch(`/v1/manage/combos/${combo.id}`)
        .set(auth(manager.token))
        .send({ isActive: true })
        .expect(200);
      await prisma.productVariant.update({
        where: { id: variant.toalla },
        data: { isActive: false },
      });
      expect((await api().get('/v1/combos').expect(200)).body).toHaveLength(0);
      const manage = await api()
        .get('/v1/manage/combos')
        .set(auth(manager.token))
        .expect(200);
      expect(manage.body.items[0]).toMatchObject({
        isActive: true,
        sellable: false,
      });
      await prisma.productVariant.update({
        where: { id: variant.toalla },
        data: { isActive: true, priceUsdCents: 400 },
      });
      // 10 + 4 = 14 $ < 15 $: ya no conviene, no se ofrece.
      expect((await api().get('/v1/combos').expect(200)).body).toHaveLength(0);
      // Y al editar el precio vuelve a exigir que ahorre.
      await api()
        .patch(`/v1/manage/combos/${combo.id}`)
        .set(auth(manager.token))
        .send({ priceUsdCents: 1450 })
        .expect(400);
      const ok = await api()
        .patch(`/v1/manage/combos/${combo.id}`)
        .set(auth(manager.token))
        .send({
          priceUsdCents: 1200,
          items: [
            { sku: 'CHA-1', quantity: 1 },
            { sku: 'TOA-1', quantity: 1 },
          ],
        })
        .expect(200);
      expect(ok.body.savingsUsdCents).toBe(200);
      await api()
        .patch(`/v1/manage/combos/${combo.id}`)
        .set(auth(manager.token))
        .send({})
        .expect(400);
    });

    it('se añade completo al carrito y descuenta cada combo completo', async () => {
      await createCombo().expect(201);
      let cart = await api()
        .post('/v1/cart/combos/kit-de-bano')
        .set(auth(customer.token))
        .send({ quantity: 2 })
        .expect(201);
      expect(
        cart.body.items.map((i: { quantity: number }) => i.quantity),
      ).toEqual([2, 2]);
      expect(cart.body).toMatchObject({
        subtotalUsdCents: 3600,
        comboDiscountUsdCents: 600,
        itemsTotalUsdCents: 3000,
        combos: [{ name: 'Kit de baño', count: 2, savingsUsdCents: 600 }],
      });
      // Un champú suelto más no arma otro combo.
      cart = await addToCart(variant.champu, 1);
      expect(cart.body.comboDiscountUsdCents).toBe(600);
      // Quitar la toalla rompe los combos.
      cart = await api()
        .delete(`/v1/cart/items/${variant.toalla}`)
        .set(auth(customer.token))
        .expect(200);
      expect(cart.body).toMatchObject({ comboDiscountUsdCents: 0, combos: [] });
    });

    it('no añade nada si alguna presentación no alcanza', async () => {
      await createCombo().expect(201);
      await addToCart(variant.toalla, 2);
      const res = await api()
        .post('/v1/cart/combos/kit-de-bano')
        .set(auth(customer.token))
        .send({ quantity: 2 })
        .expect(409);
      expect(res.body.message).toMatch(/Solo hay 3 disponibles de Toalla/);
      const cart = await api()
        .get('/v1/cart')
        .set(auth(customer.token))
        .expect(200);
      expect(cart.body.items).toHaveLength(1); // el champú no entró
      await api()
        .post('/v1/cart/combos/kit-de-bano')
        .set(auth(customer.token))
        .send({ quantity: 6 })
        .expect(400);
      await api()
        .post('/v1/cart/combos/no-existe')
        .set(auth(customer.token))
        .send({})
        .expect(404);
      await api().post('/v1/cart/combos/kit-de-bano').send({}).expect(401);
    });

    it('el pedido guarda el descuento del combo y el envío gratis se mide con lo pagado', async () => {
      await createCombo().expect(201);
      // 2 kits: 36 $ de lista, 30 $ con combo → envío gratis (desde 25 $).
      await api()
        .post('/v1/cart/combos/kit-de-bano')
        .set(auth(customer.token))
        .send({ quantity: 2 })
        .expect(201);
      const res = await checkout(customer.token);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        subtotalUsdCents: 3600,
        comboDiscountUsdCents: 600,
        couponDiscountUsdCents: 0,
        shippingUsdCents: 0,
        totalUsdCents: 3000,
        totalCharged: '30',
      });
    });
  });

  describe('cupones', () => {
    it('el equipo crea cupones; el código se normaliza y no se repite', async () => {
      const res = await createCoupon({
        code: ' verano-10 ',
        type: 'PERCENT',
        value: 10,
      }).expect(201);
      expect(res.body).toMatchObject({
        code: 'VERANO-10',
        perUserLimit: 1,
        isActive: true,
        createdById: manager.id,
      });
      await createCoupon({
        code: 'VERANO-10',
        type: 'FIXED',
        value: 500,
      }).expect(409);
      await createCoupon(
        { code: 'otro', type: 'PERCENT', value: 10 },
        customer.token,
      ).expect(403);
      const cases: [object, RegExp][] = [
        [{ code: 'A', type: 'PERCENT', value: 10 }, /de 3 a 30/],
        [{ code: 'CON ESPACIO', type: 'PERCENT', value: 10 }, /de 3 a 30/],
        [{ code: 'MUCHO', type: 'PERCENT', value: 95 }, /90 %/],
        [{ code: 'CERO', type: 'FIXED', value: 0 }, /mayor que 0/],
        [
          { code: 'TOPE', type: 'FIXED', value: 500, maxDiscountUsdCents: 300 },
          /solo para porcentajes/,
        ],
        [
          {
            code: 'FECHAS',
            type: 'FIXED',
            value: 500,
            startsAt: '2026-12-10',
            endsAt: '2026-12-01',
          },
          /después del inicio/,
        ],
        [{ code: 'TIPO', type: 'REGALO', value: 5 }, /porcentaje o monto fijo/],
        [
          { code: 'USOS', type: 'FIXED', value: 500, maxRedemptions: 0 },
          /Al menos 1 uso/,
        ],
      ];
      for (const [body, message] of cases) {
        const bad = await createCoupon(body).expect(400);
        expect(JSON.stringify(bad.body)).toMatch(message);
      }
      expect(
        await prisma.auditLog.count({ where: { action: 'coupon.created' } }),
      ).toBe(1);
    });

    it('se edita sin cambiar tipo ni valor', async () => {
      const { body: c } = await createCoupon({
        code: 'EDITA',
        type: 'PERCENT',
        value: 10,
      }).expect(201);
      const patch = (body: object) =>
        api()
          .patch(`/v1/manage/coupons/${c.id}`)
          .set(auth(manager.token))
          .send(body);
      await patch({ type: 'FIXED', value: 9000 }).expect(400); // no hay cambios válidos
      const res = await patch({
        isActive: false,
        maxRedemptions: 50,
        maxDiscountUsdCents: 500,
      }).expect(200);
      expect(res.body).toMatchObject({
        type: 'PERCENT',
        value: 10,
        isActive: false,
        maxRedemptions: 50,
      });
      await patch({
        startsAt: '2026-12-10T00:00:00Z',
        endsAt: '2026-12-01T00:00:00Z',
      }).expect(400);
      await api()
        .patch('/v1/manage/coupons/00000000-0000-4000-8000-000000000000')
        .set(auth(manager.token))
        .send({ isActive: true })
        .expect(404);
      const list = await api()
        .get('/v1/manage/coupons?active=false')
        .set(auth(manager.token))
        .expect(200);
      expect(list.body.items).toHaveLength(1);
    });

    it('se prueba en el carrito con cada motivo de rechazo', async () => {
      await addToCart(variant.collar, 1); // 20 $
      const now = Date.now();
      await createCoupon({
        code: 'APAGADO',
        type: 'FIXED',
        value: 500,
        isActive: false,
      }).expect(201);
      await createCoupon({
        code: 'FUTURO',
        type: 'FIXED',
        value: 500,
        startsAt: new Date(now + DAY).toISOString(),
      }).expect(201);
      await createCoupon({
        code: 'VENCIDO',
        type: 'FIXED',
        value: 500,
        endsAt: new Date(now - 1000).toISOString(),
      }).expect(201);
      await createCoupon({
        code: 'MINIMO',
        type: 'FIXED',
        value: 500,
        minSubtotalUsdCents: 3000,
      }).expect(201);
      const reasons: [string, RegExp][] = [
        ['NOEXISTE', /no existe o ya no está activo/],
        ['APAGADO', /no existe o ya no está activo/],
        ['FUTURO', /todavía no está vigente/],
        ['VENCIDO', /ya venció/],
        ['MINIMO', /desde 30\.00 \$/],
        ['x', /de 3 a 30/],
      ];
      for (const [code, message] of reasons) {
        const res = await api()
          .get(`/v1/cart?coupon=${code}`)
          .set(auth(customer.token))
          .expect(400);
        expect(JSON.stringify(res.body)).toMatch(message);
      }
      await createCoupon({ code: 'DIEZ', type: 'PERCENT', value: 10 }).expect(
        201,
      );
      const ok = await api()
        .get('/v1/cart?coupon=diez')
        .set(auth(customer.token))
        .expect(200);
      expect(ok.body).toMatchObject({
        coupon: { code: 'DIEZ', discountUsdCents: 200 },
        itemsTotalUsdCents: 1800,
      });
    });

    it('el cupón se calcula después de los combos y respeta el tope', async () => {
      await createCombo().expect(201);
      await api()
        .post('/v1/cart/combos/kit-de-bano')
        .set(auth(customer.token))
        .send({ quantity: 2 })
        .expect(201);
      await addToCart(variant.collar, 1); // 36 + 20 = 56 $; combos −6 → 50 $
      await createCoupon({
        code: 'VEINTE',
        type: 'PERCENT',
        value: 20,
        maxDiscountUsdCents: 800,
      }).expect(201);
      const res = await checkout(customer.token, 'veinte');
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        subtotalUsdCents: 5600,
        comboDiscountUsdCents: 600,
        couponDiscountUsdCents: 800, // 20 % de 50 $ = 10 $, con tope de 8 $
        couponCode: 'VEINTE',
        shippingUsdCents: 0,
        totalUsdCents: 4200,
      });
      const audit = await prisma.auditLog.findFirst({
        where: { action: 'order.created' },
      });
      expect(audit?.metadata).toMatchObject({ couponCode: 'VEINTE' });
    });

    it('un monto fijo no deja los productos en negativo y el envío se cobra si no llega al mínimo', async () => {
      await addToCart(variant.champu, 1); // 10 $
      await createCoupon({ code: 'QUINCE', type: 'FIXED', value: 1500 }).expect(
        201,
      );
      const res = await checkout(customer.token, 'QUINCE');
      expect(res.body).toMatchObject({
        couponDiscountUsdCents: 1000,
        shippingUsdCents: 300,
        totalUsdCents: 300,
      });
    });

    it('un cupón inválido no crea el pedido ni toca el stock', async () => {
      await addToCart(variant.champu, 2);
      const res = await checkout(customer.token, 'NOEXISTE');
      expect(res.status).toBe(400);
      expect(await prisma.order.count()).toBe(0);
      const v = await prisma.productVariant.findUniqueOrThrow({
        where: { id: variant.champu },
      });
      expect(v.stock).toBe(10);
      const cart = await api()
        .get('/v1/cart')
        .set(auth(customer.token))
        .expect(200);
      expect(cart.body.items).toHaveLength(1);
    });

    it('límite por cliente: se libera si el pedido se cancela', async () => {
      await createCoupon({ code: 'UNAVEZ', type: 'FIXED', value: 200 }).expect(
        201,
      );
      await addToCart(variant.champu, 1);
      const first = await checkout(customer.token, 'UNAVEZ');
      expect(first.status).toBe(201);
      await addToCart(variant.champu, 1);
      const again = await checkout(customer.token, 'UNAVEZ');
      expect(again.status).toBe(400);
      expect(again.body.message).toBe('Ya usaste este cupón');
      await api()
        .post(`/v1/orders/${first.body.id}/cancel`)
        .set(auth(customer.token))
        .expect(201);
      expect((await checkout(customer.token, 'UNAVEZ')).status).toBe(201);
      const list = await api()
        .get('/v1/manage/coupons')
        .set(auth(manager.token))
        .expect(200);
      expect(list.body.items[0]).toMatchObject({
        uses: 1,
        discountedUsdCents: 200,
      });
    });

    it('límite total: dos compras a la vez no pasan de los usos', async () => {
      await createCoupon({
        code: 'UNO',
        type: 'FIXED',
        value: 200,
        maxRedemptions: 1,
      }).expect(201);
      const other = await loginAs(app, prisma, []);
      await addToCart(variant.champu, 1);
      await addToCart(variant.champu, 1, other.token);
      const [a, b] = await Promise.all([
        checkout(customer.token, 'UNO'),
        checkout(other.token, 'UNO'),
      ]);
      expect([a.status, b.status].sort((x, y) => x - y)).toEqual([201, 400]);
      expect([a.body.message, b.body.message]).toContain(
        'Ese cupón ya se agotó',
      );
      expect(await prisma.order.count({ where: { couponCode: 'UNO' } })).toBe(
        1,
      );
    });

    it('la devolución reembolsa lo pagado por el producto, no el precio de lista', async () => {
      await createCoupon({ code: 'MITAD', type: 'PERCENT', value: 50 }).expect(
        201,
      );
      await addToCart(variant.collar, 2); // 40 $ → 20 $ con el cupón
      const { body: order } = await checkout(customer.token, 'MITAD');
      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'DELIVERED', deliveredAt: new Date() },
      });
      const item = order.items[0].id;
      const res = await api()
        .post(`/v1/orders/${order.id}/returns`)
        .set(auth(customer.token))
        .send({
          reason: 'No le quedó al perro',
          items: [{ orderItemId: item, quantity: 1 }],
        })
        .expect(201);
      const created = await prisma.returnRequest.findFirstOrThrow({
        where: { orderId: order.id },
      });
      expect(created.refundUsdCents).toBe(1000);
      expect(res.status).toBe(201);
    });
  });
});
