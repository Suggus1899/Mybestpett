import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:material_ui/material_ui.dart';
import 'package:petbf/core/proof.dart';

import '../support/fake_backend.dart';
import '../support/harness.dart';

const ana = 'ana@petbf.com';

/// Pedido entregado con un mordedor (se devuelve) y alimento (no se devuelve).
Json deliveredOrder(FakeBackend backend, {Duration ago = Duration.zero}) =>
    backend.seedOrder(
      ana,
      status: 'DELIVERED',
      items: {'v-mord': 2, 'v-1kg': 1},
      deliveredAt: backend.now.subtract(ago),
    );

/// Añade un pago reportado (o en otro estado) a un pedido.
Json addPayment(Json order, {String status = 'REPORTED', Json? proof}) {
  final payment = {
    'id': 'pay-1',
    'reference': 'ABC123',
    'amount': order['totalCharged'],
    'currency': order['chargedCurrency'],
    'paidAt': order['createdAt'],
    'status': status,
    'rejectionReason': null,
    'createdAt': order['createdAt'],
    'proof': proof,
  };
  (order['payments']! as List).insert(0, payment);
  if (status == 'REPORTED') order['status'] = 'PAYMENT_REPORTED';
  return payment;
}

Future<TestApp> openOrder(WidgetTester tester, FakeBackend backend) => startApp(
  tester,
  backend: backend,
  signedInAs: ana,
  location: '/pedidos/o-1',
);

Finder sheetButton(String text) => find.descendant(
  of: find.byType(BottomSheet),
  matching: find.widgetWithText(FilledButton, text),
);

/// Botón + o − del único producto devolvible del formulario.
Finder stepperButton(String product, IconData icon) => find.descendant(
  of: find.byType(BottomSheet),
  matching: find.widgetWithIcon(IconButton, icon),
);

