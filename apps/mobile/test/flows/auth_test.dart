import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:material_ui/material_ui.dart';
import 'package:petbf/core/api_client.dart';

import '../support/fake_backend.dart';
import '../support/harness.dart';

void main() {
  group('entrar', () {
    testWidgets('sin sesión, Cuenta invita a entrar', (tester) async {
      final app = await startApp(tester, location: '/cuenta');
      expect(find.text('Entra a tu cuenta'), findsOneWidget);
      await tapText(app, 'Entrar');
      expect(find.text('Hola de nuevo'), findsOneWidget);
    });

    testWidgets('valida antes de enviar', (tester) async {
      final app = await startApp(tester, location: '/entrar');
      await tester.tap(find.widgetWithText(FilledButton, 'Entrar'));
      await app.settle();
      expect(find.text('Escribe tu correo'), findsOneWidget);
      expect(find.text('Escribe tu contraseña'), findsOneWidget);

      await fill(tester, 'Correo', 'ana@');
      await tester.tap(find.widgetWithText(FilledButton, 'Entrar'));
      await app.settle();
      expect(find.text('Correo inválido'), findsOneWidget);
      expect(app.backend.called('POST', '/auth/login'), isEmpty);
    });

    testWidgets('contraseña incorrecta muestra el mensaje de la API', (
      tester,
    ) async {
      final app = await startApp(tester, location: '/entrar');
      await fill(tester, 'Correo', 'ana@petbf.com');
      await fill(tester, 'Contraseña', 'otra-clave');
      await tester.tap(find.widgetWithText(FilledButton, 'Entrar'));
      await app.settle();
      expect(find.text('Correo o contraseña incorrectos'), findsOneWidget);
      expect(app.store.tokens, isNull);
    });

    testWidgets('sin conexión y demasiados intentos', (tester) async {
      final app = await startApp(tester, location: '/entrar');
      await fill(tester, 'Correo', 'ana@petbf.com');
      await fill(tester, 'Contraseña', 'secreta123');
      app.backend.offline = true;
      await tester.tap(find.widgetWithText(FilledButton, 'Entrar'));
      await app.settle();
      expect(find.text(networkErrorMessage), findsOneWidget);

      app.backend.offline = false;
      app.backend.overrides['POST /auth/login'] = (_) =>
          http.Response('{"message":"ThrottlerException"}', 429);
      await tester.tap(find.widgetWithText(FilledButton, 'Entrar'));
      await app.settle();
      expect(
        find.text('Demasiados intentos. Espera un minuto.'),
        findsOneWidget,
      );
    });

    testWidgets('con datos correctos entra y vuelve a la cuenta', (
      tester,
    ) async {
      final app = await startApp(tester, location: '/cuenta');
      await tapText(app, 'Entrar');
      await fill(tester, 'Correo', ' Ana@Petbf.com ');
      await fill(tester, 'Contraseña', 'secreta123');
      await tester.tap(find.widgetWithText(FilledButton, 'Entrar'));
      await app.settle();
      expect(find.text('Hola, Ana'), findsOneWidget);
      expect(app.store.tokens, isNotNull);
    });

    testWidgets('una ruta privada pide entrar y luego vuelve a ella', (
      tester,
    ) async {
      final app = await startApp(tester, location: '/pedidos');
      expect(find.text('Hola de nuevo'), findsOneWidget);
      await fill(tester, 'Correo', 'ana@petbf.com');
      await fill(tester, 'Contraseña', 'secreta123');
      await tester.tap(find.widgetWithText(FilledButton, 'Entrar'));
      await app.settle();
      expect(find.text('Mis pedidos'), findsOneWidget);
      expect(find.text('Aún no tienes pedidos'), findsOneWidget);
    });

    testWidgets('con sesión, /entrar lleva directo a la cuenta', (
      tester,
    ) async {
      await startApp(tester, signedInAs: 'ana@petbf.com', location: '/entrar');
      expect(find.text('Hola, Ana'), findsOneWidget);
    });
  });

  group('registro', () {
    Future<TestApp> openForm(WidgetTester tester) =>
        startApp(tester, location: '/registro');

    testWidgets('valida todos los campos', (tester) async {
      final app = await openForm(tester);
      await tapText(app, 'Crear cuenta');
      expect(find.text('Escribe tu nombre'), findsOneWidget);
      expect(find.text('Escribe tu apellido'), findsOneWidget);
      expect(find.text('Escribe tu correo'), findsOneWidget);
      expect(find.text('Escribe una contraseña'), findsOneWidget);

      await fill(tester, 'Teléfono (opcional)', '123');
      await fill(tester, 'Contraseña', '1234567');
      await fill(tester, 'Repite la contraseña', '7654321');
      await tester.tap(find.widgetWithText(FilledButton, 'Crear cuenta'));
      await app.settle();
      expect(find.textContaining('Teléfono inválido'), findsOneWidget);
      expect(
        find.text('La contraseña debe tener al menos 8 caracteres'),
        findsOneWidget,
      );
      expect(find.text('Las contraseñas no coinciden'), findsOneWidget);
      expect(app.backend.called('POST', '/auth/register'), isEmpty);
    });

    testWidgets('correo ya registrado', (tester) async {
      final app = await openForm(tester);
      await fill(tester, 'Nombre', 'Ana');
      await fill(tester, 'Apellido', 'Pérez');
      await fill(tester, 'Correo', 'ana@petbf.com');
      await fill(tester, 'Contraseña', '12345678');
      await fill(tester, 'Repite la contraseña', '12345678');
      await tester.tap(find.widgetWithText(FilledButton, 'Crear cuenta'));
      await app.settle();
      expect(find.text('Ya existe una cuenta con ese correo'), findsOneWidget);
    });

    testWidgets('crea la cuenta y entra', (tester) async {
      final app = await openForm(tester);
      await fill(tester, 'Nombre', ' Luis ');
      await fill(tester, 'Apellido', 'Rojas');
      await fill(tester, 'Correo', 'luis@mail.com');
      await fill(tester, 'Teléfono (opcional)', '0414-7654321');
      await fill(tester, 'Contraseña', 'clave-segura');
      await fill(tester, 'Repite la contraseña', 'clave-segura');
      await tester.tap(find.widgetWithText(FilledButton, 'Crear cuenta'));
      await app.settle();
      expect(find.text('Hola, Luis'), findsOneWidget);
      expect(app.backend.users.containsKey('luis@mail.com'), isTrue);
    });
  });

  group('sesión', () {
    testWidgets('cerrar sesión pide confirmación y revoca el token', (
      tester,
    ) async {
      final app = await startApp(
        tester,
        signedInAs: 'ana@petbf.com',
        location: '/cuenta',
      );
      await tapText(app, 'Cerrar sesión');
      expect(find.text('¿Cerrar sesión?'), findsOneWidget);
      await tapText(app, 'Cancelar');
      expect(find.text('Hola, Ana'), findsOneWidget);

      await tapText(app, 'Cerrar sesión');
      await tester.tap(find.widgetWithText(FilledButton, 'Cerrar sesión'));
      await app.settle();
      expect(find.text('Entra a tu cuenta'), findsOneWidget);
      expect(app.store.tokens, isNull);
      expect(app.backend.refreshTokens, isEmpty);
    });

    testWidgets('si la API ya no acepta la sesión, la app la cierra', (
      tester,
    ) async {
      final backend = FakeBackend();
      final app = await startApp(
        tester,
        backend: backend,
        signedInAs: 'ana@petbf.com',
        location: '/cuenta',
      );
      expect(find.text('Hola, Ana'), findsOneWidget);
      // La API revoca la sesión (p. ej. cuenta desactivada).
      backend.accessTokens.clear();
      backend.refreshTokens.clear();
      await app.go('/pedidos');
      await app.settle();
      expect(find.text('Hola de nuevo'), findsOneWidget);
      expect(app.store.tokens, isNull);
    });

    testWidgets('con la sesión guardada pero sin conexión no la borra', (
      tester,
    ) async {
      final backend = FakeBackend()..offline = true;
      final app = await startApp(
        tester,
        backend: backend,
        signedInAs: 'ana@petbf.com',
        location: '/cuenta',
      );
      expect(find.text('No se pudo cargar'), findsOneWidget);
      expect(app.store.tokens, isNotNull);
      backend.offline = false;
      await tapText(app, 'Reintentar');
      expect(find.text('Hola, Ana'), findsOneWidget);
    });
  });
}
