import 'dart:convert';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:material_ui/material_ui.dart';

import '../support/fake_backend.dart';
import '../support/harness.dart';

const ana = 'ana@petbf.com';

void main() {
  Future<TestApp> openOrder(
    WidgetTester tester,
    FakeBackend backend, {
    String id = 'o-1',
    DateTime? now,
  }) => startApp(
    tester,
    backend: backend,
    signedInAs: ana,
    location: '/pedidos/$id',
    now: now,
  );

  Future<void> openReportSheet(TestApp app) async {
    await tapText(app, 'Ya pagué: reportar pago');
    expect(find.text('Número de referencia'), findsOneWidget);
  }

  Finder sheetButton(String text) => find.descendant(
    of: find.byType(BottomSheet),
    matching: find.widgetWithText(FilledButton, text),
  );

  group('mis pedidos', () {
    testWidgets('sin pedidos', (tester) async {
      final app = await startApp(tester, signedInAs: ana, location: '/pedidos');
      expect(find.text('Aún no tienes pedidos'), findsOneWidget);
      await tapText(app, 'Ver la tienda');
      expect(find.text('Tienda'), findsWidgets);
    });

    testWidgets('lista los pedidos y abre el detalle', (tester) async {
      final backend = FakeBackend();
      backend.seedOrder(ana);
      backend.seedOrder(ana, status: 'SHIPPED');
      final app = await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/pedidos',
      );
      expect(find.text('Pedido PB-000001'), findsOneWidget);
      expect(find.text('Pedido PB-000002'), findsOneWidget);
      expect(find.text('Esperando el pago'), findsOneWidget);
      expect(find.text('Enviado'), findsOneWidget);
      // 2 × 8,90 $ + 3,00 $ de envío, pagado en Bs.
      expect(find.text(r'1 producto · $20,80 · Bs. 759,20'), findsNWidgets(2));
      await tapText(app, 'Pedido PB-000001');
      expect(find.text('Pedido PB-000001'), findsOneWidget);
    });

    testWidgets('pagina de 20 en 20', (tester) async {
      final backend = FakeBackend();
      for (var i = 0; i < 23; i++) {
        backend.seedOrder(ana);
      }
      final app = await startApp(
        tester,
        backend: backend,
        signedInAs: ana,
        location: '/pedidos',
      );
      await scrollTo(tester, find.text('Ver más'));
      await tapText(app, 'Ver más');
      await scrollTo(tester, find.text('Pedido PB-000001'));
      expect(find.text('Pedido PB-000001'), findsOneWidget);
      expect(backend.called('GET', '/orders').last.url.queryParameters, {
        'page': '2',
        'pageSize': '20',
      });
    });

    testWidgets('el pedido de otra cuenta no se ve', (tester) async {
      final backend = FakeBackend();
      backend.seedOrder('luis@mail.com');
      await openOrder(tester, backend);
      expect(find.text('No lo encontramos'), findsOneWidget);
    });
  });

  group('pedido pendiente', () {
    testWidgets('muestra el monto, el plazo y las instrucciones', (
      tester,
    ) async {
      final backend = FakeBackend()..seedOrder(ana);
      final app = await openOrder(tester, backend);
      expect(find.text('Falta tu pago'), findsOneWidget);
      expect(find.text('Bs. 759,20'), findsWidgets); // 20,80 $ × 36,5
      expect(find.textContaining('Te quedan 2 h 00 min'), findsOneWidget);
      expect(find.textContaining('12:00 p. m.'), findsOneWidget);

      String? copied;
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        (call) async {
          if (call.method == 'Clipboard.setData') {
            copied = (call.arguments as Map)['text'] as String;
          }
          return null;
        },
      );
      addTearDown(
        () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          SystemChannels.platform,
          null,
        ),
      );
      await tapText(app, 'Copiar monto');
      expect(copied, '759.20');
      expect(find.text('Monto copiado.'), findsOneWidget);
    });

    testWidgets('con el plazo vencido no deja reportar', (tester) async {
      final backend = FakeBackend();
      backend.seedOrder(
        ana,
        createdAt: backend.now.subtract(const Duration(hours: 3)),
      );
      await openOrder(tester, backend);
      expect(
        find.text(
          'El plazo para reportar el pago venció. El pedido se cancelará.',
        ),
        findsOneWidget,
      );
      final report = find.widgetWithText(
        FilledButton,
        'Ya pagué: reportar pago',
      );
      expect(tester.widget<FilledButton>(report).onPressed, isNull);
    });

    testWidgets('el contador baja y al vencer bloquea el reporte', (
      tester,
    ) async {
      final backend = FakeBackend()..seedOrder(ana);
      final app = await openOrder(
        tester,
        backend,
        now: backend.now.add(const Duration(minutes: 90)),
      );
      expect(find.textContaining('Te quedan 30 min'), findsOneWidget);

      app.now = app.now.add(const Duration(minutes: 29, seconds: 40));
      await tester.pump(const Duration(seconds: 30));
      expect(find.textContaining('Te quedan menos de 1 min'), findsOneWidget);

      app.now = app.now.add(const Duration(minutes: 1));
      await tester.pump(const Duration(seconds: 30));
      expect(
        find.text(
          'El plazo para reportar el pago venció. El pedido se cancelará.',
        ),
        findsOneWidget,
      );
      final report = find.widgetWithText(
        FilledButton,
        'Ya pagué: reportar pago',
      );
      expect(tester.widget<FilledButton>(report).onPressed, isNull);
    });

    testWidgets('muestra por qué se rechazó el reporte anterior', (
      tester,
    ) async {
      final backend = FakeBackend();
      final order = backend.seedOrder(ana);
      (order['payments']! as List).add({
        'id': 'pay-x',
        'reference': 'ABC123',
        'amount': '759.20',
        'currency': 'VES',
        'paidAt': backend.now.toIso8601String(),
        'status': 'REJECTED',
        'rejectionReason': 'No llegó el pago al banco',
        'createdAt': backend.now.toIso8601String(),
      });
      final app = await openOrder(tester, backend);
      expect(
        find.text(
          'Tu reporte anterior fue rechazado: No llegó el pago al banco',
        ),
        findsOneWidget,
      );
      await scrollTo(tester, find.text('Pagos reportados'));
      await scrollTo(tester, find.textContaining('Ref. ABC123'));
      expect(find.textContaining('Rechazado · No llegó'), findsOneWidget);
      expect(app.backend.called('GET', '/orders/o-1'), isNotEmpty);
    });

    testWidgets('cancelar pide confirmación', (tester) async {
      final backend = FakeBackend()..seedOrder(ana);
      final app = await openOrder(tester, backend);
      await tapText(app, 'Cancelar pedido');
      expect(find.text('¿Cancelar este pedido?'), findsOneWidget);
      await tapText(app, 'No, volver');
      expect(backend.called('POST', '/orders/o-1/cancel'), isEmpty);
      expect(find.text('Falta tu pago'), findsOneWidget);

      await tapText(app, 'Cancelar pedido');
      await tapText(app, 'Sí, cancelar');
      expect(backend.called('POST', '/orders/o-1/cancel'), hasLength(1));
      expect(find.text('Cancelaste el pedido.'), findsOneWidget);
      expect(find.text('Falta tu pago'), findsNothing);
      expect(find.text('Cancelado'), findsWidgets);
    });

    testWidgets('si ya no se puede cancelar, avisa y recarga', (tester) async {
      final backend = FakeBackend()..seedOrder(ana);
      final app = await openOrder(tester, backend);
      // Mientras tanto el equipo verificó el pago.
      backend.orders.single['status'] = 'PAID';
      await tapText(app, 'Cancelar pedido');
      await tapText(app, 'Sí, cancelar');
      expect(find.text('Este pedido ya no se puede cancelar'), findsOneWidget);
      expect(find.text('Falta tu pago'), findsNothing);
    });
  });

  group('reportar pago', () {
    testWidgets('valida referencia y monto antes de enviar', (tester) async {
      final backend = FakeBackend()..seedOrder(ana);
      final app = await openOrder(tester, backend);
      await openReportSheet(app);
      // El monto viene propuesto con el total a pagar.
      expect(find.widgetWithText(TextFormField, '759,20'), findsOneWidget);

      await fill(tester, 'Monto pagado', '');
      await tester.tap(sheetButton('Reportar pago'));
      await app.settle();
      expect(find.text('Escribe la referencia del pago'), findsOneWidget);
      expect(find.text('Escribe el monto que pagaste'), findsOneWidget);

      await fill(tester, 'Número de referencia', 'ab');
      await fill(tester, 'Monto pagado', '1.234,50');
      await tester.tap(sheetButton('Reportar pago'));
      await app.settle();
      expect(
        find.text('Referencia inválida: de 4 a 40 letras, números o guiones'),
        findsOneWidget,
      );
      expect(
        find.text(
          'Escribe el monto sin separador de miles, por ejemplo 1234,50',
        ),
        findsOneWidget,
      );

      await fill(tester, 'Monto pagado', '12,345');
      await tester.tap(sheetButton('Reportar pago'));
      await app.settle();
      expect(find.text('Monto inválido: hasta 2 decimales'), findsOneWidget);

      await fill(tester, 'Monto pagado', '0');
      await tester.tap(sheetButton('Reportar pago'));
      await app.settle();
      expect(find.text('El monto debe ser mayor que cero'), findsOneWidget);
      expect(backend.called('POST', '/orders/o-1/payments'), isEmpty);
    });

    testWidgets('el campo de referencia descarta símbolos', (tester) async {
      final backend = FakeBackend()..seedOrder(ana);
      final app = await openOrder(tester, backend);
      await openReportSheet(app);
      await fill(tester, 'Número de referencia', r'ab#12$3');
      expect(find.widgetWithText(TextFormField, 'ab123'), findsOneWidget);
    });

    testWidgets('envía el reporte normalizado y muestra la revisión', (
      tester,
    ) async {
      final backend = FakeBackend()..seedOrder(ana);
      final app = await openOrder(tester, backend);
      await openReportSheet(app);
      await fill(tester, 'Número de referencia', ' 0001-ab 23 ');
      await fill(tester, 'Banco de origen (opcional)', 'Banesco');
      await tester.tap(sheetButton('Reportar pago'));
      await app.settle();

      final body = jsonDecode(
        backend.called('POST', '/orders/o-1/payments').single.body,
      );
      expect(body, {
        'reference': '0001-AB23',
        'amount': '759.20',
        'paidAt': backend.now.toIso8601String(),
        'originBank': 'Banesco',
      });
      expect(find.byType(BottomSheet), findsNothing);
      expect(
        find.text(
          'Recibimos tu reporte. Te avisaremos cuando el equipo verifique el pago.',
        ),
        findsOneWidget,
      );
      expect(
        find.text(
          'Estamos revisando tu pago. Te avisaremos cuando lo verifiquemos.',
        ),
        findsOneWidget,
      );
      expect(find.text('Falta tu pago'), findsNothing);

      // La lista también refleja el nuevo estado.
      await app.go('/pedidos');
      expect(find.text('Pago en revisión'), findsOneWidget);
    });

    testWidgets('referencia ya usada: muestra el motivo y no cierra', (
      tester,
    ) async {
      final backend = FakeBackend()..seedOrder(ana);
      backend.usedReferences.add('ABC123');
      final app = await openOrder(tester, backend);
      await openReportSheet(app);
      await fill(tester, 'Número de referencia', 'abc123');
      await tester.tap(sheetButton('Reportar pago'));
      await app.settle();
      expect(
        find.text('Esa referencia ya se usó en otro pago'),
        findsOneWidget,
      );
      expect(find.byType(BottomSheet), findsOneWidget);
      expect(find.text('Reportar pago'), findsWidgets);
    });

    testWidgets('sin conexión deja reintentar', (tester) async {
      final backend = FakeBackend()..seedOrder(ana);
      final app = await openOrder(tester, backend);
      await openReportSheet(app);
      await fill(tester, 'Número de referencia', 'ABC123');
      backend.offline = true;
      await tester.tap(sheetButton('Reportar pago'));
      await app.settle();
      expect(find.textContaining('conexión'), findsWidgets);

      backend.offline = false;
      await tester.tap(sheetButton('Reportar pago'));
      await app.settle();
      expect(find.byType(BottomSheet), findsNothing);
      expect(backend.orders.single['status'], 'PAYMENT_REPORTED');
    });

    testWidgets('la API rechaza la fecha y se muestra su mensaje', (
      tester,
    ) async {
      final backend = FakeBackend()..seedOrder(ana);
      backend.overrides['POST /orders/o-1/payments'] = (_) => http.Response(
        jsonEncode({
          'message': ['paidAt: La fecha del pago es anterior al pedido'],
        }),
        400,
        headers: {'content-type': 'application/json'},
      );
      final app = await openOrder(tester, backend);
      await openReportSheet(app);
      await fill(tester, 'Número de referencia', 'ABC123');
      await tester.tap(sheetButton('Reportar pago'));
      await app.settle();
      expect(
        find.text('La fecha del pago es anterior al pedido'),
        findsOneWidget,
      );
    });

    testWidgets('la fecha del pago no puede ser anterior al pedido', (
      tester,
    ) async {
      // Pedido hecho hace 1 h 30 min; el pago se marca a una hora anterior.
      final backend = FakeBackend();
      backend.seedOrder(
        ana,
        createdAt: backend.now.subtract(const Duration(minutes: 90)),
      );
      final app = await openOrder(tester, backend);
      await openReportSheet(app);
      await fill(tester, 'Número de referencia', 'ABC123');

      // Hora local del teléfono: 7:00, antes de que se hiciera el pedido.
      await tapText(app, 'Cambiar hora');
      await tester.tap(find.byIcon(Icons.keyboard_outlined));
      await app.settle();
      final inputs = find.descendant(
        of: find.byType(Dialog),
        matching: find.byType(TextField),
      );
      await tester.enterText(inputs.at(0), '7');
      await tester.enterText(inputs.at(1), '00');
      await tapText(app, 'ACEPTAR');

      await tester.tap(sheetButton('Reportar pago'));
      await app.settle();
      expect(
        find.text('La fecha del pago es anterior al pedido'),
        findsOneWidget,
      );
      expect(backend.called('POST', '/orders/o-1/payments'), isEmpty);
    });
  });

  group('otros estados', () {
    testWidgets('pedido enviado muestra la guía', (tester) async {
      final backend = FakeBackend();
      final order = backend.seedOrder(ana, status: 'SHIPPED');
      order['trackingCode'] = 'MRW-778899';
      await openOrder(tester, backend);
      expect(find.text('Falta tu pago'), findsNothing);
      expect(find.text('MRW-778899'), findsOneWidget);
      expect(find.text('Enviado'), findsWidgets);
    });

    testWidgets('el historial y los datos de entrega', (tester) async {
      final backend = FakeBackend();
      backend.seedOrder(ana, status: 'PAID');
      await openOrder(tester, backend);
      await scrollTo(tester, find.text('Historial'));
      expect(find.text('Historial'), findsOneWidget);
      await scrollTo(tester, find.text('Entrega'));
      expect(find.text('Entrega'), findsOneWidget);
    });
  });
}
