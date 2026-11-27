// Prueba de contrato: la app contra la API real (no la falsa de test/).
//
// Comprueba que los modelos leen el JSON verdadero y que la sesión, los
// montos y los errores se comportan como la app espera. Necesita la API
// corriendo con datos de ejemplo (SEED_DEMO=true):
//
//   CONTRACT_API_URL=http://localhost:3001/v1 flutter test contract
//
// Los cupones y el combo de la prueba los crea contract/promotions.sql (la API
// los crea solo desde el panel); sin ellos, esa prueba falla con un aviso.
//
// Los puntos se ganan al entregar un pedido (lo hace el equipo desde el panel).
// Para probar canjearlos, la prueba se abona 500 con un ajuste directo en la
// base si defines CONTRACT_DATABASE_URL (necesita psql); sin ella, prueba solo
// lo que se puede sin saldo.
//
// Sin CONTRACT_API_URL se salta. Vive fuera de test/ para que no cargue
// flutter_test_config.dart: el binding de widgets bloquea la red real.
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:petbf/core/api_client.dart';
import 'package:petbf/core/money.dart';
import 'package:petbf/core/petbf_api.dart';
import 'package:petbf/core/proof.dart';
import 'package:petbf/core/token_store.dart';
import 'package:petbf/models/catalog.dart';
import 'package:petbf/models/points.dart';
import 'package:petbf/models/reviews.dart';
import 'package:petbf/models/shop.dart';

final baseUrl = Platform.environment['CONTRACT_API_URL'];
final databaseUrl = Platform.environment['CONTRACT_DATABASE_URL'];

