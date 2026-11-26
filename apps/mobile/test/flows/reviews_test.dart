import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:material_ui/material_ui.dart';
import 'package:petbf/features/catalog/reviews_section.dart';

import '../support/fake_backend.dart';
import '../support/harness.dart';

const ana = 'ana@petbf.com';
const mordedor = '/productos/mordedor-de-caucho';

Future<TestApp> openProduct(
  WidgetTester tester,
  FakeBackend backend, {
  String? signedInAs = ana,
  String location = mordedor,
}) => startApp(
  tester,
  backend: backend,
  signedInAs: signedInAs,
  location: location,
);

/// Ana recibió un mordedor: puede reseñarlo.
FakeBackend withDelivery() =>
    FakeBackend()..seedOrder(ana, status: 'DELIVERED', items: {'v-mord': 1});

/// El lector de pantalla no está activo en las pruebas: se busca el widget.
Finder semantics(String label) => find.byWidgetPredicate(
  (w) => w is Semantics && w.properties.label == label,
);

Finder inSheet(Finder matching) =>
    find.descendant(of: find.byType(BottomSheet), matching: matching);

Future<void> openSection(TestApp app) =>
    scrollTo(app.tester, find.byType(ProductReviews));

Future<void> tapStar(TestApp app, int n) async {
  await app.tester.tap(
    inSheet(find.byTooltip(n == 1 ? '1 estrella' : '$n estrellas')),
  );
  await app.tester.pump();
}

Future<void> fillSheet(TestApp app, String label, String text) async {
  final field = inSheet(find.widgetWithText(TextFormField, label));
  await app.tester.ensureVisible(field);
  await app.tester.enterText(field, text);
  await app.tester.pump();
}

Future<void> submitSheet(TestApp app, String label) async {
  final button = inSheet(find.widgetWithText(FilledButton, label));
  await app.tester.ensureVisible(button);
  await app.tester.tap(button);
  await app.settle();
}

