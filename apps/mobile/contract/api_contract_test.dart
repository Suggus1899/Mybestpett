// Prueba de contrato: la app contra la API real (no la falsa de test/).
//
// Comprueba que los modelos leen el JSON verdadero y que la sesión, los
// montos y los errores se comportan como la app espera. Necesita la API
// corriendo con datos de ejemplo (SEED_DEMO=true):
//
//   CONTRACT_API_URL=http://localhost:3001/v1 flutter test contract
//
// Sin CONTRACT_API_URL se salta. Vive fuera de test/ para que no cargue
// flutter_test_config.dart: el binding de widgets bloquea la red real.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:petbf/core/api_client.dart';
import 'package:petbf/core/money.dart';
import 'package:petbf/core/petbf_api.dart';
import 'package:petbf/core/token_store.dart';
import 'package:petbf/models/catalog.dart';
import 'package:petbf/models/shop.dart';

final baseUrl = Platform.environment['CONTRACT_API_URL'];

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
