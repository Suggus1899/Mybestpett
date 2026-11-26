import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:petbf/core/api_client.dart';
import 'package:petbf/core/money.dart';
import 'package:petbf/core/petbf_api.dart';
import 'package:petbf/core/token_store.dart';
import 'package:petbf/models/catalog.dart';
import 'package:petbf/models/json.dart';
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
