import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:petbf/core/api_client.dart';
import 'package:petbf/core/money.dart';
import 'package:petbf/core/petbf_api.dart';
import 'package:petbf/core/token_store.dart';
import 'package:petbf/models/catalog.dart';
import 'package:petbf/models/json.dart';
import 'package:petbf/models/points.dart';
import 'package:petbf/models/reviews.dart';
import 'package:petbf/models/shop.dart';
import 'package:petbf/router.dart';

import '../support/fake_backend.dart' hide Json;

void main() {
  late FakeBackend backend;
  late PetbfApi api;
  late MemoryTokenStore store;

  setUp(() {
    backend = FakeBackend();
    store = MemoryTokenStore();
    api = PetbfApi(
      ApiClient(
        baseUrl: 'http://api.test/v1',
        httpClient: backend.client,
        tokenStore: store,
      ),
    );
  });

  Map<String, Object?> lastBody(String method, String path) =>
      jsonDecode(backend.called(method, path).last.body)
          as Map<String, Object?>;

  group('cuenta', () {
    test('login normaliza el correo y guarda la sesión', () async {
      final user = await api.login(
        email: '  ANA@petbf.com ',
        password: 'secreta123',
      );
      expect(user.fullName, 'Ana Pérez');
      expect(lastBody('POST', '/auth/login')['email'], 'ana@petbf.com');
      expect(store.tokens, isNotNull);
      expect((await api.me()).email, 'ana@petbf.com');
    });

    test('login incorrecto da el mensaje de la API', () async {
      await expectLater(
        api.login(email: 'ana@petbf.com', password: 'mala'),
        throwsA(
          isA<ApiException>().having(
            (e) => e.message,
            'message',
            'Correo o contraseña incorrectos',
          ),
        ),
      );
      expect(store.tokens, isNull);
    });

    test('registro recorta nombres y omite el teléfono vacío', () async {
      await api.register(
        email: 'Nuevo@Mail.com',
        password: '12345678',
        firstName: '  Luis ',
        lastName: ' Rojas ',
        phone: '   ',
      );
      final body = lastBody('POST', '/auth/register');
      expect(body, {
        'email': 'nuevo@mail.com',
        'password': '12345678',
        'firstName': 'Luis',
        'lastName': 'Rojas',
      });
    });

    test('registro repetido: 409 con mensaje', () async {
      await expectLater(
        api.register(
          email: 'ana@petbf.com',
          password: '12345678',
          firstName: 'Ana',
          lastName: 'P',
        ),
        throwsA(
          isA<ApiException>()
              .having((e) => e.status, 'status', 409)
              .having(
                (e) => e.message,
                'message',
                'Ya existe una cuenta con ese correo',
              ),
        ),
      );
    });
  });

  group('catálogo', () {
    test(
      'ProductQuery solo envía filtros con valor y búsqueda de 2+ letras',
      () {
        expect(const ProductQuery().toQuery(1, 24), {
          'q': null,
          'category': null,
          'species': null,
          'onSale': null,
          'sort': null,
          'page': '1',
          'pageSize': '24',
        });
        final q = const ProductQuery(
          search: ' a ',
          category: 'perros',
          species: Species.cat,
          onSale: true,
          sort: ProductSort.name,
        ).toQuery(3, 24);
        expect(q['q'], isNull);
        expect(q['category'], 'perros');
        expect(q['species'], 'CAT');
        expect(q['onSale'], 'true');
        expect(q['sort'], 'name');
        expect(q['page'], '3');
      },
    );

    test('ProductQuery compara por la búsqueda efectiva', () {
      expect(const ProductQuery(search: 'a'), const ProductQuery());
      expect(
        const ProductQuery(search: ' gato '),
        const ProductQuery(search: 'gato'),
      );
      expect(const ProductQuery(onSale: true) == const ProductQuery(), isFalse);
      final q = const ProductQuery(category: 'x')
          .copyWith(category: () => null);
      expect(q.category, isNull);
    });

    test('products filtra, ordena y pagina', () async {
      final page = await api.products(const ProductQuery(search: 'alimento'));
      expect(page.items.single.slug, 'alimento-seco-adulto');
      expect(page.items.single.priceFromUsdCents, 1090);
      expect(page.items.single.inStock, isTrue);

      final dogs = await api.products(const ProductQuery(category: 'perros'));
      expect(
        dogs.items.map((p) => p.slug),
        containsAll(['alimento-seco-adulto', 'mordedor-de-caucho']),
      );

      final sale = await api.products(const ProductQuery(onSale: true));
      expect(sale.items.map((p) => p.slug), ['alimento-seco-adulto']);

      final byName = await api.products(
        const ProductQuery(sort: ProductSort.name),
      );
      expect(byName.items.first.name, 'Alimento seco adulto');
      expect(byName.hasMore, isFalse);
    });

    test('product: detalle con variantes; 404 si no existe', () async {
      final p = await api.product('alimento-seco-adulto');
      expect(p.variants, hasLength(2));
      expect(p.isReturnable, isFalse);
      expect(p.categorySlug, 'perros-alimento');
      await expectLater(
        api.product('no-existe'),
        throwsA(isA<ApiException>().having((e) => e.isNotFound, '404', true)),
      );
    });

    test('animals por tipo y especie', () async {
      final adoption = await api.animals(
        const AnimalQuery(listingType: ListingType.adoption),
      );
      expect(adoption.items.single.name, 'Luna');
      expect(adoption.items.single.priceUsdCents, isNull);
      final dogs = await api.animals(const AnimalQuery(species: Species.dog));
      expect(dogs.items.single.status, AnimalStatus.reserved);
      final url = backend.called('GET', '/animals').first.url;
      expect(url.queryParameters['listingType'], 'ADOPTION');
    });

    test('rates lee los textos decimales', () async {
      final rates = await api.rates();
      expect(rates.usdVes, '36.5');
      expect(rates.eurVes, '39.8');
      backend.rates = const FakeRates();
      final none = await api.rates();
      expect(none.usdVes, isNull);
    });
  });

  group('compra', () {
    setUp(() async {
      await api.login(email: 'ana@petbf.com', password: 'secreta123');
    });

    test('carrito: añadir suma, cambiar, quitar y vaciar', () async {
      var cart = await api.addToCart('v-1kg', 2);
      cart = await api.addToCart('v-1kg', 1);
      expect(cart.items.single.quantity, 3);
      expect(cart.subtotalUsdCents, 3270);
      cart = await api.setQuantity('v-1kg', 1);
      expect(cart.itemCount, 1);
      cart = await api.removeFromCart('v-1kg');
      expect(cart.items, isEmpty);
      await api.addToCart('v-mord', 1);
      cart = await api.clearCart();
      expect(cart.canCheckout, isFalse);
    });

    test('carrito: sin stock suficiente o agotado es 409', () async {
      await expectLater(
        api.addToCart('v-3kg', 4),
        throwsA(
          isA<ApiException>()
              .having((e) => e.status, 'status', 409)
              .having(
                (e) => e.message,
                'message',
                'Solo hay 3 disponibles de esta presentación',
              ),
        ),
      );
      await expectLater(
        api.addToCart('v-arena', 1),
        throwsA(
          isA<ApiException>().having((e) => e.message, 'm', 'Producto agotado'),
        ),
      );
    });

    test('carrito: marca líneas que perdieron stock', () async {
      await api.addToCart('v-3kg', 3);
      backend.variantById('v-3kg')!['stock'] = 1;
      final cart = await api.cart();
      expect(cart.items.single.issue, CartIssue.insufficientStock);
      expect(cart.items.single.available, 1);
      expect(cart.canCheckout, isFalse);
      backend.variantById('v-3kg')!['stock'] = 0;
      expect((await api.cart()).items.single.issue, CartIssue.unavailable);
    });

    test(
      'direcciones: crear envía opcionales vacíos y editar/borrar',
      () async {
        final input = AddressInput(
          recipientName: ' Ana ',
          phone: '0412-1234567',
          state: 'Zulia',
          city: 'Maracaibo',
          municipality: '',
          line1: 'Calle 1',
          referencePoint: '  ',
          isDefault: false,
        );
        final created = await api.createAddress(input);
        expect(
          created.isDefault,
          isTrue,
        ); // la primera siempre es predeterminada
        expect(created.municipality, isNull);
        final body = lastBody('POST', '/addresses');
        expect(body['recipientName'], 'Ana');
        expect(body['referencePoint'], '');
        await api.updateAddress(created.id, input);
        expect((await api.addresses()).single.city, 'Maracaibo');
        await api.deleteAddress(created.id);
        expect(await api.addresses(), isEmpty);
      },
    );

    test('checkout envía acceptTerms y devuelve el pedido', () async {
      backend.addAddress('ana@petbf.com');
      await api.addToCart('v-1kg', 3); // 32,70 $: envío gratis
      final order = await api.checkout(
        addressId: 'ad-1',
        shippingZoneId: 'z-caracas',
        paymentMethodId: 'm-pm',
      );
      expect(lastBody('POST', '/orders')['acceptTerms'], isTrue);
      expect(order.status, OrderStatus.pendingPayment);
      expect(order.shippingUsdCents, 0);
      expect(order.chargedCurrency, Currency.ves);
      expect(order.code, 'PB-000001');
      final list = await api.orders();
      expect(list.items.single.itemCount, 1);
    });

    test('reporte de pago y cancelación', () async {
      final seeded = backend.seedOrder('ana@petbf.com');
      final id = seeded['id']! as String;
      final reported = await api.reportPayment(
        id,
        PaymentInput(
          reference: 'ABC123',
          amount: '100.00',
          paidAt: DateTime.utc(2026, 11, 26, 14, 30),
          originBank: '  ',
        ),
      );
      final body = lastBody('POST', '/orders/$id/payments');
      expect(body.containsKey('originBank'), isFalse);
      expect(body['paidAt'], '2026-11-26T14:30:00.000Z');
      expect(reported.status, OrderStatus.paymentReported);
      expect(reported.payments.single.status, PaymentStatus.reported);
      await expectLater(api.cancelOrder(id), throwsA(isA<ApiException>()));

      final other = backend.seedOrder('ana@petbf.com');
      final cancelled = await api.cancelOrder(other['id']! as String);
      expect(cancelled.status, OrderStatus.cancelled);
    });

    test('pedido de otra persona responde 404', () async {
      final foreign = backend.seedOrder('otra@mail.com');
      await expectLater(
        api.order(foreign['id']! as String),
        throwsA(isA<ApiException>().having((e) => e.isNotFound, '404', true)),
      );
    });
  });

  group('modelos', () {
    test('un JSON con forma inesperada falla con FormatException', () {
      expect(() => ProductCard.fromJson({'id': 1}), throwsFormatException);
      expect(() => asJson([1]), throwsFormatException);
      expect(() => asList<Json>({'a': 1}, (j) => j), throwsFormatException);
      expect(() => speciesFromApi('DRAGON'), throwsFormatException);
      expect(() => orderStatusFromApi('LOST'), throwsFormatException);
    });

    test('decimal acepta texto o número', () {
      final Json j = {'a': '36.5', 'b': 40, 'c': null};
      expect(j.decimal('a'), '36.5');
      expect(j.decimal('b'), '40');
      expect(j.decimalOrNull('c'), isNull);
      expect(() => j.decimal('c'), throwsFormatException);
    });

    test('textos de estados como en la web', () {
      expect(OrderStatus.pendingPayment.label, 'Esperando el pago');
      expect(OrderStatus.paymentReported.label, 'Pago en revisión');
      expect(OrderStatus.refunded.label, 'Reembolsado');
      expect(PaymentStatus.rejected.label, 'Rechazado');
      expect(Species.rodent.label, 'Roedores');
      expect(Sex.unknown.label, 'Sin determinar');
      expect(ReturnStatus.requested.label, 'En revisión');
      expect(ReturnStatus.refunded.label, 'Reembolsada');
    });
  });

  group('devoluciones y comprobantes', () {
    Future<Order> delivered({Duration ago = Duration.zero}) async {
      backend.seedOrder(
        'ana@petbf.com',
        status: 'DELIVERED',
        items: {'v-mord': 2, 'v-1kg': 1},
        deliveredAt: backend.now.subtract(ago),
      );
      await api.login(email: 'ana@petbf.com', password: 'secreta123');
      return api.order('o-1');
    }

    test('lee el plazo y lo que queda por devolver', () async {
      final order = await delivered();
      expect(order.returnUntil, backend.now.add(const Duration(days: 3)));
      expect(order.returns, isEmpty);
      final left = order.returnableLeft;
      expect(left.map((l) => (l.item.productName, l.left)), [
        ('Mordedor de caucho', 2),
      ]);
      expect(order.canRequestReturn(backend.now), isTrue);
      expect(
        order.canRequestReturn(backend.now.add(const Duration(days: 3))),
        isFalse,
      );
    });

    test('envía la devolución y descuenta las unidades pedidas', () async {
      await delivered();
      final order = await api.requestReturn(
        'o-1',
        reason: '  Llegó roto el mordedor  ',
        items: const [ReturnLine(orderItemId: 'oi-v-mord', quantity: 1)],
      );
      expect(lastBody('POST', '/orders/o-1/returns'), {
        'reason': 'Llegó roto el mordedor',
        'items': [
          {'orderItemId': 'oi-v-mord', 'quantity': 1},
        ],
      });
      final r = order.returns.single;
      expect(r.status, ReturnStatus.requested);
      expect(r.refundUsdCents, 890);
      expect(r.currency, Currency.ves);
      expect(order.returnableLeft.single.left, 1);
      // Abierta: no se puede pedir otra hasta que la revisen.
      expect(order.canRequestReturn(backend.now), isFalse);
    });

    test('las rechazadas no cuentan como devueltas', () {
      final order = Order.fromJson({
        ...backend.seedOrder('ana@petbf.com', status: 'DELIVERED')
          ..remove('_owner'),
        'returnUntil': backend.now
            .add(const Duration(days: 1))
            .toIso8601String(),
        'returns': [
          for (final status in ['REJECTED', 'REFUNDED'])
            {
              'id': 'r-$status',
              'status': status,
              'reason': 'motivo largo',
              'refundUsdCents': 890,
              'currency': 'VES',
              'refundAmount': '324.85',
              'decisionNote': null,
              'refundReference': null,
              'refundedAt': null,
              'createdAt': backend.now.toIso8601String(),
              'items': [
                {'orderItemId': 'oi-v-mord', 'quantity': 1},
              ],
            },
        ],
      });
      expect(order.returnableLeft.single.left, 1);
      expect(order.canRequestReturn(backend.now), isTrue);
    });

    test('un pedido de la API anterior (sin devoluciones) sigue leyéndose', () {
      final json = backend.seedOrder('ana@petbf.com')..remove('_owner');
      json.remove('returns');
      final order = Order.fromJson(json);
      expect(order.returns, isEmpty);
      expect(order.returnUntil, isNull);
      expect(order.canRequestReturn(backend.now), isFalse);
    });

    test('lee los datos del comprobante', () {
      final p = PaymentReport.fromJson({
        'id': 'p',
        'reference': 'ABC1',
        'amount': '10.00',
        'currency': 'USD',
        'paidAt': backend.now.toIso8601String(),
        'status': 'REPORTED',
        'rejectionReason': null,
        'createdAt': backend.now.toIso8601String(),
        'proof': {
          'contentType': 'image/webp',
          'sizeBytes': 5000,
          'createdAt': backend.now.toIso8601String(),
        },
      });
      expect(p.proof!.label, 'WEBP');
      expect(p.proof!.isImage, isTrue);
      expect(p.proof!.sizeBytes, 5000);
    });

    test('estado de devolución desconocido falla', () {
      expect(
        () => ReturnRequest.fromJson({'id': 'x', 'status': 'LOST'}),
        throwsFormatException,
      );
    });

    test('especies aceptadas para animales vivos', () async {
      backend.liveSpecies = ['DOG', 'BIRD'];
      expect(await api.animalSpecies(), [Species.dog, Species.bird]);
    });
  });

  group('reseñas y recomendados', () {
    const slug = 'mordedor-de-caucho';

    Future<void> signIn() =>
        api.login(email: 'ana@petbf.com', password: 'secreta123');

    test('lista con orden, página y resumen', () async {
      backend
        ..seedReview(slug, rating: 5, author: 'Luis G.')
        ..seedReview(slug, rating: 4, title: 'Bien')
        ..seedReview(slug, rating: 1, status: 'HIDDEN', hiddenReason: 'Spam');
      final page = await api.reviews(slug, sort: ReviewSort.worst, page: 1);
      expect(
        backend
            .called('GET', '/products/$slug/reviews')
            .single
            .url
            .queryParameters,
        {'sort': 'worst', 'page': '1', 'pageSize': '10'},
      );
      expect(page.items.map((r) => r.rating), [4, 5]);
      expect(page.items.first.title, 'Bien');
      expect(page.items.last.title, isNull);
      expect(page.items.last.author, 'Luis G.');
      expect(page.items.last.verifiedPurchase, isTrue);
      expect(page.summary.count, 2);
      expect(page.summary.average, 4.5);
      expect(page.summary.distribution, [0, 0, 0, 1, 1]);
      expect(page.hasMore, isFalse);
    });

    test('sin reseñas el promedio es null', () async {
      final page = await api.reviews(slug);
      expect(page.items, isEmpty);
      expect(page.summary.average, isNull);
      expect(page.summary.distribution, [0, 0, 0, 0, 0]);
    });

    test('la reseña propia: sin compra, crear, editar y borrar', () async {
      await signIn();
      var mine = await api.myReview(slug);
      expect(mine.canReview, isFalse);
      expect(mine.review, isNull);
      await expectLater(
        api.saveReview(
          slug,
          const ReviewInput(rating: 5, body: 'Muy bueno, sí.'),
        ),
        throwsA(
          isA<ApiException>()
              .having((e) => e.status, 'status', 403)
              .having(
                (e) => e.message,
                'message',
                'Solo puedes reseñar productos que compraste y ya recibiste',
              ),
        ),
      );

      backend.seedOrder('ana@petbf.com', status: 'DELIVERED');
      mine = await api.saveReview(
        slug,
        const ReviewInput(rating: 4, title: ' Bueno ', body: ' Resiste bien. '),
      );
      expect(lastBody('PUT', '/products/$slug/reviews/mine'), {
        'rating': 4,
        'title': 'Bueno',
        'body': 'Resiste bien.',
      });
      expect(mine.canReview, isTrue);
      expect(mine.review!.title, 'Bueno');
      expect(mine.review!.hidden, isFalse);

      mine = await api.saveReview(
        slug,
        const ReviewInput(rating: 2, title: '   ', body: 'Ya no resiste.'),
      );
      expect(lastBody('PUT', '/products/$slug/reviews/mine'), {
        'rating': 2,
        'body': 'Ya no resiste.',
      });
      expect(mine.review!.title, isNull);
      expect((await api.product(slug)).rating.average, 2.0);

      await api.deleteReview(slug);
      expect((await api.myReview(slug)).review, isNull);
      await expectLater(
        api.deleteReview(slug),
        throwsA(
          isA<ApiException>().having(
            (e) => e.message,
            'message',
            'No tienes una reseña de este producto',
          ),
        ),
      );
    });

    test('la API rechaza la validación con el mensaje sin el campo', () async {
      await signIn();
      backend.seedOrder('ana@petbf.com', status: 'DELIVERED');
      await expectLater(
        api.saveReview(slug, const ReviewInput(rating: 5, body: 'corto')),
        throwsA(
          isA<ApiException>().having(
            (e) => e.message,
            'message',
            'Cuéntanos un poco más (mínimo 10 caracteres)',
          ),
        ),
      );
    });

    test('la reseña oculta trae el motivo', () async {
      await signIn();
      backend.seedReview(
        slug,
        rating: 1,
        email: 'ana@petbf.com',
        status: 'HIDDEN',
        hiddenReason: 'Datos personales',
      );
      final own = (await api.myReview(slug)).review!;
      expect(own.hidden, isTrue);
      expect(own.hiddenReason, 'Datos personales');
    });

    test('sin sesión, la reseña propia pide entrar', () async {
      await expectLater(
        api.myReview(slug),
        throwsA(isA<ApiException>().having((e) => e.status, 'status', 401)),
      );
    });

    test('recomendados y valoración en tarjetas y ficha', () async {
      backend.seedReview('alimento-seco-adulto', rating: 4);
      final recs = await api.recommendations(slug);
      expect(recs.map((p) => p.slug), ['alimento-seco-adulto']);
      expect(recs.single.rating.average, 4.0);
      expect(recs.single.rating.count, 1);
      final cards = await api.products(const ProductQuery());
      expect(
        cards.items.firstWhere((p) => p.slug == slug).rating.hasReviews,
        isFalse,
      );
    });

    test('modelos estrictos y compatibles con una API anterior', () {
      // Sin "rating" (API anterior): sin reseñas.
      final card = ProductCard.fromJson({
        'id': 'p',
        'name': 'X',
        'slug': 'x',
        'species': <Object?>[],
        'category': {'id': 'c', 'name': 'C', 'slug': 'c'},
        'brand': null,
        'image': null,
        'priceFromUsdCents': 100,
        'compareAtUsdCents': null,
        'inStock': true,
      });
      expect(card.rating.hasReviews, isFalse);
      expect(card.rating.averageText, '');

      const r = Rating(average: 4.5, count: 1);
      expect(r.averageText, '4,5');
      expect(r.semantics, '4,5 de 5 estrellas, 1 reseña');
      expect(
        const Rating(average: 4, count: 12).semantics,
        '4,0 de 5 estrellas, 12 reseñas',
      );
      expect(Rating.fromJson({'average': 3, 'count': 2}).average, 3.0);
      expect(
        () => Rating.fromJson({'average': '4.5', 'count': 2}),
        throwsFormatException,
      );
      expect(
        () => ReviewSummary.fromJson({
          'count': 1,
          'average': 5,
          'distribution': [0, 0, 0, 1],
        }),
        throwsFormatException,
      );
      expect(
        () => MyReview.fromJson({
          'canReview': true,
          'review': {
            'rating': 3,
            'title': null,
            'body': 'Texto válido.',
            'status': 'PENDING',
            'hiddenReason': null,
          },
        }),
        throwsFormatException,
      );
      expect(ReviewSort.best.label, 'Mejor valoradas');
      expect(ReviewSort.worst.label, 'Peor valoradas');
      expect(ReviewSort.recent.label, 'Más recientes');
      expect(
        const ReviewPage(
          items: [],
          total: 21,
          page: 2,
          pageSize: 10,
          summary: ReviewSummary(
            count: 21,
            average: 4,
            distribution: [0, 0, 0, 21, 0],
          ),
        ).hasMore,
        isTrue,
      );
    });
  });

  group('cupones y combos', () {
    Json cartJson({
      List<Json> combos = const [],
      Json? coupon,
      bool legacy = false,
    }) {
      final json = <String, Object?>{
        'items': <Object?>[],
        'itemCount': 3,
        'subtotalUsdCents': 2870,
        'canCheckout': true,
        'combos': combos,
        'comboDiscountUsdCents': combos.fold<int>(
          0,
          (n, c) => n + (c['savingsUsdCents']! as int),
        ),
        'coupon': coupon,
        'itemsTotalUsdCents': 2500,
      };
      if (legacy) {
        json
          ..remove('combos')
          ..remove('comboDiscountUsdCents')
          ..remove('coupon')
          ..remove('itemsTotalUsdCents');
      }
      return json;
    }

    test('el carrito lee combos, cupón y lo que se paga', () {
      final cart = Cart.fromJson(
        cartJson(
          combos: [
            {
              'comboId': 'cb-1',
              'name': 'Kit',
              'count': 2,
              'savingsUsdCents': 370,
            },
          ],
          coupon: {
            'code': 'VERANO-10',
            'description': '10 % menos',
            'discountUsdCents': 250,
          },
        ),
      );
      expect(cart.subtotalUsdCents, 2870);
      expect(cart.itemsTotalUsdCents, 2500);
      expect(cart.comboDiscountUsdCents, 370);
      expect(cart.combos.single.label, 'Combo Kit × 2');
      expect(cart.coupon!.code, 'VERANO-10');
      expect(cart.coupon!.discountUsdCents, 250);
      expect(cart.hasDiscounts, isTrue);
    });

    test('un combo de una sola unidad no lleva "× 1"', () {
      const combo = AppliedCombo(
        comboId: 'c',
        name: 'Kit',
        count: 1,
        savingsUsdCents: 1,
      );
      expect(combo.label, 'Combo Kit');
    });

    test('una API anterior no manda descuentos: se leen en cero', () {
      final cart = Cart.fromJson(cartJson(legacy: true));
      expect(cart.combos, isEmpty);
      expect(cart.coupon, isNull);
      expect(cart.comboDiscountUsdCents, 0);
      expect(cart.itemsTotalUsdCents, cart.subtotalUsdCents);
      expect(cart.hasDiscounts, isFalse);
      expect(Cart.empty.itemsTotalUsdCents, 0);
    });

    test('un carrito con forma inesperada falla', () {
      expect(
        () => Cart.fromJson({...cartJson(), 'combos': 'no'}),
        throwsFormatException,
      );
      expect(
        () => Cart.fromJson({
          ...cartJson(),
          'coupon': {'code': 'X'},
        }),
        throwsFormatException,
      );
    });

    test('cart(coupon:) manda el código y sin él no manda nada', () async {
      await api.login(email: 'ana@petbf.com', password: 'secreta123');
      backend.coupons.add(FakeBackend.coupon('VERANO-10'));
      backend.carts['ana@petbf.com'] = {'v-mord': 2};
      await api.cart();
      expect(backend.called('GET', '/cart').last.url.query, isEmpty);
      final cart = await api.cart(coupon: 'VERANO-10');
      expect(
        backend.called('GET', '/cart').last.url.queryParameters['coupon'],
        'VERANO-10',
      );
      expect(cart.coupon!.discountUsdCents, 178);
      expect(cart.itemsTotalUsdCents, 1602);
    });

    test('un cupón que no aplica da el motivo de la API', () async {
      await api.login(email: 'ana@petbf.com', password: 'secreta123');
      backend.carts['ana@petbf.com'] = {'v-mord': 2};
      await expectLater(
        api.cart(coupon: 'FANTASMA'),
        throwsA(
          isA<ApiException>()
              .having((e) => e.status, 'status', 400)
              .having(
                (e) => e.message,
                'message',
                'Ese cupón no existe o ya no está activo',
              ),
        ),
      );
    });

    test('checkout manda couponCode solo si lo hay', () async {
      await api.login(email: 'ana@petbf.com', password: 'secreta123');
      backend.coupons.add(FakeBackend.coupon('VERANO-10'));
      backend.addAddress('ana@petbf.com');
      backend.carts['ana@petbf.com'] = {'v-mord': 2};
      final order = await api.checkout(
        addressId: 'ad-1',
        shippingZoneId: 'z-caracas',
        paymentMethodId: 'm-pm',
        couponCode: 'VERANO-10',
      );
      expect(lastBody('POST', '/orders')['couponCode'], 'VERANO-10');
      expect(order.couponCode, 'VERANO-10');
      expect(order.couponDiscountUsdCents, 178);
      expect(order.comboDiscountUsdCents, 0);
      expect(order.subtotalUsdCents, 1780);
      expect(order.totalUsdCents, 1602 + 300);

      backend.carts['ana@petbf.com'] = {'v-mord': 1};
      final plain = await api.checkout(
        addressId: 'ad-1',
        shippingZoneId: 'z-caracas',
        paymentMethodId: 'm-pm',
      );
      expect(lastBody('POST', '/orders').containsKey('couponCode'), isFalse);
      expect(plain.couponCode, isNull);
    });

    test('Order.refundFor devuelve lo pagado', () async {
      await api.login(email: 'ana@petbf.com', password: 'secreta123');
      backend.addAddress('ana@petbf.com');
      backend.carts['ana@petbf.com'] = {'v-mord': 2};
      backend.coupons.add(FakeBackend.coupon('VERANO-10'));
      final order = await api.checkout(
        addressId: 'ad-1',
        shippingZoneId: 'z-caracas',
        paymentMethodId: 'm-pm',
        couponCode: 'VERANO-10',
      );
      expect(order.refundFor(890), 801);
      expect(order.refundFor(1780), 1602);
      expect(order.refundFor(0), 0);
    });

    test('lista y añade combos', () async {
      backend.combos.add(
        FakeBackend.combo(
          slug: 'kit',
          name: 'Kit',
          price: 2500,
          items: {'v-1kg': 1, 'v-mord': 2},
        ),
      );
      final combos = await api.combos();
      final kit = combos.single;
      expect(kit.regularUsdCents, 2870);
      expect(kit.savingsUsdCents, 370);
      expect(kit.available, 10);
      expect(kit.maxToAdd, 5);
      expect(kit.items.map((i) => i.quantity), [1, 2]);
      expect(kit.items.first.productName, 'Alimento seco adulto');
      expect(kit.items.first.variantName, '1 kg');

      await api.login(email: 'ana@petbf.com', password: 'secreta123');
      final cart = await api.addCombo('kit', 2);
      expect(lastBody('POST', '/cart/combos/kit'), {'quantity': 2});
      expect(cart.combos.single.count, 2);
      expect(cart.comboDiscountUsdCents, 740);

      await expectLater(
        api.addCombo('no-existe', 1),
        throwsA(
          isA<ApiException>().having((e) => e.isNotFound, 'isNotFound', true),
        ),
      );
    });

    test('maxToAdd es el stock cuando alcanza para menos de 5', () {
      Combo withStock(int n) => Combo.fromJson({
        'id': 'c',
        'name': 'K',
        'slug': 'k',
        'description': null,
        'priceUsdCents': 1,
        'regularUsdCents': 2,
        'savingsUsdCents': 1,
        'available': n,
        'items': <Object?>[],
      });
      expect(withStock(0).maxToAdd, 0);
      expect(withStock(3).maxToAdd, 3);
      expect(withStock(5).maxToAdd, 5);
      expect(withStock(40).maxToAdd, 5);
      expect(withStock(3).description, '');
    });
  });

  group('puntos', () {
    Map<String, Object?> entry(Object? reason, {Object? order}) => {
      'id': 'p1',
      'delta': 25,
      'reason': reason,
      'note': null,
      'createdAt': '2026-11-20T15:30:00.000Z',
      'order': order,
    };

    test('lee el saldo y los movimientos con paginación', () async {
      await api.login(email: 'ana@petbf.com', password: 'secreta123');
      for (var i = 0; i < 3; i++) {
        backend.addPoints('ana@petbf.com', 100 + i);
      }
      final summary = await api.points(page: 2, pageSize: 2);
      expect(
        backend.called('GET', '/points').last.url.query,
        contains('page=2'),
      );
      expect(
        backend.called('GET', '/points').last.url.query,
        contains('pageSize=2'),
      );
      expect(summary.balance, 303);
      expect(summary.total, 3);
      expect(summary.items, hasLength(1));
      expect(summary.asPage.hasMore, isFalse);
    });

    test('sin sesión la API responde 401', () async {
      await expectLater(
        api.points(),
        throwsA(isA<ApiException>().having((e) => e.status, 'status', 401)),
      );
    });

    test('checkout manda points solo si hay', () async {
      await api.login(email: 'ana@petbf.com', password: 'secreta123');
      backend.addAddress('ana@petbf.com');
      backend.addPoints('ana@petbf.com', 1000);
      backend.carts['ana@petbf.com'] = {'v-mord': 2};
      final order = await api.checkout(
        addressId: 'ad-1',
        shippingZoneId: 'z-caracas',
        paymentMethodId: 'm-pm',
        points: 500,
      );
      expect(lastBody('POST', '/orders')['points'], 500);
      expect(order.pointsRedeemed, 500);
      expect(order.pointsDiscountUsdCents, 500);
      expect(order.pointsEarned, 0);

      backend.carts['ana@petbf.com'] = {'v-mord': 1};
      await api.checkout(
        addressId: 'ad-1',
        shippingZoneId: 'z-caracas',
        paymentMethodId: 'm-pm',
      );
      expect(lastBody('POST', '/orders').containsKey('points'), isFalse);
    });

    test('la API rechaza más puntos de los que hay', () async {
      await api.login(email: 'ana@petbf.com', password: 'secreta123');
      backend.addAddress('ana@petbf.com');
      backend.carts['ana@petbf.com'] = {'v-mord': 2};
      await expectLater(
        api.checkout(
          addressId: 'ad-1',
          shippingZoneId: 'z-caracas',
          paymentMethodId: 'm-pm',
          points: 100,
        ),
        throwsA(
          isA<ApiException>().having(
            (e) => e.message,
            'message',
            'Tienes 0 puntos',
          ),
        ),
      );
    });

    test('PointsEntry lee cada motivo y el pedido', () {
      for (final r in PointsReason.values) {
        final e = PointsEntry.fromJson(
          entry(r.api, order: {'id': 'o-9', 'number': 123}),
        );
        expect(e.reason, r);
        expect(e.orderId, 'o-9');
        expect(e.orderCode, 'PB-000123');
        expect(r.label, isNotEmpty);
      }
      final sin = PointsEntry.fromJson(entry('ADJUSTED'));
      expect(sin.orderId, isNull);
      expect(sin.orderCode, isNull);
      expect(sin.note, isNull);
    });

    test('un motivo desconocido falla en vez de inventarse uno', () {
      expect(
        () => PointsEntry.fromJson(entry('REGALO')),
        throwsA(isA<FormatException>()),
      );
    });

    test('PointsSummary.empty es el estado sin sesión', () {
      expect(PointsSummary.empty.balance, 0);
      expect(PointsSummary.empty.items, isEmpty);
    });

    test('maxRedeemablePoints: saldo, total de productos y de 100 en 100', () {
      int max(int balance, int items) =>
          maxRedeemablePoints(balance: balance, itemsTotalUsdCents: items);
      expect(max(1000, 1780), 1000);
      expect(max(5000, 1780), 1700);
      expect(max(99, 5000), 0);
      expect(max(150, 5000), 100);
      expect(max(1000, 0), 0);
      expect(max(0, 1000), 0);
      expect(max(-5, 1000), 0);
      expect(max(1000, -5), 0);
      expect(max(100, 100), 100);
    });

    test('pointsEarnedFor: un punto por dólar completo', () {
      expect(pointsEarnedFor(0), 0);
      expect(pointsEarnedFor(99), 0);
      expect(pointsEarnedFor(100), 1);
      expect(pointsEarnedFor(1780), 17);
      expect(pointsEarnedFor(-100), 0);
    });

    test('Order.refundFor reparte también lo pagado con puntos', () async {
      await api.login(email: 'ana@petbf.com', password: 'secreta123');
      backend.addAddress('ana@petbf.com');
      backend.addPoints('ana@petbf.com', 1000);
      backend.carts['ana@petbf.com'] = {'v-mord': 2};
      final order = await api.checkout(
        addressId: 'ad-1',
        shippingZoneId: 'z-caracas',
        paymentMethodId: 'm-pm',
        points: 500,
      );
      // Productos 1780; con 500 puntos se pagan 1280.
      expect(order.refundFor(1780), 1280);
      expect(order.refundFor(890), 640);
      expect(order.refundFor(0), 0);
    });
  });

  group('rutas', () {
    test('safeNext solo acepta rutas internas', () {
      expect(safeNext('/carrito'), '/carrito');
      expect(safeNext(null), '/cuenta');
      expect(safeNext('https://malo.com'), '/cuenta');
      expect(safeNext('//malo.com'), '/cuenta');
      expect(safeNext('carrito'), '/cuenta');
    });

    test('rutas privadas piden entrar y vuelven después', () {
      expect(
        redirectFor(Uri.parse('/checkout'), signedIn: false, loading: false),
        '/entrar?next=%2Fcheckout',
      );
      expect(
        redirectFor(Uri.parse('/pedidos/o-1'), signedIn: false, loading: false),
        '/entrar?next=%2Fpedidos%2Fo-1',
      );
      expect(
        redirectFor(
          Uri.parse('/cuenta/direcciones'),
          signedIn: false,
          loading: false,
        ),
        startsWith('/entrar'),
      );
      // Mientras se confirma la sesión guardada no se redirige.
      expect(
        redirectFor(Uri.parse('/checkout'), signedIn: false, loading: true),
        isNull,
      );
      expect(
        redirectFor(Uri.parse('/checkout'), signedIn: true, loading: false),
        isNull,
      );
      // Las públicas no piden cuenta.
      for (final p in [
        '/',
        '/productos',
        '/productos/x',
        '/animales',
        '/carrito',
        '/cuenta',
      ]) {
        expect(
          redirectFor(Uri.parse(p), signedIn: false, loading: false),
          isNull,
          reason: p,
        );
      }
      // "/pedidosx" no es "/pedidos".
      expect(
        redirectFor(Uri.parse('/pedidosx'), signedIn: false, loading: false),
        isNull,
      );
    });

    test('con sesión, entrar y registro llevan a next', () {
      expect(
        redirectFor(
          Uri.parse('/entrar?next=%2Fcarrito'),
          signedIn: true,
          loading: false,
        ),
        '/carrito',
      );
      expect(
        redirectFor(
          Uri.parse('/registro?next=https://x.com'),
          signedIn: true,
          loading: false,
        ),
        '/cuenta',
      );
      expect(
        redirectFor(Uri.parse('/entrar'), signedIn: false, loading: false),
        isNull,
      );
    });
  });
}