void main() {
  group('devoluciones', () {
    testWidgets('pedido entregado: muestra el plazo y solo lo devolvible', (
      tester,
    ) async {
      final backend = FakeBackend();
      deliveredOrder(backend, ago: const Duration(days: 1));
      final app = await openOrder(tester, backend);
      expect(find.text('¿Algo no salió bien?'), findsOneWidget);
      // Entregado ayer a las 10:00 de Caracas: plazo hasta pasado mañana.
      expect(
        find.textContaining('Puedes pedir una devolución hasta el'),
        findsOneWidget,
      );
      await tapText(app, 'Pedir devolución');
      expect(find.text('¿Qué quieres devolver?'), findsOneWidget);
      expect(
        find.descendant(
          of: find.byType(BottomSheet),
          matching: find.text('Mordedor de caucho'),
        ),
        findsOneWidget,
      );
      // El alimento no se devuelve: no aparece en el formulario.
      expect(
        find.descendant(
          of: find.byType(BottomSheet),
          matching: find.text('Alimento seco adulto'),
        ),
        findsNothing,
      );
      expect(find.text('Talla M · puedes devolver 2'), findsOneWidget);
    });

    testWidgets('sin entregar, fuera de plazo o sin nada devolvible', (
      tester,
    ) async {
      var backend = FakeBackend()..seedOrder(ana, status: 'SHIPPED');
      await openOrder(tester, backend);
      expect(find.text('¿Algo no salió bien?'), findsNothing);

      backend = FakeBackend();
      deliveredOrder(backend, ago: const Duration(days: 3, minutes: 1));
      await openOrder(tester, backend);
      expect(find.text('¿Algo no salió bien?'), findsNothing);

      backend = FakeBackend()
        ..seedOrder(ana, status: 'DELIVERED', items: {'v-1kg': 1});
      // seedOrder suma el mordedor por defecto: se deja solo el alimento.
      final order = backend.orders.single;
      (order['items']! as List).removeWhere(
        (i) => (i as Json)['id'] == 'oi-v-mord',
      );
      await openOrder(tester, backend);
      expect(find.text('¿Algo no salió bien?'), findsNothing);
    });

    testWidgets('valida unidades y motivo antes de enviar', (tester) async {
      final backend = FakeBackend();
      deliveredOrder(backend);
      final app = await openOrder(tester, backend);
      await tapText(app, 'Pedir devolución');
      await tester.tap(sheetButton('Enviar solicitud'));
      await app.settle();
      expect(find.text('Elige al menos un producto'), findsOneWidget);
      expect(
        find.text('Cuéntanos el motivo (mínimo 10 caracteres)'),
        findsOneWidget,
      );

      await tester.tap(stepperButton('Mordedor de caucho', Icons.add));
      await app.settle();
      expect(find.text('Elige al menos un producto'), findsNothing);
      await fill(tester, 'Motivo', '   corto   ');
      await tester.tap(sheetButton('Enviar solicitud'));
      await app.settle();
      expect(
        find.text('Cuéntanos el motivo (mínimo 10 caracteres)'),
        findsOneWidget,
      );
      expect(backend.called('POST', '/orders/o-1/returns'), isEmpty);
    });

    testWidgets('no deja pedir más unidades de las compradas', (tester) async {
      final backend = FakeBackend();
      deliveredOrder(backend);
      final app = await openOrder(tester, backend);
      await tapText(app, 'Pedir devolución');
      final plus = stepperButton('Mordedor de caucho', Icons.add);
      await tester.tap(plus);
      await app.settle();
      await tester.tap(plus);
      await app.settle();
      expect(tester.widget<IconButton>(plus).onPressed, isNull);
      expect(
        find.textContaining(r'Te devolveremos el equivalente a $17,80'),
        findsOneWidget,
      );
    });

    testWidgets('envía la solicitud y la muestra en revisión', (tester) async {
      final backend = FakeBackend();
      deliveredOrder(backend);
      final app = await openOrder(tester, backend);
      await tapText(app, 'Pedir devolución');
      await tester.tap(stepperButton('Mordedor de caucho', Icons.add));
      await app.settle();
      await fill(tester, 'Motivo', '  Llegó roto, se partió al sacarlo  ');
      await tester.tap(sheetButton('Enviar solicitud'));
      await app.settle();

      final body = jsonDecode(
        backend.called('POST', '/orders/o-1/returns').single.body,
      );
      expect(body, {
        'reason': 'Llegó roto, se partió al sacarlo',
        'items': [
          {'orderItemId': 'oi-v-mord', 'quantity': 1},
        ],
      });
      expect(find.byType(BottomSheet), findsNothing);
      expect(
        find.text(
          'Recibimos tu solicitud. Te avisaremos cuando el equipo la revise.',
        ),
        findsOneWidget,
      );
      // Con una devolución abierta no se puede pedir otra.
      expect(find.text('¿Algo no salió bien?'), findsNothing);
      await scrollTo(tester, find.text('Devoluciones'));
      expect(find.text('En revisión · Bs. 324,85'), findsOneWidget);
      expect(find.text('1 × Mordedor de caucho'), findsOneWidget);
    });

    testWidgets('si la API la rechaza, muestra el motivo en el formulario', (
      tester,
    ) async {
      final backend = FakeBackend();
      deliveredOrder(backend);
      final app = await openOrder(tester, backend);
      // Mientras tanto vence el plazo en el servidor.
      backend.now = backend.now.add(const Duration(days: 4));
      await tapText(app, 'Pedir devolución');
      await tester.tap(stepperButton('Mordedor de caucho', Icons.add));
      await fill(tester, 'Motivo', 'No era la talla que pedí');
      await tester.tap(sheetButton('Enviar solicitud'));
      await app.settle();
      expect(
        find.text(
          'Pasaron más de 3 días desde la entrega: ya no admite devolución',
        ),
        findsOneWidget,
      );
      expect(find.byType(BottomSheet), findsOneWidget);
    });

    testWidgets('rechazada: se ve el motivo y se puede pedir de nuevo', (
      tester,
    ) async {
      final backend = FakeBackend();
      final order = deliveredOrder(backend);
      (order['returns']! as List).add({
        'id': 'ret-1',
        'status': 'REJECTED',
        'reason': 'Ya no lo quiero, gracias',
        'refundUsdCents': 1780,
        'currency': 'VES',
        'refundAmount': '649.70',
        'decisionNote': 'El producto se ve usado',
        'refundReference': null,
        'refundedAt': null,
        'createdAt': backend.now.toIso8601String(),
        'items': [
          {'orderItemId': 'oi-v-mord', 'quantity': 2},
        ],
      });
      final app = await openOrder(tester, backend);
      expect(find.text('¿Algo no salió bien?'), findsOneWidget);
      await scrollTo(tester, find.text('El producto se ve usado'));
      expect(find.text('Rechazada · Bs. 649,70'), findsOneWidget);
      // La rechazada no descuenta unidades.
      await scrollTo(tester, find.text('Pedir devolución'));
      await tapText(app, 'Pedir devolución');
      expect(find.text('Talla M · puedes devolver 2'), findsOneWidget);
    });

    testWidgets('reembolsada: muestra la fecha y la referencia', (
      tester,
    ) async {
      final backend = FakeBackend();
      final order = deliveredOrder(backend);
      (order['returns']! as List).add({
        'id': 'ret-1',
        'status': 'REFUNDED',
        'reason': 'Llegó roto, se partió',
        'refundUsdCents': 1780,
        'currency': 'VES',
        'refundAmount': '649.70',
        'decisionNote': null,
        'refundReference': 'REEMB-889',
        'refundedAt': backend.now.toIso8601String(),
        'createdAt': backend.now.toIso8601String(),
        'items': [
          {'orderItemId': 'oi-v-mord', 'quantity': 2},
        ],
      });
      await openOrder(tester, backend);
      // Todo lo devolvible ya se devolvió.
      expect(find.text('¿Algo no salió bien?'), findsNothing);
      await scrollTo(tester, find.textContaining('Reembolsado el'));
      expect(find.textContaining('Ref. REEMB-889'), findsOneWidget);
    });
  });

  group('comprobante del pago', () {
    testWidgets('adjunta una imagen y luego deja reemplazarla', (tester) async {
      final backend = FakeBackend();
      addPayment(backend.seedOrder(ana));
      final app = await openOrder(tester, backend);
      await scrollTo(tester, find.text('Sin comprobante'));

      app.picker.next = ('captura.png', pngBytes(3000));
      await tapText(app, 'Adjuntar comprobante');
      final put = backend.called('PUT', '/orders/o-1/payments/pay-1/proof');
      expect(put, hasLength(1));
      expect(put.single.headers['content-type'], startsWith('multipart/'));
      expect(backend.proofs['pay-1'], pngBytes(3000));
      expect(find.text('Comprobante adjuntado.'), findsOneWidget);
      await scrollTo(tester, find.text('Comprobante PNG · 3 KB'));
      expect(find.text('Reemplazar comprobante'), findsOneWidget);
    });

    testWidgets('cancelar el selector no envía nada', (tester) async {
      final backend = FakeBackend();
      addPayment(backend.seedOrder(ana));
      final app = await openOrder(tester, backend);
      app.picker.next = null;
      await tapText(app, 'Adjuntar comprobante');
      expect(app.picker.calls, 1);
      expect(
        backend.called('PUT', '/orders/o-1/payments/pay-1/proof'),
        isEmpty,
      );
    });

    testWidgets('rechaza archivos de más de 5 MB o de otro tipo', (
      tester,
    ) async {
      final backend = FakeBackend();
      addPayment(backend.seedOrder(ana));
      final app = await openOrder(tester, backend);

      app.picker.next = ('grande.pdf', pdfBytes(maxProofBytes + 1));
      await tapText(app, 'Adjuntar comprobante');
      expect(find.text(proofTooBigMessage), findsOneWidget);

      // Un .png que en realidad no es una imagen.
      app.picker.next = ('falso.png', Uint8List(100));
      await tapText(app, 'Adjuntar comprobante');
      expect(find.text(proofWrongTypeMessage), findsOneWidget);
      expect(
        backend.called('PUT', '/orders/o-1/payments/pay-1/proof'),
        isEmpty,
      );
    });

    testWidgets('un pago ya revisado no admite comprobante', (tester) async {
      final backend = FakeBackend();
      final order = backend.seedOrder(ana, status: 'PAID');
      addPayment(order, status: 'VERIFIED');
      final app = await openOrder(tester, backend);
      await scrollTo(tester, find.text('Pagos reportados'));
      expect(find.text('Adjuntar comprobante'), findsNothing);
      expect(find.textContaining('Verificado'), findsOneWidget);
      expect(app.picker.calls, 0);
    });

    testWidgets('si la API lo rechaza, muestra su mensaje', (tester) async {
      final backend = FakeBackend();
      final order = backend.seedOrder(ana);
      final payment = addPayment(order);
      final app = await openOrder(tester, backend);
      // Mientras tanto el equipo verificó el pago.
      payment['status'] = 'VERIFIED';
      app.picker.next = ('captura.png', pngBytes());
      await tapText(app, 'Adjuntar comprobante');
      expect(
        find.text('Este pago ya fue revisado: no admite comprobante'),
        findsOneWidget,
      );
    });

    testWidgets('ver el comprobante descarga la imagen', (tester) async {
      final backend = FakeBackend();
      addPayment(
        backend.seedOrder(ana),
        proof: {
          'contentType': 'image/png',
          'sizeBytes': 2048,
          'createdAt': backend.now.toIso8601String(),
        },
      );
      backend.proofs['pay-1'] = pngBytes();
      final app = await openOrder(tester, backend);
      await tapText(app, 'Ver comprobante');
      expect(
        backend.called('GET', '/orders/o-1/payments/pay-1/proof'),
        hasLength(1),
      );
      expect(find.byType(Image), findsOneWidget);
      await tapText(app, 'Cerrar');
      expect(find.byType(Dialog), findsNothing);
    });

    testWidgets('un PDF no se previsualiza, solo se informa', (tester) async {
      final backend = FakeBackend();
      addPayment(
        backend.seedOrder(ana),
        proof: {
          'contentType': 'application/pdf',
          'sizeBytes': 1572864,
          'createdAt': backend.now.toIso8601String(),
        },
      );
      await openOrder(tester, backend);
      await scrollTo(tester, find.text('Comprobante PDF · 1,5 MB'));
      expect(find.text('Ver comprobante'), findsNothing);
    });
  });

  group('reportar el pago con comprobante', () {
    Future<TestApp> openReport(WidgetTester tester, FakeBackend backend) async {
      backend.seedOrder(ana);
      final app = await openOrder(tester, backend);
      await tapText(app, 'Ya pagué: reportar pago');
      await fill(tester, 'Número de referencia', 'ABC123');
      return app;
    }

    testWidgets('reporta y luego sube el comprobante', (tester) async {
      final backend = FakeBackend();
      final app = await openReport(tester, backend);
      app.picker.next = ('pago.pdf', pdfBytes());
      await tapText(app, 'Adjuntar comprobante');
      expect(find.text('pago.pdf · 4 KB'), findsOneWidget);
      await tester.tap(sheetButton('Reportar pago'));
      await app.settle();

      final payment =
          (backend.orders.single['payments']! as List).first as Json;
      final writes = [
        for (final r in backend.requests)
          if (r.method != 'GET') '${r.method} ${r.url.path}',
      ];
      expect(writes, [
        'POST /v1/orders/o-1/payments',
        'PUT /v1/orders/o-1/payments/${payment['id']}/proof',
      ]);
      expect(backend.proofs[payment['id']], pdfBytes());
      expect(
        find.text(
          'Recibimos tu reporte. Te avisaremos cuando el equipo verifique el pago.',
        ),
        findsOneWidget,
      );
      await scrollTo(tester, find.text('Comprobante PDF · 4 KB'));
    });

    testWidgets('quitar el archivo elegido lo deja fuera', (tester) async {
      final backend = FakeBackend();
      final app = await openReport(tester, backend);
      app.picker.next = ('pago.pdf', pdfBytes());
      await tapText(app, 'Adjuntar comprobante');
      await tester.tap(find.byTooltip('Quitar comprobante').hitTestable());
      await app.settle();
      expect(find.text('pago.pdf · 4 KB'), findsNothing);
      await tester.tap(sheetButton('Reportar pago'));
      await app.settle();
      expect(backend.requests.where((r) => r.method == 'PUT'), isEmpty);
      expect(backend.orders.single['status'], 'PAYMENT_REPORTED');
    });

    testWidgets('si el comprobante no sube, el pago igual queda reportado', (
      tester,
    ) async {
      final backend = FakeBackend();
      final app = await openReport(tester, backend);
      app.picker.next = ('pago.pdf', pdfBytes());
      await tapText(app, 'Adjuntar comprobante');
      backend.overrides.addAll({
        for (var i = 0; i < 100; i++)
          'PUT /orders/o-1/payments/pay-$i/proof': (_) =>
              http.Response('{"message":"File too large"}', 413),
      });
      await tester.tap(sheetButton('Reportar pago'));
      await app.settle();
      expect(backend.orders.single['status'], 'PAYMENT_REPORTED');
      expect(find.byType(BottomSheet), findsNothing);
      expect(
        find.textContaining(
          'Recibimos tu reporte, pero el comprobante no subió',
        ),
        findsOneWidget,
      );
      await scrollTo(tester, find.text('Sin comprobante'));
    });
  });

  group('especies de animales', () {
    testWidgets('solo ofrece las especies que acepta la tienda', (
      tester,
    ) async {
      final backend = FakeBackend()..liveSpecies = ['DOG', 'CAT'];
      await startApp(tester, backend: backend, location: '/animales');
      expect(find.widgetWithText(ChoiceChip, 'Perros'), findsOneWidget);
      expect(find.widgetWithText(ChoiceChip, 'Gatos'), findsOneWidget);
      expect(find.widgetWithText(ChoiceChip, 'Aves'), findsNothing);
      expect(find.widgetWithText(ChoiceChip, 'Reptiles'), findsNothing);
    });

    testWidgets('sin la lista de especies, muestra todas', (tester) async {
      final backend = FakeBackend()..liveSpecies = ['DOG'];
      backend.overrides['GET /animal-species'] = (_) =>
          http.Response('{"message":"x"}', 500);
      await startApp(tester, backend: backend, location: '/animales');
      expect(find.widgetWithText(ChoiceChip, 'Aves'), findsOneWidget);
    });
  });
}
