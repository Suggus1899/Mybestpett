import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:material_ui/material_ui.dart';
import 'package:petbf/core/providers.dart';

import '../support/fake_backend.dart';
import '../support/harness.dart';

const ana = 'ana@petbf.com';

/// Alimento 1 kg (10,90 $) + 2 mordedores (8,90 $ c/u) = 28,70 $ por
/// separado; el combo cuesta 25,00 $ y ahorra 3,70 $.
Json kit({int price = 2500}) => FakeBackend.combo(
  slug: 'kit-de-paseo',
  name: 'Kit de paseo',
  price: price,
  items: {'v-1kg': 1, 'v-mord': 2},
);

FakeBackend withKit({int price = 2500}) =>
    FakeBackend()..combos.add(kit(price: price));

/// Cambia el stock de la primera presentación del producto [product].
void setStock(FakeBackend backend, int product, int stock) {
  final variants = backend.products[product]['variants']! as List<Json>;
  variants.first['stock'] = stock;
}

Future<void> scrollToTop(TestApp app) async {
  await app.tester.drag(verticalScrollable, const Offset(0, 3000));
  await app.settle();
}

Json lastBody(FakeBackend b, String method, String path) =>
    jsonDecode(b.called(method, path).last.body) as Json;

http.Response failure(int status, String message) => http.Response(
  jsonEncode({'statusCode': status, 'message': message}),
  status,
  headers: {'content-type': 'application/json'},
);