void main() {
  group('resumen y lista', () {
    testWidgets('sin reseñas: lo dice y no pinta estrellas', (tester) async {
      final app = await openProduct(tester, FakeBackend());
      await openSection(app);
      expect(find.text('Todavía no hay reseñas.'), findsOneWidget);
      expect(find.byIcon(Icons.star_rounded), findsNothing);
      // Con una sola reseña o ninguna, no hay botones de orden.
      expect(find.text('Más recientes'), findsNothing);
    });

    testWidgets('promedio, distribución, autor y compra verificada', (
      tester,
    ) async {
      final backend = FakeBackend()
        ..seedReview(
          'mordedor-de-caucho',
          rating: 5,
          title: 'Resistente',
          author: 'Luis G.',
          createdAt: DateTime.utc(2026, 11, 20, 15),
        )
        ..seedReview('mordedor-de-caucho', rating: 4, author: 'Eva M.')
        ..seedReview(
          'mordedor-de-caucho',
          rating: 1,
          body: 'Texto ofensivo que el equipo ocultó.',
          status: 'HIDDEN',
          hiddenReason: 'Lenguaje ofensivo',
        );
      final app = await openProduct(tester, backend, signedInAs: null);
      // Debajo del nombre (y en el resumen): promedio y cuántas; la oculta
      // no cuenta.
      expect(semantics('4,5 de 5 estrellas, 2 reseñas'), findsWidgets);
      expect(
        tester.getTopLeft(find.text('4,5 (2)').first).dy,
        lessThan(tester.getTopLeft(find.text('Añadir al carrito')).dy),
      );
      await openSection(app);
      expect(find.text('4,5'), findsOneWidget);
      expect(semantics('5 estrellas: 1'), findsOneWidget);
      expect(semantics('4 estrellas: 1'), findsOneWidget);
      expect(semantics('1 estrella: 0'), findsOneWidget);
      await scrollTo(tester, find.text('Resistente'));
      expect(find.text('Resistente'), findsOneWidget);
      expect(
        find.text('Luis G. · Compra verificada · 20 nov 2026'),
        findsOneWidget,
      );
      expect(semantics('5 de 5 estrellas'), findsOneWidget);
      expect(find.textContaining('Eva M. · Compra verificada'), findsOneWidget);
      expect(find.text('Texto ofensivo que el equipo ocultó.'), findsNothing);
    });

    testWidgets('ordena por mejor y peor valoradas', (tester) async {
      final backend = FakeBackend()
        ..seedReview(
          'mordedor-de-caucho',
          rating: 2,
          body: 'Se rompió muy rápido.',
          createdAt: DateTime.utc(2026, 11, 25),
        )
        ..seedReview(
          'mordedor-de-caucho',
          rating: 5,
          body: 'Mi perro lo adora.',
          createdAt: DateTime.utc(2026, 11, 10),
        );
      final app = await openProduct(tester, backend, signedInAs: null);
      await scrollTo(tester, find.text('Mejor valoradas'));

      double top(String text) => tester.getTopLeft(find.text(text)).dy;
      // Por defecto, la más reciente primero.
      expect(top('Se rompió muy rápido.'), lessThan(top('Mi perro lo adora.')));
      await tapText(app, 'Mejor valoradas');
      expect(
        backend
            .called('GET', '/products/mordedor-de-caucho/reviews')
            .last
            .url
            .queryParameters['sort'],
        'best',
      );
      expect(top('Mi perro lo adora.'), lessThan(top('Se rompió muy rápido.')));
      await tapText(app, 'Peor valoradas');
      expect(top('Se rompió muy rápido.'), lessThan(top('Mi perro lo adora.')));
    });

    testWidgets('pide 10 por página y "Ver más reseñas" trae el resto', (
      tester,
    ) async {
      final backend = FakeBackend();
      for (var i = 1; i <= 12; i++) {
        backend.seedReview(
          'mordedor-de-caucho',
          rating: 4,
          body: 'Opinión número $i del mordedor.',
          createdAt: DateTime.utc(2026, 11, i),
        );
      }
      final app = await openProduct(tester, backend, signedInAs: null);
      final request = backend
          .called('GET', '/products/mordedor-de-caucho/reviews')
          .single;
      expect(request.url.queryParameters, {
        'sort': 'recent',
        'page': '1',
        'pageSize': '10',
      });
      await scrollTo(tester, find.text('Ver más reseñas'));
      expect(find.text('Opinión número 2 del mordedor.'), findsNothing);
      await tapText(app, 'Ver más reseñas');
      expect(
        backend
            .called('GET', '/products/mordedor-de-caucho/reviews')
            .last
            .url
            .queryParameters['page'],
        '2',
      );
      await scrollTo(tester, find.text('Opinión número 1 del mordedor.'));
      expect(find.text('Opinión número 1 del mordedor.'), findsOneWidget);
      expect(find.text('Ver más reseñas'), findsNothing);
    });

    testWidgets('"Ver más" que falla avisa y conserva lo cargado', (
      tester,
    ) async {
      final backend = FakeBackend();
      for (var i = 1; i <= 11; i++) {
        backend.seedReview(
          'mordedor-de-caucho',
          rating: 3,
          body: 'Opinión número $i del mordedor.',
          createdAt: DateTime.utc(2026, 11, i),
        );
      }
      final app = await openProduct(tester, backend, signedInAs: null);
      backend.overrides['GET /products/mordedor-de-caucho/reviews'] = (_) =>
          http.Response(
            jsonEncode({'statusCode': 500, 'message': 'Error interno'}),
            500,
            headers: {'content-type': 'application/json'},
          );
      await scrollTo(tester, find.text('Ver más reseñas'));
      await tapText(app, 'Ver más reseñas');
      expect(find.text('Opinión número 11 del mordedor.'), findsOneWidget);
      expect(find.byType(SnackBar), findsOneWidget);
      expect(find.text('Ver más reseñas'), findsOneWidget);
    });

    testWidgets('si la lista no carga, ofrece reintentar', (tester) async {
      final backend = FakeBackend()
        ..seedReview('mordedor-de-caucho', rating: 5, author: 'Luis G.');
      backend.overrides['GET /products/mordedor-de-caucho/reviews'] = (_) =>
          http.Response(
            jsonEncode({'statusCode': 500, 'message': 'Error interno'}),
            500,
            headers: {'content-type': 'application/json'},
          );
      final app = await openProduct(tester, backend, signedInAs: null);
      // La ficha se ve igual; solo la sección de reseñas falla.
      expect(find.text('Añadir al carrito'), findsOneWidget);
      await scrollTo(tester, find.text('Reintentar'));
      backend.overrides.clear();
      await tapText(app, 'Reintentar');
      expect(find.textContaining('Luis G.'), findsOneWidget);
    });

    testWidgets('las tarjetas de la tienda muestran la valoración', (
      tester,
    ) async {
      final backend = FakeBackend()
        ..seedReview('mordedor-de-caucho', rating: 4)
        ..seedReview('mordedor-de-caucho', rating: 5);
      await startApp(tester, backend: backend, location: '/productos');
      expect(semantics('4,5 de 5 estrellas, 2 reseñas'), findsOneWidget);
    });
  });

  group('mi reseña', () {
    testWidgets('sin sesión invita a entrar y vuelve a la ficha', (
      tester,
    ) async {
      final backend = FakeBackend();
      final app = await openProduct(tester, backend, signedInAs: null);
      await openSection(app);
      expect(
        find.text(
          'Entra a tu cuenta para reseñar los productos que compraste.',
        ),
        findsOneWidget,
      );
      expect(
        backend.called('GET', '/products/mordedor-de-caucho/reviews/mine'),
        isEmpty,
      );
      await tapText(app, 'Entrar');
      expect(app.router.state.uri.path, '/entrar');
      expect(app.router.state.uri.queryParameters['next'], mordedor);
    });

    testWidgets('sin haberlo recibido no puede reseñar', (tester) async {
      // Un pedido pagado pero sin entregar todavía no cuenta.
      final backend = FakeBackend()
        ..seedOrder(ana, status: 'PAID', items: {'v-mord': 1});
      final app = await openProduct(tester, backend);
      await openSection(app);
      expect(
        find.text('Podrás dejar una reseña cuando recibas este producto.'),
        findsOneWidget,
      );
      expect(find.text('Escribir una reseña'), findsNothing);
    });

    testWidgets('valida estrellas y texto antes de enviar', (tester) async {
      final backend = withDelivery();
      final app = await openProduct(tester, backend);
      await openSection(app);
      await tapText(app, 'Escribir una reseña');
      expect(inSheet(find.text('Escribir una reseña')), findsOneWidget);

      await submitSheet(app, 'Publicar reseña');
      expect(find.text('Elige de 1 a 5 estrellas'), findsOneWidget);
      expect(find.text('Cuéntanos tu experiencia'), findsOneWidget);

      await tapStar(app, 4);
      expect(find.text('Elige de 1 a 5 estrellas'), findsNothing);
      await fillSheet(app, 'Tu experiencia', '  corto  ');
      await submitSheet(app, 'Publicar reseña');
      expect(
        find.text('Cuéntanos un poco más (mínimo 10 caracteres)'),
        findsOneWidget,
      );
      // Nada llegó a la API.
      expect(
        backend.called('PUT', '/products/mordedor-de-caucho/reviews/mine'),
        isEmpty,
      );
      // Los campos no dejan escribir de más.
      await fillSheet(app, 'Título (opcional)', 'x' * 90);
      expect(
        tester
            .widget<EditableText>(
              inSheet(
                find.descendant(
                  of: find.widgetWithText(TextFormField, 'Título (opcional)'),
                  matching: find.byType(EditableText),
                ),
              ),
            )
            .controller
            .text
            .length,
        80,
      );
    });

    testWidgets('publica, actualiza el promedio y muestra la propia', (
      tester,
    ) async {
      final backend = withDelivery()
        ..seedReview('mordedor-de-caucho', rating: 2, author: 'Luis G.');
      final app = await openProduct(tester, backend);
      await openSection(app);
      await tapText(app, 'Escribir una reseña');
      await tapStar(app, 5);
      await fillSheet(app, 'Título (opcional)', '  Muy resistente  ');
      await fillSheet(app, 'Tu experiencia', '  Lo usa todos los días.  ');
      await submitSheet(app, 'Publicar reseña');

      final body = jsonDecode(
        backend
            .called('PUT', '/products/mordedor-de-caucho/reviews/mine')
            .single
            .body,
      ) as Json;
      expect(body, {
        'rating': 5,
        'title': 'Muy resistente',
        'body': 'Lo usa todos los días.',
      });
      expect(find.byType(BottomSheet), findsNothing);
      expect(find.text('¡Gracias! Tu reseña quedó guardada.'), findsOneWidget);
      // La ficha se recarga con el nuevo promedio.
      expect(semantics('3,5 de 5 estrellas, 2 reseñas'), findsWidgets);
      expect(semantics('4,5 de 5 estrellas, 2 reseñas'), findsNothing);
      await openSection(app);
      expect(find.text('Tu reseña'), findsOneWidget);
      expect(find.text('Escribir una reseña'), findsNothing);
      expect(find.text('Editar'), findsOneWidget);
      await scrollTo(tester, find.textContaining('Ana P. · Compra verificada'));
      expect(find.textContaining('Ana P. · Compra verificada'), findsOneWidget);
    });

    testWidgets('edita: el formulario trae lo guardado y quita el título', (
      tester,
    ) async {
      final backend = withDelivery()
        ..seedReview(
          'mordedor-de-caucho',
          email: ana,
          author: 'Ana P.',
          rating: 3,
          title: 'Regular',
          body: 'Mi perro lo mordió poco.',
        );
      final app = await openProduct(tester, backend);
      await openSection(app);
      await tapText(app, 'Editar');
      expect(inSheet(find.text('Editar mi reseña')), findsOneWidget);
      expect(inSheet(find.text('Regular')), findsOneWidget);
      expect(inSheet(find.text('Mi perro lo mordió poco.')), findsOneWidget);
      await fillSheet(app, 'Regular', '   ');
      await tapStar(app, 1);
      await submitSheet(app, 'Guardar cambios');
      final body = jsonDecode(
        backend
            .called('PUT', '/products/mordedor-de-caucho/reviews/mine')
            .single
            .body,
      ) as Json;
      // Sin título: la API lo borra.
      expect(body, {'rating': 1, 'body': 'Mi perro lo mordió poco.'});
      expect(backend.reviews.single['title'], isNull);
      expect(backend.reviews.single['rating'], 1);
      expect(find.text('¡Gracias! Tu reseña quedó guardada.'), findsOneWidget);
    });

    testWidgets('el error de la API queda en el formulario', (tester) async {
      final backend = withDelivery();
      final app = await openProduct(tester, backend);
      await openSection(app);
      await tapText(app, 'Escribir una reseña');
      // Entretanto, el pedido se anuló: la API ya no deja reseñar.
      backend.orders.single['status'] = 'CANCELLED';
      await tapStar(app, 5);
      await fillSheet(
        app,
        'Tu experiencia',
        'Excelente producto, lo recomiendo.',
      );
      await submitSheet(app, 'Publicar reseña');
      expect(
        inSheet(
          find.text(
            'Solo puedes reseñar productos que compraste y ya recibiste',
          ),
        ),
        findsOneWidget,
      );
      expect(find.byType(BottomSheet), findsOneWidget);
      expect(backend.reviews, isEmpty);
    });

    testWidgets('reseña oculta por el equipo: muestra el motivo', (
      tester,
    ) async {
      final backend = withDelivery()
        ..seedReview(
          'mordedor-de-caucho',
          email: ana,
          rating: 1,
          body: 'Texto que el equipo ocultó.',
          status: 'HIDDEN',
          hiddenReason: 'Datos personales',
        );
      final app = await openProduct(tester, backend);
      await openSection(app);
      expect(
        find.text('El equipo ocultó tu reseña: Datos personales'),
        findsOneWidget,
      );
      // No cuenta en el promedio público.
      expect(find.text('Todavía no hay reseñas.'), findsOneWidget);
    });

    testWidgets('borrar pide confirmación', (tester) async {
      final backend = withDelivery()
        ..seedReview(
          'mordedor-de-caucho',
          email: ana,
          author: 'Ana P.',
          rating: 4,
        );
      final app = await openProduct(tester, backend);
      await openSection(app);
      await tapText(app, 'Borrar mi reseña');
      expect(find.text('¿Borrar tu reseña?'), findsOneWidget);
      await tapText(app, 'Cancelar');
      expect(backend.reviews, hasLength(1));

      await tapText(app, 'Borrar mi reseña');
      await tester.tap(find.widgetWithText(FilledButton, 'Borrar'));
      await app.settle();
      expect(backend.reviews, isEmpty);
      expect(find.text('Borraste tu reseña.'), findsOneWidget);
      await openSection(app);
      expect(find.text('Escribir una reseña'), findsOneWidget);
      expect(find.text('Todavía no hay reseñas.'), findsOneWidget);
    });

    testWidgets('borrar una que ya no existe muestra el aviso', (tester) async {
      final backend = withDelivery()
        ..seedReview('mordedor-de-caucho', email: ana, rating: 4);
      final app = await openProduct(tester, backend);
      await openSection(app);
      backend.reviews.clear();
      await tapText(app, 'Borrar mi reseña');
      await tester.tap(find.widgetWithText(FilledButton, 'Borrar'));
      await app.settle();
      expect(
        find.text('No tienes una reseña de este producto'),
        findsOneWidget,
      );
    });
  });

  group('recomendados', () {
    testWidgets('muestra hasta 4 y abre la ficha', (tester) async {
      final backend = FakeBackend();
      final app = await openProduct(tester, backend, signedInAs: null);
      await scrollTo(tester, find.text('También te puede gustar'));
      final tile = find.descendant(
        of: find.byType(Recommendations),
        matching: find.text('Alimento seco adulto'),
      );
      expect(tile, findsOneWidget);
      await tester.ensureVisible(tile);
      await tester.tap(tile);
      await app.settle();
      expect(app.router.state.uri.path, '/productos/alimento-seco-adulto');
    });

    testWidgets('sin recomendados o con error, no aparece', (tester) async {
      final backend = FakeBackend()..recommendations['p-3'] = [];
      final app = await openProduct(tester, backend, signedInAs: null);
      await openSection(app);
      expect(find.text('También te puede gustar'), findsNothing);

      backend.recommendations.remove('p-3');
      backend.overrides['GET /products/mordedor-de-caucho/recommendations'] =
          (_) => http.Response(
            jsonEncode({'statusCode': 500, 'message': 'Error interno'}),
            500,
            headers: {'content-type': 'application/json'},
          );
      await app.go('/productos/arena-aglomerante');
      await app.go(mordedor);
      await openSection(app);
      expect(find.text('También te puede gustar'), findsNothing);
    });
  });
}
