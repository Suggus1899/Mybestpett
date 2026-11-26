import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

import '../support/fake_backend.dart';
import '../support/harness.dart';

const ana = 'ana@petbf.com';

void main() {
  Future<TestApp> open(WidgetTester tester, FakeBackend backend) => startApp(
    tester,
    backend: backend,
    signedInAs: ana,
    location: '/cuenta/direcciones',
  );

  Finder sheetButton(String text) => find.descendant(
    of: find.byType(BottomSheet),
    matching: find.widgetWithText(FilledButton, text),
  );

  testWidgets('sin direcciones', (tester) async {
    await open(tester, FakeBackend());
    expect(find.text('Sin direcciones'), findsOneWidget);
  });

  testWidgets('sin sesión pide entrar', (tester) async {
    await startApp(tester, location: '/cuenta/direcciones');
    expect(find.text('Hola de nuevo'), findsOneWidget);
  });

  testWidgets('añade una dirección y la primera queda predeterminada', (
    tester,
  ) async {
    final backend = FakeBackend();
    final app = await open(tester, backend);
    await tapText(app, 'Añadir');
    expect(find.text('Nueva dirección'), findsOneWidget);
    await fill(tester, 'Ciudad', 'Maracaibo');
    await fill(tester, 'Dirección', 'Calle 72 con avenida 3');
    await pickOption(app, 'Estado', 'Zulia');
    await fill(tester, 'Municipio (opcional)', '  ');
    await tester.tap(sheetButton('Guardar dirección'));
    await app.settle();
    expect(find.byType(BottomSheet), findsNothing);
    expect(find.text('Dirección guardada.'), findsOneWidget);
    expect(
      find.text('Calle 72 con avenida 3, Maracaibo, Zulia'),
      findsOneWidget,
    );
    expect(find.text('Predeterminada'), findsOneWidget);
    expect(backend.addresses[ana]!.single['municipality'], isNull);
  });

  testWidgets('edita una dirección', (tester) async {
    final backend = FakeBackend()..addAddress(ana);
    final app = await open(tester, backend);
    await tapText(app, 'Editar');
    expect(find.text('Editar dirección'), findsOneWidget);
    expect(
      find.widgetWithText(TextFormField, 'Av. Principal, edificio 1'),
      findsOneWidget,
    );
    await fill(tester, 'Punto de referencia (opcional)', 'Frente a la plaza');
    await tester.tap(sheetButton('Guardar dirección'));
    await app.settle();
    expect(find.byType(BottomSheet), findsNothing);
    expect(find.text('Frente a la plaza'), findsOneWidget);
    expect(backend.called('PATCH', '/addresses/ad-1'), hasLength(1));
  });

  testWidgets('eliminar pide confirmación', (tester) async {
    final backend = FakeBackend()
      ..addAddress(ana)
      ..addAddress(ana, state: 'Zulia');
    final app = await open(tester, backend);
    await tester.tap(find.widgetWithText(TextButton, 'Eliminar').last);
    await app.settle();
    expect(find.text('¿Eliminar esta dirección?'), findsOneWidget);
    await tapText(app, 'Cancelar');
    expect(backend.called('DELETE', '/addresses/ad-2'), isEmpty);

    await tester.tap(find.widgetWithText(TextButton, 'Eliminar').last);
    await app.settle();
    await tester.tap(find.widgetWithText(FilledButton, 'Eliminar'));
    await app.settle();
    expect(backend.called('DELETE', '/addresses/ad-2'), hasLength(1));
    expect(find.text('Dirección eliminada.'), findsOneWidget);
    expect(find.textContaining('Zulia'), findsNothing);
  });

  testWidgets('con 10 direcciones la API no deja añadir otra', (tester) async {
    final backend = FakeBackend();
    for (var i = 0; i < 10; i++) {
      backend.addAddress(ana);
    }
    final app = await open(tester, backend);
    await tapText(app, 'Añadir');
    await fill(tester, 'Ciudad', 'Caracas');
    await fill(tester, 'Dirección', 'Av. Libertador');
    await pickOption(app, 'Estado', 'Distrito Capital');
    await tester.tap(sheetButton('Guardar dirección'));
    await app.settle();
    expect(find.text('Puedes guardar hasta 10 direcciones'), findsOneWidget);
    expect(find.byType(BottomSheet), findsOneWidget);
  });
}