void main() {
  group('combos', () {
    testWidgets('lista los combos con su ahorro', (tester) async {
      final backend = withKit();
      await startApp(tester, backend: backend, location: '/combos');
      expect(find.text('Kit de paseo'), findsOneWidget);
      expect(find.text('1 × Alimento seco adulto (1 kg)'), findsOneWidget);
      expect(find.text('2 × Mordedor de caucho (Talla M)'), findsOneWidget);
      expect(find.text(r'$25,00'), findsOneWidget);
      expect(find.text(r'$28,70'), findsOneWidget);
      expect(find.text(r'Ahorras $3,70'), findsOneWidget);
      expect(find.textContaining('todos sus productos'), findsOneWidget);
    });

    testWidgets('sin combos lo dice', (tester) async {
      await startApp(tester, location: '/combos');
      expect(find.text('Por ahora no hay combos'), findsOneWidget);
    });

    testWidgets('no muestra los que no se pueden vender o no ahorran', (
      tester,
    ) async {
      final backend = FakeBackend()
        ..combos.addAll([
          FakeBackend.combo(
            slug: 'apagado',
            name: 'Combo apagado',
            price: 1000,
            items: {'v-1kg': 1, 'v-mord': 1},
            active: false,
          ),
          // 19,80 $ por separado y cuesta lo mismo: no ahorra.
          FakeBackend.combo(
            slug: 'sin-ahorro',
            name: 'Combo sin ahorro',
            price: 1980,
            items: {'v-1kg': 1, 'v-mord': 1},
          ),
          kit(),
        ]);
      await startApp(tester, backend: backend, location: '/combos');
      expect(find.text('Kit de paseo'), findsOneWidget);
      expect(find.text('Combo apagado'), findsNothing);
      expect(find.text('Combo sin ahorro'), findsNothing);
    });

    testWidgets('con un producto inactivo el combo no se vende', (
      tester,
    ) async {
      final backend = withKit();
      backend.products[0]['isActive'] = false;
      await startApp(tester, backend: backend, location: '/combos');
      expect(find.text('Por ahora no hay combos'), findsOneWidget);
    });

    testWidgets('error al cargar y reintentar', (tester) async {
      final backend = withKit();
      backend.overrides['GET /combos'] = (_) => failure(500, 'Error interno');
      final app = await startApp(tester, backend: backend, location: '/combos');
      expect(find.text('Reintentar'), findsOneWidget);
      backend.overrides.clear();
      await tapText(app, 'Reintentar');
      expect(find.text('Kit de paseo'), findsOneWidget);
    });

    testWidgets('el producto de un combo abre su ficha', (tester) async {
      final app = await startApp(
        tester,
        backend: withKit(),
        location: '/combos',
      );
      await tapText(app, '2 × Mordedor de caucho (Talla M)');
      expect(app.router.state.uri.path, '/productos/mordedor-de-caucho');
    });

    testWidgets('sin sesión, añadir lleva a entrar y vuelve a los combos', (
      tester,
    ) async {
      final backend = withKit();
      final app = await startApp(tester, backend: backend, location: '/combos');
      await tapText(app, 'Añadir combo');
      expect(app.router.state.uri.path, '/entrar');
      expect(app.router.state.uri.queryParameters['next'], '/combos');
      expect(backend.called('POST', '/cart/combos/kit-de-paseo'), isEmpty);
    });

    testWidgets('añade todos los productos del combo', (tester) async {
      final backend = withKit();
      final app = await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/combos',
      );
      await tapText(app, 'Añadir combo');
      expect(lastBody(backend, 'POST', '/cart/combos/kit-de-paseo'), {
        'quantity': 1,
      });
      expect(backend.carts[ana], {'v-1kg': 1, 'v-mord': 2});
      expect(
        find.text('Añadiste el combo Kit de paseo al carrito.'),
        findsOneWidget,
      );
      // La acción del aviso lleva al carrito, ya con el combo descontado.
      await tapText(app, 'Ver carrito');
      expect(app.router.state.uri.path, '/carrito');
      expect(find.text('Combo Kit de paseo'), findsOneWidget);
    });

    testWidgets('varias unidades y la cantidad vuelve a 1', (tester) async {
      final backend = withKit();
      final app = await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/combos',
      );
      await tester.tap(find.widgetWithIcon(IconButton, Icons.add));
      await app.settle();
      await tapText(app, 'Añadir combo');
      expect(lastBody(backend, 'POST', '/cart/combos/kit-de-paseo'), {
        'quantity': 2,
      });
      expect(backend.carts[ana], {'v-1kg': 2, 'v-mord': 4});
      expect(
        find.text('Añadiste 2 × el combo Kit de paseo al carrito.'),
        findsOneWidget,
      );
      expect(find.text('1'), findsOneWidget);
    });

    testWidgets('la cantidad máxima sigue al stock y a las 5 de la API', (
      tester,
    ) async {
      final backend = withKit();
      // Alimento: 3 en stock → 3 combos; mordedor 50 → 25.
      setStock(backend, 0, 3);
      final app = await startApp(tester, backend: backend, location: '/combos');
      for (var i = 0; i < 6; i++) {
        final plus = find.widgetWithIcon(IconButton, Icons.add);
        if (tester.widget<IconButton>(plus).onPressed == null) break;
        await tester.tap(plus);
        await app.settle();
      }
      expect(find.text('3'), findsOneWidget);
      expect(
        tester
            .widget<IconButton>(find.widgetWithIcon(IconButton, Icons.add))
            .onPressed,
        isNull,
      );

      setStock(backend, 0, 40);
      app.container.invalidate(combosProvider);
      await app.settle();
      for (var i = 0; i < 8; i++) {
        final plus = find.widgetWithIcon(IconButton, Icons.add);
        if (tester.widget<IconButton>(plus).onPressed == null) break;
        await tester.tap(plus);
        await app.settle();
      }
      expect(find.text('5'), findsOneWidget);
    });

    testWidgets('agotado: no se puede añadir', (tester) async {
      final backend = withKit();
      setStock(backend, 2, 1); // pide 2 mordedores
      await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/combos',
      );
      expect(find.text('Agotado por ahora'), findsOneWidget);
      expect(find.text('Añadir combo'), findsNothing);
    });

    testWidgets('si pasa de 20 unidades no añade nada y avisa', (tester) async {
      final backend = withKit();
      backend.carts[ana] = {'v-mord': 19};
      final app = await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/combos',
      );
      await tapText(app, 'Añadir combo');
      expect(
        find.text(
          'Puedes llevar hasta 20 unidades de Mordedor de caucho (Talla M)',
        ),
        findsOneWidget,
      );
      // Todo o nada: ni siquiera el alimento entró.
      expect(backend.carts[ana], {'v-mord': 19});
    });

    testWidgets('si el stock cambió, avisa y recarga la lista', (tester) async {
      final backend = withKit();
      final app = await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/combos',
      );
      setStock(backend, 0, 0);
      await tapText(app, 'Añadir combo');
      expect(find.textContaining('está agotado'), findsOneWidget);
      expect(backend.carts[ana] ?? {}, isEmpty);
      expect(find.text('Agotado por ahora'), findsOneWidget);
    });

    testWidgets('el inicio enlaza a los combos', (tester) async {
      final app = await startApp(tester, backend: withKit());
      await tapText(app, 'Ver combos');
      expect(app.router.state.uri.path, '/combos');
      expect(find.text('Kit de paseo'), findsOneWidget);
    });
  });

  group('carrito con combos', () {
    Future<TestApp> openCart(
      WidgetTester tester,
      FakeBackend backend,
      Map<String, int> items,
    ) {
      backend.carts[ana] = items;
      return startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/carrito',
      );
    }

    testWidgets('descuenta el combo completo y muestra el ahorro', (
      tester,
    ) async {
      await openCart(tester, withKit(), {'v-1kg': 1, 'v-mord': 2});
      expect(find.text('Precio por separado'), findsOneWidget);
      expect(find.text(r'$28,70'), findsOneWidget);
      expect(find.text('Combo Kit de paseo'), findsOneWidget);
      expect(find.text(r'−$3,70'), findsOneWidget);
      // Lo que se paga: 25,00 $ → 912,50 Bs.
      expect(find.text(r'$25,00'), findsOneWidget);
      expect(find.text('Bs. 912,50'), findsOneWidget);
      expect(find.text('Tu pedido tiene envío gratis.'), findsOneWidget);
    });

    testWidgets('el envío gratis se mide con lo que se paga', (tester) async {
      // Por separado serían 28,70 $, pero el combo deja 24,00 $.
      await openCart(tester, withKit(price: 2400), {'v-1kg': 1, 'v-mord': 2});
      expect(find.text(r'$24,00'), findsOneWidget);
      expect(
        find.text(r'Te faltan $1,00 para el envío gratis.'),
        findsOneWidget,
      );
    });

    testWidgets('un combo completo varias veces', (tester) async {
      await openCart(tester, withKit(), {'v-1kg': 2, 'v-mord': 4});
      expect(find.text('Combo Kit de paseo × 2'), findsOneWidget);
      expect(find.text(r'−$7,40'), findsOneWidget);
    });

    testWidgets('sin el combo completo no hay descuento', (tester) async {
      await openCart(tester, withKit(), {'v-1kg': 1, 'v-mord': 1});
      expect(find.text('Precio por separado'), findsNothing);
      expect(find.textContaining('Combo'), findsNothing);
      expect(find.text(r'$19,80'), findsOneWidget);
    });

    testWidgets('quitar un producto del combo quita el descuento', (
      tester,
    ) async {
      final app = await openCart(tester, withKit(), {'v-1kg': 1, 'v-mord': 2});
      await tester.tap(find.byTooltip('Quitar Alimento seco adulto'));
      await app.settle();
      expect(find.text('Combo Kit de paseo'), findsNothing);
      expect(find.text('Precio por separado'), findsNothing);
      expect(find.text(r'$17,80'), findsWidgets);
    });

    testWidgets('avisa que el cupón se aplica al pagar', (tester) async {
      await openCart(tester, FakeBackend(), {'v-mord': 1});
      expect(
        find.text('¿Tienes un cupón? Lo aplicas al finalizar la compra.'),
        findsOneWidget,
      );
    });
  });

  group('cupón en el checkout', () {
    FakeBackend shop({
      Map<String, int> items = const {'v-mord': 2}, // 17,80 $
      Json? coupon,
      bool withCombo = false,
    }) {
      final backend = FakeBackend()
        ..coupons.add(coupon ?? FakeBackend.coupon('VERANO-10'));
      if (withCombo) backend.combos.add(kit());
      backend.carts[ana] = {...items};
      backend.addAddress(ana);
      return backend;
    }

    Future<TestApp> open(WidgetTester tester, FakeBackend backend) => startApp(
      tester,
      backend: backend,
      signedInAs: ana,
      location: '/checkout',
    );

    Finder couponField() => find.widgetWithText(TextField, 'Código del cupón');

    Future<void> apply(TestApp app, String code) async {
      await scrollToTop(app);
      await scrollTo(app.tester, couponField());
      await app.tester.enterText(couponField(), code);
      await app.tester.pump();
      await tapText(app, 'Aplicar');
    }

    Future<void> confirm(TestApp app) async {
      await scrollTo(app.tester, find.byType(CheckboxListTile));
      await app.tester.tap(find.byType(CheckboxListTile));
      await app.settle();
      await tapText(app, 'Confirmar pedido');
    }

    testWidgets('sin cupón: muestra el campo y la regla', (tester) async {
      final app = await open(tester, shop());
      await scrollTo(tester, couponField());
      expect(find.text('Cupón de descuento'), findsOneWidget);
      expect(
        find.text(
          'Un cupón por pedido. Se aplica sobre los productos, no sobre el envío.',
        ),
        findsOneWidget,
      );
      expect(find.text('Quitar cupón'), findsNothing);
      expect(app.backend.called('GET', '/cart'), hasLength(1));
    });

    testWidgets('aplica el cupón (en mayúsculas) y recalcula el total', (
      tester,
    ) async {
      final backend = shop();
      final app = await open(tester, backend);
      await apply(app, '  verano-10 ');
      expect(
        backend.called('GET', '/cart').last.url.queryParameters['coupon'],
        'VERANO-10',
      );
      expect(find.text('VERANO-10: Descuento de prueba'), findsOneWidget);
      expect(find.text('Quitar cupón'), findsOneWidget);
      await scrollTo(tester, find.text('Total'));
      // 17,80 − 1,78 = 16,02 + 3,00 de envío = 19,02 $
      expect(find.text('Productos (precio de lista)'), findsOneWidget);
      expect(find.text(r'$17,80'), findsOneWidget);
      expect(find.text('Cupón VERANO-10'), findsOneWidget);
      expect(find.text(r'−$1,78'), findsOneWidget);
      expect(find.text(r'$16,02'), findsOneWidget);
      expect(find.text(r'$19,02'), findsWidgets);
      expect(find.text('Bs. 694,23'), findsWidgets); // 19,02 × 36,5
    });

    testWidgets('el pedido lleva el cupón y se ve en su detalle', (
      tester,
    ) async {
      final backend = shop();
      final app = await open(tester, backend);
      await apply(app, 'VERANO-10');
      await confirm(app);
      expect(lastBody(backend, 'POST', '/orders'), {
        'addressId': 'ad-1',
        'shippingZoneId': 'z-caracas',
        'paymentMethodId': 'm-pm',
        'acceptTerms': true,
        'couponCode': 'VERANO-10',
      });
      expect(find.text('Pedido PB-000001'), findsOneWidget);
      await scrollTo(tester, find.text('Cupón VERANO-10'));
      expect(find.text('Cupón VERANO-10'), findsOneWidget);
      expect(find.text(r'−$1,78'), findsOneWidget);
      expect(find.text('Combos'), findsNothing);
      expect(find.text(r'$19,02'), findsWidgets);
    });

    testWidgets('sin cupón el pedido no manda el campo', (tester) async {
      final backend = shop();
      final app = await open(tester, backend);
      await confirm(app);
      expect(
        lastBody(backend, 'POST', '/orders').containsKey('couponCode'),
        isFalse,
      );
      await scrollTo(tester, find.text('Total'));
      expect(find.textContaining('Cupón'), findsNothing);
    });

    testWidgets('valida el código antes de preguntar a la API', (tester) async {
      final backend = shop();
      final app = await open(tester, backend);
      await apply(app, '');
      expect(find.text('Escribe el código del cupón'), findsOneWidget);
      await apply(app, 'AB');
      expect(
        find.text('El cupón tiene de 3 a 30 letras, números o guiones'),
        findsOneWidget,
      );
      await apply(app, 'VERANO 10');
      expect(
        find.text('El cupón tiene de 3 a 30 letras, números o guiones'),
        findsOneWidget,
      );
      await apply(app, '-VERANO');
      expect(
        find.text('El cupón tiene de 3 a 30 letras, números o guiones'),
        findsOneWidget,
      );
      expect(backend.called('GET', '/cart').length, 1); // solo la carga
    });

    for (final c in [
      (
        'no existe',
        'FANTASMA',
        null,
        'Ese cupón no existe o ya no está activo',
      ),
      (
        'está apagado',
        'APAGADO',
        FakeBackend.coupon('APAGADO', active: false),
        'Ese cupón no existe o ya no está activo',
      ),
      (
        'todavía no empieza',
        'PRONTO',
        FakeBackend.coupon('PRONTO', startsAt: DateTime.utc(2026, 12, 1)),
        'Ese cupón todavía no está vigente',
      ),
      (
        'ya venció',
        'VENCIDO',
        FakeBackend.coupon('VENCIDO', endsAt: DateTime.utc(2026, 11, 1)),
        'Ese cupón ya venció',
      ),
      (
        'pide una compra mínima',
        'GRANDE',
        FakeBackend.coupon('GRANDE', minSubtotalUsdCents: 5000),
        'Ese cupón aplica en compras desde',
      ),
      (
        'se agotó',
        'AGOTADO',
        FakeBackend.coupon('AGOTADO', maxRedemptions: 0),
        'Ese cupón ya se agotó',
      ),
    ]) {
      testWidgets('rechazo de la API: ${c.$1}', (tester) async {
        final backend = shop();
        if (c.$3 != null) backend.coupons.add(c.$3!);
        final app = await open(tester, backend);
        await apply(app, c.$2);
        expect(find.textContaining(c.$4), findsOneWidget);
        // Sin cupón: el total sigue siendo el real y se puede pedir igual.
        expect(find.text('Quitar cupón'), findsNothing);
        await scrollTo(tester, find.text('Total'));
        expect(find.text(r'$20,80'), findsWidgets);
        expect(find.text('Cupón ${c.$2}'), findsNothing);
        await confirm(app);
        expect(
          lastBody(backend, 'POST', '/orders').containsKey('couponCode'),
          isFalse,
        );
        expect(find.text('Pedido PB-000001'), findsOneWidget);
      });
    }

    testWidgets('un cupón ya usado por la persona no se repite', (
      tester,
    ) async {
      final backend = shop();
      backend.seedOrder(ana, items: {'v-mord': 1});
      backend.orders.last['couponCode'] = 'VERANO-10';
      backend.carts[ana] = {'v-mord': 2}; // el pedido vació el carrito
      final app = await open(tester, backend);
      await apply(app, 'VERANO-10');
      expect(find.text('Ya usaste este cupón'), findsOneWidget);
      // Un pedido cancelado libera el uso.
      backend.orders.last['status'] = 'CANCELLED';
      await apply(app, 'VERANO-10');
      expect(find.text('Ya usaste este cupón'), findsNothing);
      expect(find.text('Quitar cupón'), findsOneWidget);
    });

    testWidgets('quitar el cupón vuelve al total sin descuento', (
      tester,
    ) async {
      final backend = shop();
      final app = await open(tester, backend);
      await apply(app, 'VERANO-10');
      await tapText(app, 'Quitar cupón');
      expect(find.text('Quitar cupón'), findsNothing);
      expect(couponField(), findsOneWidget);
      // El campo queda limpio.
      expect(tester.widget<TextField>(couponField()).controller!.text, '');
      await scrollTo(tester, find.text('Total'));
      expect(find.text(r'$20,80'), findsWidgets);
      await confirm(app);
      expect(
        lastBody(backend, 'POST', '/orders').containsKey('couponCode'),
        isFalse,
      );
    });

    testWidgets('un error al probar el cupón se borra al aplicar otro', (
      tester,
    ) async {
      final backend = shop();
      final app = await open(tester, backend);
      await apply(app, 'FANTASMA');
      expect(find.textContaining('no existe'), findsOneWidget);
      await apply(app, 'VERANO-10');
      expect(find.textContaining('no existe'), findsNothing);
      expect(find.text('Quitar cupón'), findsOneWidget);
    });

    testWidgets('monto fijo: nunca deja los productos en negativo', (
      tester,
    ) async {
      final backend = shop(
        coupon: FakeBackend.coupon('MUCHO', type: 'FIXED', value: 5000),
      );
      final app = await open(tester, backend);
      await apply(app, 'MUCHO');
      await scrollTo(tester, find.text('Total'));
      expect(find.text(r'−$17,80'), findsOneWidget);
      // Productos gratis: queda solo el envío.
      expect(find.text(r'$0,00'), findsOneWidget);
      expect(find.text(r'$3,00'), findsWidgets);
    });

    testWidgets('porcentaje con tope', (tester) async {
      final backend = shop(
        coupon: FakeBackend.coupon('TOPE', value: 50, maxDiscountUsdCents: 500),
      );
      final app = await open(tester, backend);
      await apply(app, 'TOPE');
      await scrollTo(tester, find.text('Total'));
      expect(find.text(r'−$5,00'), findsOneWidget);
    });

    testWidgets('se aplica después de los combos y nunca al envío', (
      tester,
    ) async {
      // 28,70 − 3,70 de combo = 25,00; 10 % = 2,50 → 22,50 + 3,00 de envío.
      final backend = shop(items: {'v-1kg': 1, 'v-mord': 2}, withCombo: true);
      final app = await open(tester, backend);
      await apply(app, 'VERANO-10');
      await scrollTo(tester, find.text('Total'));
      expect(find.text('Combo Kit de paseo'), findsOneWidget);
      expect(find.text(r'−$3,70'), findsOneWidget);
      expect(find.text(r'−$2,50'), findsOneWidget);
      expect(find.text(r'$22,50'), findsOneWidget);
      expect(find.text(r'$25,50'), findsWidgets);
    });

    testWidgets('el envío gratis se mide con lo pagado, no con la lista', (
      tester,
    ) async {
      // 32,70 $ de lista (gratis); con 8 $ de cupón quedan 24,70 $: se cobra.
      final backend = shop(
        items: {'v-1kg': 3},
        coupon: FakeBackend.coupon('OCHO', type: 'FIXED', value: 800),
      );
      final app = await open(tester, backend);
      expect(find.text('Delivery propio · Gratis'), findsOneWidget);
      await apply(app, 'OCHO');
      await scrollToTop(app);
      await scrollTo(tester, find.text('Delivery propio · \$3,00'));
      expect(find.text('Delivery propio · Gratis'), findsNothing);
      expect(find.text(r'$27,70'), findsWidgets); // 24,70 + 3,00
    });

    testWidgets('el combo solo ya muestra su ahorro en el checkout', (
      tester,
    ) async {
      final backend = shop(items: {'v-1kg': 1, 'v-mord': 2}, withCombo: true);
      final app = await open(tester, backend);
      expect(find.text('Delivery propio · Gratis'), findsOneWidget);
      await scrollTo(tester, find.text('Total'));
      expect(find.text('Productos (precio de lista)'), findsOneWidget);
      expect(find.text('Combo Kit de paseo'), findsOneWidget);
      expect(find.text(r'$25,00'), findsWidgets);
      expect(app.router.state.uri.path, '/checkout');
    });

    testWidgets('si el cupón deja de valer al confirmar, avisa y lo quita', (
      tester,
    ) async {
      final backend = shop();
      final app = await open(tester, backend);
      await apply(app, 'VERANO-10');
      // Mientras tanto, otra persona usó el último cupón.
      backend.coupons.single['maxRedemptions'] = 0;
      await confirm(app);
      expect(app.router.state.uri.path, '/checkout');
      await scrollToTop(app);
      expect(find.text('Ese cupón ya se agotó'), findsOneWidget);
      expect(find.text('Quitar cupón'), findsNothing);
      await scrollTo(tester, find.text('Total'));
      expect(find.text(r'$20,80'), findsWidgets);
      await tapText(app, 'Confirmar pedido');
      expect(find.text('Pedido PB-000001'), findsOneWidget);
    });

    testWidgets('un cambio en el carrito invalida el cupón probado', (
      tester,
    ) async {
      final backend = shop();
      final app = await open(tester, backend);
      await apply(app, 'VERANO-10');
      expect(find.text('Quitar cupón'), findsOneWidget);
      // Se recarga el carrito (p. ej. tras un error de stock).
      app.container.invalidate(cartProvider);
      await app.settle();
      expect(find.text('Quitar cupón'), findsNothing);
    });
  });

  group('devolución con descuentos', () {
    Future<TestApp> openReturn(WidgetTester tester, FakeBackend backend) async {
      final app = await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/pedidos/o-1',
      );
      await tapText(app, 'Pedir devolución');
      return app;
    }

    testWidgets('estima lo pagado, no el precio de lista', (tester) async {
      final backend = FakeBackend();
      final order = backend.seedOrder(
        ana,
        status: 'DELIVERED',
        items: {'v-mord': 2}, // 17,80 $
      );
      // Un cupón de 1,78 $: se pagaron 16,02 de 17,80.
      order['couponDiscountUsdCents'] = 178;
      order['couponCode'] = 'VERANO-10';
      final app = await openReturn(tester, backend);
      // 8,90 × 16,02 / 17,80 = 8,01
      expect(find.textContaining(r'equivalente a $8,01'), findsNothing);
      await tester.tap(
        find.descendant(
          of: find.byType(BottomSheet),
          matching: find.widgetWithIcon(IconButton, Icons.add),
        ),
      );
      await app.settle();
      expect(find.textContaining(r'equivalente a $8,01'), findsOneWidget);
    });

    testWidgets('sin descuentos devuelve el precio de lista', (tester) async {
      final backend = FakeBackend();
      backend.seedOrder(ana, status: 'DELIVERED', items: {'v-mord': 2});
      final app = await openReturn(tester, backend);
      await tester.tap(
        find.descendant(
          of: find.byType(BottomSheet),
          matching: find.widgetWithIcon(IconButton, Icons.add),
        ),
      );
      await app.settle();
      expect(find.textContaining(r'equivalente a $8,90'), findsOneWidget);
    });

    testWidgets('la API reembolsa lo mismo que estimó la app', (tester) async {
      final backend = FakeBackend();
      final order = backend.seedOrder(
        ana,
        status: 'DELIVERED',
        items: {'v-mord': 2},
      );
      order['comboDiscountUsdCents'] = 100;
      order['couponDiscountUsdCents'] = 78;
      final app = await openReturn(tester, backend);
      await tester.tap(
        find.descendant(
          of: find.byType(BottomSheet),
          matching: find.widgetWithIcon(IconButton, Icons.add),
        ),
      );
      await app.settle();
      // 890 × (1780 − 178) / 1780 = 801
      expect(find.textContaining(r'equivalente a $8,01'), findsOneWidget);
      await tester.enterText(
        find.descendant(
          of: find.byType(BottomSheet),
          matching: find.byType(TextFormField),
        ),
        'El mordedor llegó roto',
      );
      await tapText(app, 'Enviar solicitud');
      final request = (backend.orders.first['returns']! as List).first as Json;
      expect(request['refundUsdCents'], 801);
    });
  });

  group('pedido con descuentos', () {
    testWidgets('muestra combos y cupón solo cuando los hay', (tester) async {
      final backend = FakeBackend();
      final order = backend.seedOrder(ana, items: {'v-1kg': 1, 'v-mord': 2});
      order['comboDiscountUsdCents'] = 370;
      order['couponDiscountUsdCents'] = 250;
      order['couponCode'] = 'VERANO-10';
      await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/pedidos/o-1',
      );
      await scrollTo(tester, find.text('Combos'));
      expect(find.text('Combos'), findsOneWidget);
      expect(find.text(r'−$3,70'), findsOneWidget);
      expect(find.text('Cupón VERANO-10'), findsOneWidget);
      expect(find.text(r'−$2,50'), findsOneWidget);
    });

    testWidgets('un pedido anterior a los descuentos se lee igual', (
      tester,
    ) async {
      final backend = FakeBackend();
      final order = backend.seedOrder(ana);
      order
        ..remove('comboDiscountUsdCents')
        ..remove('couponDiscountUsdCents')
        ..remove('couponCode');
      await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/pedidos/o-1',
      );
      await scrollTo(tester, find.text('Subtotal'));
      expect(find.text('Subtotal'), findsOneWidget);
      expect(find.text('Combos'), findsNothing);
      expect(find.textContaining('Cupón'), findsNothing);
    });
  });
}