void main() {
  final skip = baseUrl == null ? 'Define CONTRACT_API_URL' : null;
  final stamp = DateTime.now().microsecondsSinceEpoch;
  final email = 'contrato.$stamp@petbf.test';
  const password = 'clave-de-contrato-1';

  late http.Client httpClient;
  late MemoryTokenStore store;
  late Duration clockOffset;
  late ApiClient client;
  late PetbfApi api;

  setUpAll(() {
    httpClient = http.Client();
    store = MemoryTokenStore();
    clockOffset = Duration.zero;
    client = ApiClient(
      baseUrl: baseUrl ?? '',
      httpClient: httpClient,
      tokenStore: store,
      now: () => DateTime.now().add(clockOffset),
    );
    api = PetbfApi(client);
  });
  tearDownAll(() => httpClient.close());

  Future<ApiException> failure(Future<Object?> future) async {
    try {
      await future;
    } on ApiException catch (e) {
      return e;
    }
    fail('Se esperaba un error de la API');
  }

  group('API real', skip: skip, () {
    test('registro, sesión y errores de cuenta', () async {
      final user = await api.register(
        email: ' ${email.toUpperCase()} ',
        password: password,
        firstName: ' Contrato ',
        lastName: 'Móvil',
        phone: '0412-1234567',
      );
      expect(user.email, email);
      expect(user.firstName, 'Contrato');
      expect(user.roles, ['CUSTOMER']);
      expect((await api.me()).id, user.id);

      final dup = await failure(
        PetbfApi(
          ApiClient(
            baseUrl: baseUrl!,
            httpClient: httpClient,
            tokenStore: MemoryTokenStore(),
          ),
        ).register(
          email: email,
          password: password,
          firstName: 'Otra',
          lastName: 'Vez',
        ),
      );
      expect(dup.status, 409);
      expect(dup.message, 'Ya existe una cuenta con ese correo');

      final wrong = await failure(
        PetbfApi(
          ApiClient(
            baseUrl: baseUrl!,
            httpClient: httpClient,
            tokenStore: MemoryTokenStore(),
          ),
        ).login(email: email, password: 'no-es-esta'),
      );
      expect(wrong.status, 401);
      expect(wrong.message, 'Correo o contraseña incorrectos');
    });

    test('renueva el token vencido sin cerrar la sesión', () async {
      final before = store.tokens!;
      // La app cree que pasaron 16 minutos: el token de acceso venció.
      clockOffset = const Duration(minutes: 16);
      expect((await api.me()).email, email);
      final after = store.tokens!;
      // El token de acceso puede salir idéntico si se firma en el mismo
      // segundo; el de renovación siempre rota.
      expect(after.refreshToken, isNot(before.refreshToken));
      clockOffset = Duration.zero;
    });

    test('catálogo, filtros y detalle', () async {
      final categories = await api.categories();
      expect(categories, isNotEmpty);

      final page = await api.products(const ProductQuery());
      expect(page.items, isNotEmpty);
      expect(page.total, greaterThanOrEqualTo(page.items.length));

      final search = await api.products(const ProductQuery(search: 'arena'));
      expect(
        search.items.every((p) => p.name.toLowerCase().contains('arena')),
        isTrue,
      );

      final cats = await api.products(const ProductQuery(species: Species.cat));
      expect(cats.items.every((p) => p.species.contains(Species.cat)), isTrue);

      final byName = await api.products(
        const ProductQuery(sort: ProductSort.name),
      );
      final names = [for (final p in byName.items) p.name.toLowerCase()];
      expect(names, [...names]..sort());

      final detail = await api.product(page.items.first.slug);
      expect(detail.variants, isNotEmpty);

      final missing = await failure(api.product('no-existe-$stamp'));
      expect(missing.isNotFound, isTrue);
    });

    test('reseñas, valoración y recomendados', () async {
      final card = (await api.products(const ProductQuery())).items.first;
      // La tarjeta y la ficha traen la valoración.
      expect(card.rating.count, greaterThanOrEqualTo(0));
      final detail = await api.product(card.slug);
      expect(detail.rating.count, card.rating.count);

      final page = await api.reviews(card.slug, sort: ReviewSort.best);
      expect(page.pageSize, 10);
      expect(page.summary.count, page.total);
      expect(page.summary.distribution, hasLength(5));
      expect(page.summary.average, detail.rating.average);

      // La cuenta nueva no recibió nada: no puede reseñar.
      final mine = await api.myReview(card.slug);
      expect(mine.canReview, isFalse);
      expect(mine.review, isNull);
      final denied = await failure(
        api.saveReview(
          card.slug,
          const ReviewInput(rating: 5, body: 'Prueba de contrato de reseña'),
        ),
      );
      expect(denied.status, 403);
      expect(
        denied.message,
        'Solo puedes reseñar productos que compraste y ya recibiste',
      );
      final invalid = await failure(
        api.saveReview(card.slug, const ReviewInput(rating: 6, body: 'corto')),
      );
      expect(invalid.status, 400);
      expect(invalid.message, isNot(contains('rating')));
      final none = await failure(api.deleteReview(card.slug));
      expect(none.status, 404);
      expect(none.message, 'No tienes una reseña de este producto');

      final recs = await api.recommendations(card.slug);
      expect(recs.length, lessThanOrEqualTo(4));
      expect(recs.every((p) => p.slug != card.slug), isTrue);
    });

    test('especies aceptadas para animales vivos', () async {
      final species = await api.animalSpecies();
      expect(species, containsAll([Species.dog, Species.cat]));
    });

    test('animales en venta y en adopción', () async {
      final sale = await api.animals(
        const AnimalQuery(listingType: ListingType.sale),
      );
      final adoption = await api.animals(
        const AnimalQuery(listingType: ListingType.adoption),
      );
      expect(
        sale.items.every((a) => a.listingType == ListingType.sale),
        isTrue,
      );
      expect(
        adoption.items.every((a) => a.listingType == ListingType.adoption),
        isTrue,
      );
      final any = [...sale.items, ...adoption.items];
      expect(any, isNotEmpty);
      expect((await api.animal(any.first.slug)).id, any.first.id);
    });

    test('carrito, checkout, reporte de pago y cancelación', () async {
      final rates = await api.rates();
      expect(rates.usdVes, isNotNull);

      // Un producto con existencia.
      final page = await api.products(const ProductQuery());
      final card = page.items.firstWhere((p) => p.inStock);
      final variant = (await api.product(card.slug)).variants
          .firstWhere((v) => v.inStock);

      var cart = await api.addToCart(variant.id, 1);
      expect(cart.items.single.variantId, variant.id);
      cart = await api.setQuantity(variant.id, 1);
      expect(cart.canCheckout, isTrue);
      expect(cart.subtotalUsdCents, variant.priceUsdCents);

      final address = await api.createAddress(
        const AddressInput(
          recipientName: 'Contrato Móvil',
          phone: '0412-1234567',
          state: 'Miranda',
          city: 'Los Teques',
          municipality: '',
          line1: 'Calle 1, casa 2',
          referencePoint: '',
          isDefault: false,
        ),
      );
      expect(address.isDefault, isTrue); // La primera queda predeterminada.
      expect(address.municipality, isNull);

      final zone = (await api.shippingZones()).firstWhere(
        (z) => z.states.contains('Miranda'),
      );
      final method = (await api.paymentMethods()).firstWhere(
        (m) => m.currency == Currency.ves,
      );

      final order = await api.checkout(
        addressId: address.id,
        shippingZoneId: zone.id,
        paymentMethodId: method.id,
      );
      expect(order.status, OrderStatus.pendingPayment);
      expect(order.items.single.quantity, 1);
      expect(order.shippingUsdCents, zone.costFor(cart.subtotalUsdCents));
      // El monto en Bs que calcula la app es el mismo que fija la API.
      expect(
        decimalToCents(order.totalCharged),
        chargeCents(
          order.totalUsdCents,
          Currency.ves,
          usdVes: order.usdVesRate,
          eurVes: rates.eurVes,
        ),
      );
      expect((await api.cart()).items, isEmpty);

      final list = await api.orders();
      expect(list.items.first.id, order.id);
      expect(list.items.first.itemCount, 1);

      // Referencia inválida: la API responde 400 con el campo delante.
      final bad = await failure(
        client.post(
          '/orders/${order.id}/payments',
          body: {
            'reference': 'x',
            'amount': order.totalCharged,
            'paidAt': DateTime.now().toUtc().toIso8601String(),
          },
        ),
      );
      expect(bad.status, 400);
      expect(bad.message, isNot(startsWith('reference')));

      final reported = await api.reportPayment(
        order.id,
        PaymentInput(
          reference: 'CT-$stamp',
          amount: order.totalCharged,
          paidAt: DateTime.now(),
          originBank: 'Banco de prueba',
        ),
      );
      expect(reported.status, OrderStatus.paymentReported);
      expect(reported.payments.single.status, PaymentStatus.reported);
      expect(reported.payments.single.proof, isNull);
      expect(reported.returns, isEmpty);
      expect(reported.returnUntil, isNull);

      // Comprobante: la API mira el contenido, no el nombre.
      final paymentId = reported.payments.single.id;
      final png = Uint8List(2048)
        ..setAll(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      final proof = await api.attachProof(
        order.id,
        paymentId,
        checkProof('pago.png', png),
      );
      expect(proof.contentType, 'image/png');
      expect(proof.sizeBytes, png.length);
      final seen = (await api.order(order.id)).payments.single.proof!;
      expect(seen.sizeBytes, png.length);
      expect(await api.proofFile(order.id, paymentId), png);
      final fake = await failure(
        api.attachProof(
          order.id,
          paymentId,
          PickedProof(
            name: 'falso.png',
            bytes: Uint8List(64),
            contentType: 'image/png',
          ),
        ),
      );
      expect(fake.status, 400);
      expect(fake.message, proofWrongTypeMessage);

      // Sin entregar no se puede devolver.
      final early = await failure(
        api.requestReturn(
          order.id,
          reason: 'Prueba de contrato de devolución',
          items: [ReturnLine(orderItemId: order.items.single.id, quantity: 1)],
        ),
      );
      expect(early.status, 409);
      expect(early.message, 'Solo se devuelve un pedido que ya te entregamos');

      final again = await failure(
        api.reportPayment(
          order.id,
          PaymentInput(
            reference: 'CT2-$stamp',
            amount: order.totalCharged,
            paidAt: DateTime.now(),
          ),
        ),
      );
      expect(again.status, 409);

      // Un segundo pedido que el cliente cancela.
      await api.addToCart(variant.id, 1);
      final second = await api.checkout(
        addressId: address.id,
        shippingZoneId: zone.id,
        paymentMethodId: method.id,
      );
      expect(second.canCancel, isTrue);
      final cancelled = await api.cancelOrder(second.id);
      expect(cancelled.status, OrderStatus.cancelled);
      expect((await api.order(second.id)).canReportPayment, isFalse);

      final other = await failure(
        api.order('00000000-0000-0000-0000-000000000000'),
      );
      expect(other.isNotFound, isTrue);
    });

    test('combos y cupones: carrito, pedido y cancelación', () async {
      final combo = (await api.combos()).firstWhere(
        (c) => c.slug == 'combo-de-contrato',
        orElse: () => fail('Falta el combo: corre contract/promotions.sql'),
      );
      expect(combo.priceUsdCents, 4500);
      expect(combo.regularUsdCents, 4950);
      expect(combo.savingsUsdCents, 450);
      expect(combo.items, hasLength(2));
      expect(combo.items.every((i) => i.quantity == 1), isTrue);
      expect(combo.available, greaterThan(0));
      expect(combo.maxToAdd, inInclusiveRange(1, 5));
      final missing = await failure(api.addCombo('no-existe-$stamp', 1));
      expect(missing.isNotFound, isTrue);
      expect(missing.message, 'Combo no encontrado');

      // Un cupón que no aplica da el motivo exacto (sin el campo delante).
      final cart = await api.addCombo(combo.slug, 1);
      expect(cart.combos.single.count, 1);
      expect(cart.combos.single.savingsUsdCents, 450);
      expect(cart.comboDiscountUsdCents, 450);
      expect(cart.subtotalUsdCents, 4950);
      expect(cart.itemsTotalUsdCents, 4500);
      expect(cart.coupon, isNull);
      expect(cart.canCheckout, isTrue);
      Future<void> rejects(String code, int status, Object message) async {
        final e = await failure(api.cart(coupon: code));
        expect(e.status, status, reason: code);
        expect(e.message, message, reason: code);
      }

      await rejects(
        'NO-EXISTE-X',
        400,
        'Ese cupón no existe o ya no está activo',
      );
      await rejects('CONTRATO-VENCIDO', 400, 'Ese cupón ya venció');
      await rejects(
        'CONTRATO-MIN',
        400,
        startsWith('Ese cupón aplica en compras desde'),
      );
      await rejects('AB', 400, isNot(startsWith('coupon')));

      // Cupones válidos: porcentaje, con tope y de monto fijo (nunca pasa de
      // lo que se paga por los productos).
      final tenPercent = await api.cart(coupon: ' contrato-10 ');
      expect(tenPercent.coupon!.code, 'CONTRATO-10');
      expect(tenPercent.coupon!.discountUsdCents, 450); // 10 % de 45,00
      expect(tenPercent.itemsTotalUsdCents, 4050);
      final capped = await api.cart(coupon: 'CONTRATO-TOPE');
      expect(capped.coupon!.discountUsdCents, 500);
      final fixed = await api.cart(coupon: 'CONTRATO-FIJO');
      expect(fixed.coupon!.discountUsdCents, 4500);
      expect(fixed.itemsTotalUsdCents, 0);

      final address = (await api.addresses()).first;
      final zone = (await api.shippingZones()).firstWhere(
        (z) => z.states.contains(address.state),
      );
      final method = (await api.paymentMethods()).firstWhere(
        (m) => m.currency == Currency.ves,
      );
      final rates = await api.rates();
      final order = await api.checkout(
        addressId: address.id,
        shippingZoneId: zone.id,
        paymentMethodId: method.id,
        couponCode: 'CONTRATO-10',
      );
      expect(order.subtotalUsdCents, 4950);
      expect(order.comboDiscountUsdCents, 450);
      expect(order.couponDiscountUsdCents, 450);
      expect(order.couponCode, 'CONTRATO-10');
      // Con 40,50 $ por los productos el envío es gratis (se mide con lo pagado).
      expect(order.shippingUsdCents, 0);
      expect(order.totalUsdCents, 4050);
      // La app estima el reembolso como la API lo calcula.
      expect(order.refundFor(1450), 1450 * 4050 ~/ 4950);
      expect(
        decimalToCents(order.totalCharged),
        chargeCents(
          order.totalUsdCents,
          Currency.ves,
          usdVes: order.usdVesRate,
          eurVes: rates.eurVes,
        ),
      );
      expect((await api.order(order.id)).couponCode, 'CONTRATO-10');
      expect((await api.cart()).items, isEmpty);

      // Un cupón de un uso por cliente: ya no se puede repetir…
      await api.addCombo(combo.slug, 1);
      await rejects('CONTRATO-10', 400, 'Ya usaste este cupón');
      // …hasta que se cancela el pedido, que libera el uso.
      await api.clearCart();
      final cancelled = await api.cancelOrder(order.id);
      expect(cancelled.status, OrderStatus.cancelled);
      await api.addCombo(combo.slug, 1);
      expect((await api.cart(coupon: 'CONTRATO-10')).coupon, isNotNull);
      await api.clearCart();
    });

    test('puntos: saldo, canje en el pedido y devolución al cancelar', () async {
      final combo = (await api.combos()).firstWhere(
        (c) => c.slug == 'combo-de-contrato',
        orElse: () => fail('Falta el combo: corre contract/promotions.sql'),
      );
      final address = (await api.addresses()).first;
      final zone = (await api.shippingZones()).firstWhere(
        (z) => z.states.contains(address.state),
      );
      final method = (await api.paymentMethods()).firstWhere(
        (m) => m.currency == Currency.ves,
      );
      Future<Order> checkout(int points) => api.checkout(
        addressId: address.id,
        shippingZoneId: zone.id,
        paymentMethodId: method.id,
        points: points,
      );

      // Una cuenta nueva no tiene puntos.
      final empty = await api.points();
      expect(empty.balance, 0);
      expect(empty.items, isEmpty);
      expect(empty.total, 0);
      expect(empty.valueUsdCents, isNonNegative);

      await api.addCombo(combo.slug, 1);
      var e = await failure(checkout(100));
      expect(e.status, 400);
      expect(e.message, 'Tienes 0 puntos');
      e = await failure(checkout(150));
      expect(e.status, 400);
      expect(e.message, 'Los puntos se canjean de 100 en 100');
      await api.clearCart();

      final db = databaseUrl;
      if (db == null) {
        markTestSkipped('Define CONTRACT_DATABASE_URL para probar el canje');
        return;
      }
      final abono = await Process.run('psql', [
        db,
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        'INSERT INTO points_entries (id, "userId", delta, reason, note) '
            "SELECT gen_random_uuid(), id, 500, 'ADJUSTED'::\"PointsReason\", "
            "'Prueba de contrato' FROM users WHERE email = lower('$email')",
      ]);
      expect(abono.exitCode, 0, reason: '${abono.stderr}');

      final funded = await api.points();
      expect(funded.balance, 500);
      expect(funded.valueUsdCents, 500);
      expect(funded.total, 1);
      expect(funded.items.single.reason, PointsReason.adjusted);
      expect(funded.items.single.delta, 500);
      expect(funded.items.single.note, 'Prueba de contrato');
      expect(funded.items.single.orderCode, isNull);

      // El saldo es el tope, aunque el pedido pague más.
      await api.addCombo(combo.slug, 1);
      e = await failure(checkout(600));
      expect(e.status, 400);
      expect(e.message, 'Tienes 500 puntos');
      expect(maxRedeemablePoints(balance: 500, itemsTotalUsdCents: 4500), 500);

      final order = await checkout(300);
      expect(order.pointsRedeemed, 300);
      expect(order.pointsDiscountUsdCents, 300);
      expect(order.pointsEarned, 0);
      expect(order.subtotalUsdCents, 4950);
      expect(order.comboDiscountUsdCents, 450);
      // 45,00 $ - 3,00 $ en puntos = 42,00 $: envío gratis.
      expect(order.shippingUsdCents, 0);
      expect(order.totalUsdCents, 4200);
      // El reembolso estimado también reparte lo pagado con puntos.
      expect(order.refundFor(1450), 1450 * 4200 ~/ 4950);

      final used = await api.points();
      expect(used.balance, 200);
      expect(used.items.first.reason, PointsReason.redeemed);
      expect(used.items.first.delta, -300);
      expect(used.items.first.orderId, order.id);
      expect(used.items.first.orderCode, order.code);
      final paged = await api.points(pageSize: 1);
      expect(paged.items, hasLength(1));
      expect(paged.total, 2);
      expect((await api.order(order.id)).pointsRedeemed, 300);

      // Cancelar devuelve los puntos.
      await api.cancelOrder(order.id);
      final back = await api.points();
      expect(back.balance, 500);
      expect(back.items.first.reason, PointsReason.restored);
      expect(back.items.first.delta, 300);
    });

    test('cerrar sesión revoca el token de renovación', () async {
      final refreshToken = store.tokens!.refreshToken;
      await api.logout();
      expect(store.tokens, isNull);
      final response = await httpClient.post(
        Uri.parse('$baseUrl/auth/refresh'),
        headers: {'Content-Type': 'application/json'},
        body: '{"refreshToken":"$refreshToken"}',
      );
      expect(response.statusCode, 401);
    });
  });
}
