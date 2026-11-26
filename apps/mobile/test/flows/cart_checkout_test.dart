import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:material_ui/material_ui.dart';

import '../support/fake_backend.dart';
import '../support/harness.dart';

const ana = 'ana@petbf.com';

void main() {
  group('carrito', () {
    testWidgets('sin sesión invita a entrar', (tester) async {
      await startApp(tester, location: '/carrito');
      expect(find.text('Entra a tu cuenta'), findsOneWidget);
    });

    testWidgets('vacío', (tester) async {
      final app = await startApp(tester, signedInAs: ana, location: '/carrito');
      expect(find.text('Tu carrito está vacío'), findsOneWidget);
      await tapText(app, 'Ver la tienda');
      expect(app.router.state.uri.path, '/productos');
    });

    testWidgets('líneas, subtotal en Bs y aviso de envío gratis', (
      tester,
    ) async {
      final backend = FakeBackend();
      backend.carts[ana] = {'v-mord': 2}; // 17,80 $
      await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/carrito',
      );
      expect(find.text('Mordedor de caucho'), findsOneWidget);
      expect(find.text('Subtotal (2 artículos)'), findsOneWidget);
      expect(find.text(r'$17,80'), findsWidgets);
      expect(find.text('Bs. 649,70'), findsOneWidget);
      expect(
        find.text(r'Te faltan $7,20 para el envío gratis.'),
        findsOneWidget,
      );
    });

    testWidgets('cambiar cantidad, quitar y vaciar', (tester) async {
      final backend = FakeBackend();
      backend.carts[ana] = {'v-mord': 2, 'v-1kg': 1};
      final app = await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/carrito',
      );

      await tester.tap(find.widgetWithIcon(IconButton, Icons.add).first);
      await app.settle();
      expect(backend.carts[ana]!['v-mord'], 3);
      final put = backend.called('PUT', '/cart/items/v-mord').single;
      expect(jsonDecode(put.body), {'quantity': 3});
      expect(
        find.text('Tu pedido tiene envío gratis.'),
        findsOneWidget,
      ); // 26,70 + 10,90

      await tester.tap(find.byTooltip('Quitar Alimento seco adulto'));
      await app.settle();
      expect(find.text('Alimento seco adulto'), findsNothing);
      expect(backend.carts[ana], {'v-mord': 3});

      await tapText(app, 'Vaciar');
      expect(find.text('¿Vaciar el carrito?'), findsOneWidget);
      await tester.tap(find.widgetWithText(FilledButton, 'Vaciar'));
      await app.settle();
      expect(find.text('Tu carrito está vacío'), findsOneWidget);
      expect(backend.carts[ana], isEmpty);
    });

    testWidgets('línea con menos stock: avisa, bloquea el pago y ajusta', (
      tester,
    ) async {
      final backend = FakeBackend();
      backend.carts[ana] = {'v-3kg': 3};
      backend.variantById('v-3kg')!['stock'] = 2;
      final app = await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/carrito',
      );
      expect(find.text('Solo quedan 2. Ajusta la cantidad.'), findsOneWidget);
      expect(
        find.text('Revisa los productos marcados antes de pagar.'),
        findsOneWidget,
      );
      final pay = find.widgetWithText(FilledButton, 'Ir a pagar');
      expect(tester.widget<FilledButton>(pay).onPressed, isNull);

      await tester.tap(find.widgetWithIcon(IconButton, Icons.remove));
      await app.settle();
      expect(backend.carts[ana], {'v-3kg': 2}); // directo a lo disponible
      expect(find.text('Solo quedan 2. Ajusta la cantidad.'), findsNothing);
      expect(tester.widget<FilledButton>(pay).onPressed, isNotNull);
    });

    testWidgets('línea agotada: solo se puede quitar', (tester) async {
      final backend = FakeBackend();
      backend.carts[ana] = {'v-3kg': 1};
      backend.variantById('v-3kg')!['stock'] = 0;
      await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/carrito',
      );
      expect(
        find.text('Ya no está disponible. Quítalo para continuar.'),
        findsOneWidget,
      );
      expect(
        tester
            .widget<IconButton>(find.widgetWithIcon(IconButton, Icons.add))
            .onPressed,
        isNull,
      );
    });

    testWidgets('si el stock cambió al tocar +, avisa y recarga', (
      tester,
    ) async {
      final backend = FakeBackend();
      backend.carts[ana] = {'v-1kg': 1};
      final app = await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/carrito',
      );
      backend.variantById('v-1kg')!['stock'] = 1;
      await tester.tap(find.widgetWithIcon(IconButton, Icons.add));
      await app.settle();
      expect(
        find.text('Solo hay 1 disponibles de esta presentación'),
        findsOneWidget,
      );
      expect(backend.called('GET', '/cart').length, greaterThanOrEqualTo(2));
    });
  });

  group('checkout', () {
    FakeBackend withCart({Map<String, int>? items}) {
      final backend = FakeBackend();
      backend.carts[ana] = items ?? {'v-mord': 2}; // 17,80 $
      return backend;
    }

    testWidgets('sin direcciones pide una y valida el formulario', (
      tester,
    ) async {
      final backend = withCart();
      final app = await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/carrito',
      );
      await tapText(app, 'Ir a pagar');
      expect(find.text('¿A dónde te lo enviamos?'), findsOneWidget);
      // Propone el nombre y teléfono de la cuenta.
      expect(find.widgetWithText(TextFormField, 'Ana Pérez'), findsOneWidget);

      await fill(tester, 'Quién recibe', '');
      await fill(tester, 'Teléfono', '12');
      await tapText(app, 'Guardar y continuar');
      expect(find.text('Escribe quién recibe'), findsOneWidget);
      expect(find.textContaining('Teléfono inválido'), findsOneWidget);
      expect(find.text('Elige un estado'), findsOneWidget);
      expect(find.text('Escribe la ciudad'), findsOneWidget);
      expect(find.text('Escribe la dirección'), findsOneWidget);
      expect(backend.called('POST', '/addresses'), isEmpty);

      await fill(tester, 'Quién recibe', 'Ana Pérez');
      await fill(tester, 'Teléfono', '0412-1234567');
      await pickOption(app, 'Estado', 'Miranda');
      await fill(tester, 'Ciudad', 'Los Teques');
      await fill(tester, 'Dirección', 'Calle Bolívar, casa 3');
      await tapText(app, 'Guardar y continuar');
      expect(backend.addresses[ana], hasLength(1));
      expect(find.text('Dirección de envío'), findsOneWidget);
      expect(find.text('Delivery Caracas'), findsOneWidget);
    });

    testWidgets('solo ofrece zonas que llegan al estado de la dirección', (
      tester,
    ) async {
      final backend = withCart();
      backend.addAddress(ana, state: 'Zulia');
      await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/checkout',
      );
      expect(find.text('Encomienda nacional'), findsOneWidget);
      expect(find.text('Delivery Caracas'), findsNothing);
      expect(find.text(r'MRW · $6,00'), findsOneWidget);
    });

    testWidgets('sin zona para el estado no deja confirmar', (tester) async {
      final backend = withCart();
      backend.addAddress(ana, state: 'Bolívar');
      await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/checkout',
      );
      expect(
        find.textContaining('Todavía no enviamos a Bolívar'),
        findsOneWidget,
      );
      final confirm = find.widgetWithText(FilledButton, 'Confirmar pedido');
      await scrollTo(tester, confirm);
      expect(tester.widget<FilledButton>(confirm).onPressed, isNull);
    });

    testWidgets('montos estimados por método y total con envío', (
      tester,
    ) async {
      final backend = withCart();
      backend.addAddress(ana);
      final app = await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/checkout',
      );
      // 17,80 + 3,00 de envío = 20,80 $
      expect(find.text('Bs. 759,20'), findsWidgets); // 20,80 × 36,5
      expect(find.text(r'$20,80'), findsWidgets);
      await tapText(app, 'Transferencia en euros');
      expect(find.text('19,08 €'), findsWidgets); // 20,80 × 36,5 / 39,8
    });

    testWidgets('envío gratis desde 25 \$', (tester) async {
      final backend = withCart(items: {'v-1kg': 3}); // 32,70 $
      backend.addAddress(ana);
      await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/checkout',
      );
      expect(find.text('Delivery propio · Gratis'), findsOneWidget);
    });

    testWidgets('sin tasa BCV: Bs no se puede elegir para confirmar', (
      tester,
    ) async {
      final backend = withCart()..rates = const FakeRates();
      backend.addAddress(ana);
      final app = await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/checkout',
      );
      expect(
        find.text('Sin tasa del BCV cargada hoy para esta moneda'),
        findsNWidgets(2),
      );
      final confirm = find.widgetWithText(FilledButton, 'Confirmar pedido');
      await scrollTo(tester, confirm);
      expect(tester.widget<FilledButton>(confirm).onPressed, isNull);
      await tapText(app, 'Zelle');
      expect(tester.widget<FilledButton>(confirm).onPressed, isNotNull);
    });

    testWidgets('exige aceptar los términos', (tester) async {
      final backend = withCart();
      backend.addAddress(ana);
      final app = await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/checkout',
      );
      await tapText(app, 'Confirmar pedido');
      expect(
        find.text('Debes aceptar los términos y condiciones'),
        findsOneWidget,
      );
      expect(backend.called('POST', '/orders'), isEmpty);
    });

    testWidgets('confirma el pedido y abre su detalle', (tester) async {
      final backend = withCart();
      backend.addAddress(ana);
      final app = await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/checkout',
      );
      await scrollTo(tester, find.byType(CheckboxListTile));
      await tester.tap(find.byType(CheckboxListTile));
      await app.settle();
      await tapText(app, 'Confirmar pedido');
      final body = jsonDecode(backend.called('POST', '/orders').single.body);
      expect(body, {
        'addressId': 'ad-1',
        'shippingZoneId': 'z-caracas',
        'paymentMethodId': 'm-pm',
        'acceptTerms': true,
      });
      expect(find.text('Pedido PB-000001'), findsOneWidget);
      expect(find.text('Falta tu pago'), findsOneWidget);
      expect(find.text('Bs. 759,20'), findsWidgets);
      // El carrito quedó vacío (sin contador en la barra).
      app.router.go('/carrito');
      await app.settle();
      expect(find.text('Tu carrito está vacío'), findsOneWidget);
    });

    testWidgets('si la API rechaza el pedido muestra el motivo', (
      tester,
    ) async {
      final backend = withCart();
      backend.addAddress(ana);
      backend.overrides['POST /orders'] = (_) => http.Response(
        jsonEncode({
          'message':
              'Ya no queda stock suficiente de Mordedor de caucho (Talla M)',
        }),
        409,
        headers: {'content-type': 'application/json'},
      );
      final app = await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/checkout',
      );
      await scrollTo(tester, find.byType(CheckboxListTile));
      await tester.tap(find.byType(CheckboxListTile));
      await tapText(app, 'Confirmar pedido');
      await tester.dragUntilVisible(
        find.textContaining('Ya no queda stock suficiente'),
        find.byType(ListView).first,
        const Offset(0, 300),
      );
      expect(
        find.textContaining('Ya no queda stock suficiente'),
        findsOneWidget,
      );
    });

    testWidgets('con el carrito bloqueado manda a revisarlo', (tester) async {
      final backend = withCart(items: {'v-3kg': 3});
      backend.variantById('v-3kg')!['stock'] = 1;
      backend.addAddress(ana);
      await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/checkout',
      );
      expect(find.text('Revisa tu carrito'), findsOneWidget);
    });

    testWidgets('añadir otra dirección desde el checkout', (tester) async {
      final backend = withCart();
      backend.addAddress(ana);
      final app = await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/checkout',
      );
      await tapText(app, 'Añadir otra dirección');
      expect(find.text('Nueva dirección'), findsOneWidget);
      await tester.tap(find.text('Estado'));
      await app.settle();
      await tester.tap(find.text('Lara').last);
      await app.settle();
      await fill(tester, 'Ciudad', 'Barquisimeto');
      await fill(tester, 'Dirección', 'Av. Lara');
      await tester.tap(find.widgetWithText(FilledButton, 'Guardar dirección'));
      await app.settle();
      expect(backend.addresses[ana], hasLength(2));
      // Queda elegida y cambia la zona a la nacional.
      expect(find.text('Encomienda nacional'), findsOneWidget);
    });
  });
}
