import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:material_ui/material_ui.dart';
import 'package:petbf/core/providers.dart';

import '../support/fake_backend.dart';
import '../support/harness.dart';

const ana = 'ana@petbf.com';

Json lastBody(FakeBackend b, String method, String path) =>
    jsonDecode(b.called(method, path).last.body) as Json;

http.Response failure(int status, String message) => http.Response(
  jsonEncode({'statusCode': status, 'message': message}),
  status,
  headers: {'content-type': 'application/json'},
);

Future<void> scrollToTop(TestApp app) async {
  await app.tester.drag(verticalScrollable, const Offset(0, 3000));
  await app.settle();
}

void main() {
  group('mis puntos', () {
    testWidgets('sin sesión pide entrar y vuelve a los puntos', (tester) async {
      final app = await startApp(tester, location: '/cuenta/puntos');
      expect(app.router.state.uri.path, '/entrar');
      expect(app.router.state.uri.queryParameters['next'], '/cuenta/puntos');
    });

    testWidgets('sin movimientos: saldo en cero', (tester) async {
      await startApp(tester, signedInAs: ana, location: '/cuenta/puntos');
      expect(find.text('0 puntos'), findsOneWidget);
      expect(find.text(r'Equivalen a $0,00'), findsOneWidget);
      expect(find.text('Todavía no tienes movimientos.'), findsOneWidget);
      expect(find.textContaining('Cada 100 puntos valen 1'), findsOneWidget);
    });

    testWidgets('saldo, valor y cada tipo de movimiento', (tester) async {
      final backend = FakeBackend();
      final order = backend.seedOrder(ana, status: 'DELIVERED');
      backend.pointsEntries.clear(); // solo los de la prueba
      backend
        ..addPoints(ana, 18, reason: 'EARNED', order: order)
        ..addPoints(ana, -500, reason: 'REDEEMED', order: order)
        ..addPoints(ana, 500, reason: 'RESTORED', note: 'Pedido cancelado')
        ..addPoints(ana, -9, reason: 'REVERSED', note: 'Reembolso')
        ..addPoints(ana, 250, reason: 'ADJUSTED', note: 'Cortesía');
      await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/cuenta/puntos',
      );
      // 18 − 500 + 500 − 9 + 250 = 259 puntos = 2,59 $
      expect(find.text('259 puntos'), findsOneWidget);
      expect(find.text(r'Equivalen a $2,59'), findsOneWidget);
      // Del más reciente al más antiguo.
      expect(find.text('Ajuste de la tienda'), findsOneWidget);
      expect(find.text('Descontados por un reembolso'), findsOneWidget);
      expect(find.text('Devueltos'), findsOneWidget);
      await scrollTo(tester, find.text('Ganados por tu pedido'));
      expect(find.text('Usados en tu pedido'), findsOneWidget);
      expect(find.text('Ganados por tu pedido'), findsOneWidget);
      expect(find.text('+250'), findsOneWidget);
      expect(find.text('−9'), findsOneWidget);
      expect(find.text('+500'), findsOneWidget);
      expect(find.text('−500'), findsOneWidget);
      expect(find.text('+18'), findsOneWidget);
      expect(find.textContaining('Cortesía'), findsOneWidget);
      expect(find.text('Pedido PB-000001'), findsWidgets);
    });

    testWidgets('el pedido de un movimiento abre su detalle', (tester) async {
      final backend = FakeBackend();
      final order = backend.seedOrder(ana, status: 'DELIVERED');
      backend.pointsEntries.clear();
      backend.addPoints(ana, 17, reason: 'EARNED', order: order);
      final app = await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/cuenta/puntos',
      );
      await tapText(app, 'Pedido PB-000001');
      expect(app.router.state.uri.path, '/pedidos/o-1');
    });

    testWidgets('pagina de 20 en 20 con "Ver más"', (tester) async {
      final backend = FakeBackend();
      for (var i = 1; i <= 25; i++) {
        backend.addPoints(ana, i, note: 'Movimiento $i');
      }
      final app = await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/cuenta/puntos',
      );
      expect(
        backend.called('GET', '/points').first.url.queryParameters['pageSize'],
        '1',
      ); // el saldo pide solo uno
      expect(backend.called('GET', '/points').last.url.queryParameters, {
        'page': '1',
        'pageSize': '20',
      });
      expect(find.text('325 puntos'), findsOneWidget);
      expect(find.textContaining('Movimiento 25'), findsOneWidget);
      await scrollTo(tester, find.text('Ver más'));
      expect(find.textContaining('Movimiento 5 '), findsNothing);
      await tapText(app, 'Ver más');
      expect(
        backend.called('GET', '/points').last.url.queryParameters['page'],
        '2',
      );
      await scrollTo(tester, find.textContaining('Movimiento 1'));
      expect(find.text('Ver más'), findsNothing);
    });

    testWidgets('error al cargar y reintentar', (tester) async {
      final backend = FakeBackend()..addPoints(ana, 100);
      backend.overrides['GET /points'] = (_) => failure(500, 'Error interno');
      final app = await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/cuenta/puntos',
      );
      expect(find.text('Reintentar'), findsOneWidget);
      backend.overrides.clear();
      await tapText(app, 'Reintentar');
      expect(find.text('100 puntos'), findsOneWidget);
    });

    testWidgets('la cuenta muestra el saldo y enlaza a los puntos', (
      tester,
    ) async {
      final backend = FakeBackend()..addPoints(ana, 340);
      final app = await startApp(tester, backend: backend, signedInAs: ana);
      await app.go('/cuenta');
      expect(find.text('Mis puntos'), findsOneWidget);
      expect(find.text('340 puntos'), findsOneWidget);
      await tapText(app, 'Mis puntos');
      expect(app.router.state.uri.path, '/cuenta/puntos');
    });
  });

  group('usar puntos en el checkout', () {
    FakeBackend shop({
      int points = 1000,
      Map<String, int> items = const {'v-mord': 2}, // 17,80 $
    }) {
      final backend = FakeBackend();
      backend.carts[ana] = {...items};
      backend.addAddress(ana);
      if (points > 0) backend.addPoints(ana, points);
      return backend;
    }

    Future<TestApp> open(WidgetTester tester, FakeBackend backend) => startApp(
      tester,
      backend: backend,
      signedInAs: ana,
      location: '/checkout',
    );

    Finder pointsField() => find.widgetWithText(TextField, 'Puntos a usar');

    Future<void> enter(TestApp app, String text) async {
      await scrollToTop(app);
      await scrollTo(app.tester, pointsField());
      await app.tester.enterText(pointsField(), text);
      await app.settle();
    }

    Future<void> confirm(TestApp app) async {
      await scrollTo(app.tester, find.byType(CheckboxListTile));
      await app.tester.tap(find.byType(CheckboxListTile));
      await app.settle();
      await tapText(app, 'Confirmar pedido');
    }

    testWidgets('sin saldo no muestra el campo', (tester) async {
      await open(tester, shop(points: 0));
      expect(find.text('Usar mis puntos'), findsNothing);
    });

    testWidgets('con menos de 100 puntos no muestra el campo', (tester) async {
      await open(tester, shop(points: 99));
      expect(find.text('Usar mis puntos'), findsNothing);
    });

    testWidgets('explica el saldo y el máximo del pedido', (tester) async {
      final app = await open(tester, shop());
      await scrollTo(app.tester, pointsField());
      // 17,80 $ en productos: hasta 1700 puntos, pero solo hay 1000.
      expect(
        find.text(
          'Tienes 1000 puntos. En este pedido puedes usar hasta 1000 '
          '(100 puntos = 1 \$).',
        ),
        findsOneWidget,
      );
    });

    testWidgets('el máximo se limita a lo que se paga por los productos', (
      tester,
    ) async {
      // 17,80 $ de productos: no se pueden usar más de 1700 puntos.
      final app = await open(tester, shop(points: 5000));
      await scrollTo(app.tester, pointsField());
      expect(
        find.textContaining('puedes usar hasta 1700 (100 puntos = 1'),
        findsOneWidget,
      );
      await tapText(app, 'Usar el máximo');
      expect(
        app.tester.widget<TextField>(pointsField()).controller!.text,
        '1700',
      );
    });

    testWidgets('descuenta del total y recalcula el envío', (tester) async {
      final app = await open(tester, shop());
      await enter(app, '500');
      await scrollTo(app.tester, find.text('Total'));
      // 17,80 − 5,00 = 12,80 + 3,00 de envío = 15,80 $
      expect(find.text('Puntos (500)'), findsOneWidget);
      expect(find.text(r'−$5,00'), findsOneWidget);
      expect(find.text(r'$12,80'), findsOneWidget);
      expect(find.text(r'$15,80'), findsWidgets);
      expect(find.text('Bs. 576,70'), findsWidgets); // 15,80 × 36,5
      // Y avisa cuántos puntos ganará lo que se paga: 12 por 12,80 $.
      expect(
        find.text('Ganarás 12 puntos al recibir tu pedido.'),
        findsOneWidget,
      );
    });

    testWidgets('sin usar puntos, gana por el total de los productos', (
      tester,
    ) async {
      final app = await open(tester, shop());
      await scrollTo(app.tester, find.text('Total'));
      expect(
        find.text('Ganarás 17 puntos al recibir tu pedido.'),
        findsOneWidget,
      );
    });

    testWidgets('el envío gratis se mide con lo pagado tras los puntos', (
      tester,
    ) async {
      // 32,70 $ de lista (gratis); con 800 puntos quedan 24,70: se cobra.
      final app = await open(tester, shop(items: {'v-1kg': 3}));
      expect(find.text('Delivery propio · Gratis'), findsOneWidget);
      await enter(app, '800');
      await scrollToTop(app);
      await scrollTo(app.tester, find.text('Delivery propio · \$3,00'));
      expect(find.text('Delivery propio · Gratis'), findsNothing);
    });

    testWidgets('manda los puntos con el pedido y se ven en su detalle', (
      tester,
    ) async {
      final backend = shop();
      final app = await open(tester, backend);
      await enter(app, '500');
      await confirm(app);
      expect(lastBody(backend, 'POST', '/orders')['points'], 500);
      expect(find.text('Pedido PB-000001'), findsOneWidget);
      await scrollTo(app.tester, find.text('Puntos (500)'));
      expect(find.text('Puntos (500)'), findsOneWidget);
      expect(find.text(r'−$5,00'), findsOneWidget);
      expect(find.text(r'$15,80'), findsWidgets);
      // El saldo bajó y el movimiento quedó registrado.
      expect(backend.pointsBalance(ana), 500);
      expect(backend.pointsEntries.last, containsPair('reason', 'REDEEMED'));
    });

    testWidgets('sin puntos el pedido no manda el campo', (tester) async {
      final backend = shop();
      final app = await open(tester, backend);
      await confirm(app);
      expect(
        lastBody(backend, 'POST', '/orders').containsKey('points'),
        isFalse,
      );
      expect(backend.pointsBalance(ana), 1000);
    });

    testWidgets('un campo en cero tampoco manda puntos', (tester) async {
      final backend = shop();
      final app = await open(tester, backend);
      await enter(app, '0');
      await confirm(app);
      expect(
        lastBody(backend, 'POST', '/orders').containsKey('points'),
        isFalse,
      );
    });

    for (final c in [
      ('con letras', '5a', 'Escribe solo números enteros'),
      ('con decimales', '100.5', 'Escribe solo números enteros'),
      ('negativo', '-100', 'Escribe solo números enteros'),
      ('que no es de 100 en 100', '150', 'Los puntos se canjean de 100 en 100'),
      (
        'más que el saldo',
        '1100',
        'En este pedido puedes usar hasta 1000 puntos',
      ),
    ]) {
      testWidgets('valida el campo: ${c.$1}', (tester) async {
        final backend = shop();
        final app = await open(tester, backend);
        await enter(app, c.$2);
        expect(find.text(c.$3), findsOneWidget);
        // Mientras sea inválido no se descuenta ni se puede confirmar.
        await scrollTo(app.tester, find.text('Total'));
        expect(find.text('Puntos (${c.$2})'), findsNothing);
        expect(find.text(r'$20,80'), findsWidgets);
        final button = find.widgetWithText(FilledButton, 'Confirmar pedido');
        await scrollTo(app.tester, button);
        expect(app.tester.widget<FilledButton>(button).onPressed, isNull);
        expect(backend.called('POST', '/orders'), isEmpty);
      });
    }

    testWidgets('al corregir el valor se puede confirmar', (tester) async {
      final backend = shop();
      final app = await open(tester, backend);
      await enter(app, '150');
      await enter(app, '100');
      expect(find.text('Los puntos se canjean de 100 en 100'), findsNothing);
      await confirm(app);
      expect(lastBody(backend, 'POST', '/orders')['points'], 100);
    });

    testWidgets('un cupón que baja el total ajusta el máximo', (tester) async {
      // 17,80 con un cupón de 10 $ → 7,80: solo se pueden usar 700 puntos.
      final backend = shop(points: 5000)
        ..coupons.add(FakeBackend.coupon('DIEZ', type: 'FIXED', value: 1000));
      final app = await open(tester, backend);
      await enter(app, '1700');
      expect(find.text('Los puntos se canjean de 100 en 100'), findsNothing);
      await scrollTo(
        app.tester,
        find.widgetWithText(TextField, 'Código del cupón'),
      );
      await app.tester.enterText(
        find.widgetWithText(TextField, 'Código del cupón'),
        'DIEZ',
      );
      await tapText(app, 'Aplicar');
      await scrollTo(app.tester, pointsField());
      expect(
        find.text('En este pedido puedes usar hasta 700 puntos'),
        findsOneWidget,
      );
      await enter(app, '700');
      await scrollTo(app.tester, find.text('Total'));
      // 7,80 − 7,00 = 0,80 + 3,00 de envío = 3,80 $
      expect(find.text(r'$3,80'), findsWidgets);
    });

    testWidgets('si el cupón deja el pedido sin productos que pagar, no hay '
        'campo de puntos', (tester) async {
      final backend = shop(points: 5000)
        ..coupons.add(FakeBackend.coupon('TODO', type: 'FIXED', value: 5000));
      final app = await open(tester, backend);
      await scrollTo(
        app.tester,
        find.widgetWithText(TextField, 'Código del cupón'),
      );
      await app.tester.enterText(
        find.widgetWithText(TextField, 'Código del cupón'),
        'TODO',
      );
      await tapText(app, 'Aplicar');
      expect(find.text('Usar mis puntos'), findsNothing);
    });

    testWidgets('si el saldo bajó al confirmar, avisa y lo vuelve a leer', (
      tester,
    ) async {
      final backend = shop();
      final app = await open(tester, backend);
      await enter(app, '800');
      // Mientras tanto, el saldo bajó (otro pedido, un reembolso).
      backend.addPoints(ana, -600);
      await confirm(app);
      expect(app.router.state.uri.path, '/checkout');
      await scrollToTop(app);
      expect(find.text('Tienes 400 puntos'), findsOneWidget);
      // El saldo se actualizó y 800 ya no vale.
      await scrollTo(app.tester, pointsField());
      // El error del campo tapa la ayuda, pero ya usa el saldo nuevo.
      expect(
        find.text('En este pedido puedes usar hasta 400 puntos'),
        findsOneWidget,
      );
      await enter(app, '400');
      expect(find.textContaining('Tienes 400 puntos. En este'), findsOneWidget);
      // La casilla de condiciones sigue marcada: solo falta confirmar.
      await tapText(app, 'Confirmar pedido');
      expect(app.router.state.uri.path, startsWith('/pedidos/'));
      expect(lastBody(backend, 'POST', '/orders')['points'], 400);
    });

    testWidgets('el motivo del rechazo de la API se muestra tal cual', (
      tester,
    ) async {
      final backend = shop();
      final app = await open(tester, backend);
      await enter(app, '500');
      backend.overrides['POST /orders'] = (_) =>
          failure(400, 'En este pedido puedes usar como máximo 300 puntos');
      await confirm(app);
      await scrollToTop(app);
      expect(
        find.text('En este pedido puedes usar como máximo 300 puntos'),
        findsOneWidget,
      );
      expect(app.router.state.uri.path, '/checkout');
    });

    testWidgets('sin lograr leer el saldo el checkout sigue funcionando', (
      tester,
    ) async {
      final backend = shop();
      backend.overrides['GET /points'] = (_) => failure(500, 'Error interno');
      final app = await open(tester, backend);
      expect(find.text('Usar mis puntos'), findsNothing);
      await confirm(app);
      expect(find.text('Pedido PB-000001'), findsOneWidget);
    });
  });

  group('pedido con puntos', () {
    testWidgets('muestra los puntos usados y los ganados', (tester) async {
      final backend = FakeBackend();
      final order = backend.seedOrder(ana, status: 'DELIVERED');
      order['pointsRedeemed'] = 500;
      order['pointsDiscountUsdCents'] = 500;
      order['pointsEarned'] = 12;
      await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/pedidos/o-1',
      );
      await scrollTo(tester, find.text('Puntos (500)'));
      expect(find.text(r'−$5,00'), findsOneWidget);
      expect(find.text('Con este pedido ganaste 12 puntos.'), findsOneWidget);
    });

    testWidgets('un pedido pendiente aún no ganó puntos', (tester) async {
      final backend = FakeBackend();
      backend.seedOrder(ana);
      await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/pedidos/o-1',
      );
      await scrollTo(tester, find.text('Subtotal'));
      expect(find.textContaining('ganaste'), findsNothing);
      expect(find.textContaining('Puntos ('), findsNothing);
    });

    testWidgets('al entregarse, el pedido suma sus puntos al saldo', (
      tester,
    ) async {
      final backend = FakeBackend();
      backend.seedOrder(ana, status: 'DELIVERED');
      // 17,80 $ en productos: 17 puntos.
      expect(backend.pointsBalance(ana), 17);
      await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/cuenta/puntos',
      );
      expect(find.text('17 puntos'), findsOneWidget);
      expect(find.text('Ganados por tu pedido'), findsOneWidget);
    });

    testWidgets('cancelar devuelve los puntos usados', (tester) async {
      final backend = FakeBackend()..addPoints(ana, 1000);
      backend.carts[ana] = {'v-mord': 2};
      backend.addAddress(ana);
      final app = await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/checkout',
      );
      await scrollTo(
        app.tester,
        find.widgetWithText(TextField, 'Puntos a usar'),
      );
      await app.tester.enterText(
        find.widgetWithText(TextField, 'Puntos a usar'),
        '500',
      );
      await app.settle();
      await scrollTo(app.tester, find.byType(CheckboxListTile));
      await app.tester.tap(find.byType(CheckboxListTile));
      await app.settle();
      await tapText(app, 'Confirmar pedido');
      expect(backend.pointsBalance(ana), 500);
      await tapText(app, 'Cancelar pedido');
      await tapText(app, 'Sí, cancelar');
      expect(backend.pointsBalance(ana), 1000);
      app.container.invalidate(pointsBalanceProvider);
      await app.go('/cuenta/puntos');
      expect(find.text('1000 puntos'), findsOneWidget);
      expect(find.text('Devueltos'), findsOneWidget);
    });
  });

  group('devolución con puntos', () {
    testWidgets('la estimación reparte también lo pagado con puntos', (
      tester,
    ) async {
      final backend = FakeBackend();
      final order = backend.seedOrder(
        ana,
        status: 'DELIVERED',
        items: {'v-mord': 2}, // 17,80 $
      );
      // 5 $ en puntos: se pagaron 12,80 de 17,80.
      order['pointsRedeemed'] = 500;
      order['pointsDiscountUsdCents'] = 500;
      final app = await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/pedidos/o-1',
      );
      await tapText(app, 'Pedir devolución');
      await tester.tap(
        find.descendant(
          of: find.byType(BottomSheet),
          matching: find.widgetWithIcon(IconButton, Icons.add),
        ),
      );
      await app.settle();
      // 890 × 1280 / 1780 = 640
      expect(find.textContaining(r'equivalente a $6,40'), findsOneWidget);
    });
  });
}
