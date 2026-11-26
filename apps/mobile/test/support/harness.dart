import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';
import 'package:petbf/app.dart';
import 'package:petbf/core/api_client.dart';
import 'package:petbf/core/providers.dart';
import 'package:petbf/core/token_store.dart';
import 'package:petbf/router.dart';

import 'fake_backend.dart';

/// La app completa sobre la API falsa, en un teléfono de 390×844.
class TestApp {
  TestApp(this.tester, this.backend, this.container, this.store, this._clock);
  final WidgetTester tester;
  final FakeBackend backend;
  final ProviderContainer container;
  final MemoryTokenStore store;
  final TestClock _clock;

  /// Hora que ve la app. Se puede adelantar para probar plazos.
  DateTime get now => _clock.value;
  set now(DateTime value) => _clock.value = value;

  GoRouter get router => container.read(routerProvider);

  Future<void> go(String location) async {
    router.go(location);
    await settle();
  }

  /// Deja correr peticiones (microtareas) y animaciones hasta que se calme.
  Future<void> settle() async {
    for (var i = 0; i < 5; i++) {
      await tester.pump(const Duration(milliseconds: 50));
    }
    await tester.pumpAndSettle();
  }
}

Future<TestApp> startApp(
  WidgetTester tester, {
  FakeBackend? backend,
  String? signedInAs,
  String location = '/',
  DateTime? now,
}) async {
  tester.view.physicalSize = const Size(390 * 3, 844 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);

  final fake = backend ?? FakeBackend();
  final clock = TestClock(now ?? fake.now);
  final store = MemoryTokenStore();
  if (signedInAs != null) {
    store.tokens = AuthTokens.fromApi(
      fake.issueTokensFor(signedInAs),
      clock.value,
    );
  }
  final client = ApiClient(
    baseUrl: 'http://api.test/v1',
    httpClient: fake.client,
    tokenStore: store,
    now: () => clock.value,
  );
  final container = ProviderContainer(
    retry: (_, _) => null,
    overrides: [
      apiClientProvider.overrideWithValue(client),
      clockProvider.overrideWithValue(() => clock.value),
    ],
  );
  addTearDown(container.dispose);

  await tester.pumpWidget(
    UncontrolledProviderScope(container: container, child: const PetbfApp()),
  );
  final app = TestApp(tester, fake, container, store, clock);
  await app.settle();
  if (location != '/') await app.go(location);
  return app;
}

/// Escribe en el campo cuyo rótulo es [label].
Future<void> fill(WidgetTester tester, String label, String text) async {
  final field = find.widgetWithText(TextFormField, label);
  expect(field, findsOneWidget, reason: 'campo "$label"');
  await tester.ensureVisible(field);
  await tester.enterText(field, text);
}

/// Pulsa el botón o texto visible (desplaza si hace falta).
Future<void> tapText(TestApp app, String text) async {
  if (find.text(text).hitTestable().evaluate().isEmpty) {
    await scrollTo(app.tester, find.text(text));
  }
  await app.tester.tap(find.text(text).hitTestable().first);
  await app.settle();
}

/// Desplaza la lista principal hasta que [finder] esté construido y visible.
Future<void> scrollTo(WidgetTester tester, Finder finder) async {
  if (finder.evaluate().isEmpty) {
    await tester.scrollUntilVisible(
      finder,
      200,
      scrollable: verticalScrollable,
    );
  }
  await tester.ensureVisible(finder.first);
  await tester.pumpAndSettle();
}

/// Elige [option] en el desplegable cuyo rótulo es [label].
Future<void> pickOption(TestApp app, String label, String option) async {
  final field = find.text(label);
  await scrollTo(app.tester, field);
  await app.tester.tap(field);
  await app.settle();
  // El menú es una lista: las opciones del final se construyen al desplazar.
  if (find.text(option).evaluate().isEmpty) {
    await app.tester.scrollUntilVisible(
      find.text(option),
      100,
      scrollable: find.byType(Scrollable).last,
    );
  }
  final item = find.text(option).last;
  await app.tester.ensureVisible(item);
  await app.tester.pumpAndSettle();
  await app.tester.tap(item);
  await app.settle();
}

/// La primera lista vertical en pantalla (no los carruseles horizontales).
final Finder verticalScrollable = find
    .byWidgetPredicate(
      (w) => w is Scrollable && w.axisDirection == AxisDirection.down,
    )
    .first;

/// Reloj mutable de la app en las pruebas.
class TestClock {
  TestClock(this.value);
  DateTime value;
}
