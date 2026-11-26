import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:material_ui/material_ui.dart';
import 'package:petbf/widgets/common.dart';

import '../support/fake_backend.dart';
import '../support/harness.dart';

void main() {
  group('inicio', () {
    testWidgets('muestra novedades, adopción y la tasa del BCV', (
      tester,
    ) async {
      await startApp(tester);
      expect(find.text('Lo más nuevo'), findsOneWidget);
      expect(find.text('Alimento seco adulto'), findsOneWidget);
      expect(
        find.textContaining('Tasa BCV: Bs. 36,50 por dólar'),
        findsOneWidget,
      );
      await tester.dragUntilVisible(
        find.text('Luna'),
        find.byType(ListView).first,
        const Offset(0, -200),
      );
      expect(find.text('Luna'), findsOneWidget);
    });

    testWidgets('sin tasa cargada muestra solo dólares', (tester) async {
      final backend = FakeBackend()..rates = const FakeRates();
      await startApp(tester, backend: backend);
      expect(find.textContaining('Tasa BCV'), findsNothing);
      expect(find.textContaining('Bs.'), findsNothing);
      expect(find.text(r'Desde $10,90'), findsOneWidget);
    });

    testWidgets('el acceso por especie abre la tienda filtrada', (
      tester,
    ) async {
      final app = await startApp(tester);
      await tapText(app, 'Gatos');
      expect(app.router.state.uri.toString(), '/productos?especie=CAT');
      expect(find.text('Arena aglomerante'), findsOneWidget);
      expect(find.text('Mordedor de caucho'), findsNothing);
    });
  });

  group('tienda', () {
    testWidgets('lista productos con precio en dólares y bolívares', (
      tester,
    ) async {
      await startApp(tester, location: '/productos');
      expect(find.text('3 productos'), findsOneWidget);
      expect(find.text(r'Desde $10,90'), findsOneWidget);
      expect(find.text('Bs. 397,85'), findsOneWidget); // 10,90 × 36,5
      expect(find.text('Agotado'), findsOneWidget); // la arena
      expect(find.text('−17 %'), findsNothing); // la oferta no es la más barata
    });

    testWidgets('busca tras dejar de escribir y exige 2 letras', (
      tester,
    ) async {
      final app = await startApp(tester, location: '/productos');
      final search = find.byType(TextField).first;

      await tester.enterText(search, 'm');
      await tester.pump(const Duration(milliseconds: 500));
      await app.settle();
      expect(find.text('Escribe al menos 2 letras'), findsOneWidget);
      expect(
        app.backend.requests.where((r) => r.url.queryParameters['q'] != null),
        isEmpty,
      );

      await tester.enterText(search, 'mord');
      await tester.pump(const Duration(milliseconds: 100));
      await tester.enterText(search, 'morde');
      await tester.pump(const Duration(milliseconds: 500));
      await app.settle();
      expect(find.text('1 producto'), findsOneWidget);
      expect(find.text('Mordedor de caucho'), findsOneWidget);
      // Solo se pidió la búsqueda final, no una por letra.
      final searches = app.backend.requests
          .map((r) => r.url.queryParameters['q'])
          .whereType<String>()
          .toList();
      expect(searches, ['morde']);

      await tester.tap(find.byTooltip('Borrar búsqueda'));
      await app.settle();
      expect(find.text('3 productos'), findsOneWidget);
    });

    testWidgets('sin resultados', (tester) async {
      final app = await startApp(tester, location: '/productos');
      await tester.enterText(find.byType(TextField).first, 'dinosaurio');
      await tester.pump(const Duration(milliseconds: 500));
      await app.settle();
      expect(find.text('Sin resultados'), findsOneWidget);
    });

    testWidgets('filtros de ofertas, categoría y especie', (tester) async {
      final app = await startApp(tester, location: '/productos');

      await tester.tap(find.widgetWithText(FilterChip, 'Ofertas'));
      await app.settle();
      expect(find.text('1 producto'), findsOneWidget);
      expect(find.text('Alimento seco adulto'), findsOneWidget);
      await tapText(app, 'Quitar filtros');
      expect(find.text('3 productos'), findsOneWidget);

      await tester.tap(find.widgetWithText(ActionChip, 'Categoría'));
      await app.settle();
      expect(
        find.widgetWithText(ListTile, 'Alimento para perro'),
        findsOneWidget,
      ); // subcategoría
      await tapText(app, 'Perros');
      // "Perros" incluye su subcategoría de alimento.
      expect(find.text('2 productos'), findsOneWidget);
      expect(
        app.backend.requests.last.url.queryParameters['category'],
        'perros',
      );
      expect(find.widgetWithText(ActionChip, 'Perros'), findsOneWidget);

      await tester.tap(find.widgetWithText(ActionChip, 'Perros'));
      await app.settle();
      await tapText(app, 'Todas las categorías');
      expect(find.text('3 productos'), findsOneWidget);

      await tester.tap(find.widgetWithText(ChoiceChip, 'Gatos'));
      await app.settle();
      expect(find.text('1 producto'), findsOneWidget);
      expect(app.backend.requests.last.url.queryParameters['species'], 'CAT');
    });

    testWidgets('ordenar por nombre', (tester) async {
      final app = await startApp(tester, location: '/productos');
      await tester.tap(find.byTooltip('Ordenar'));
      await app.settle();
      await tapText(app, 'Nombre (A-Z)');
      expect(app.backend.requests.last.url.queryParameters['sort'], 'name');
    });

    testWidgets('error al cargar y reintentar', (tester) async {
      final backend = FakeBackend();
      backend.overrides['GET /products'] = (_) => http.Response('error', 500);
      final app = await startApp(
        tester,
        backend: backend,
        location: '/productos',
      );
      expect(find.text('No se pudo cargar'), findsOneWidget);
      expect(
        find.textContaining('El servidor tuvo un problema'),
        findsOneWidget,
      );
      backend.overrides.clear();
      await tapText(app, 'Reintentar');
      expect(find.text('3 productos'), findsOneWidget);
    });

    testWidgets('pagina al llegar al final', (tester) async {
      final backend = FakeBackend();
      for (var i = 0; i < 30; i++) {
        backend.products.add(
          FakeBackend.product(
            id: 'extra-$i',
            name: 'Juguete $i',
            slug: 'juguete-$i',
            category: 'perros',
            species: ['DOG'],
            variants: [FakeBackend.variant('ve-$i', 'JUG-$i', 'Único', 500)],
          ),
        );
      }
      final app = await startApp(
        tester,
        backend: backend,
        location: '/productos',
      );
      expect(find.text('33 productos'), findsOneWidget);
      expect(
        app.backend.called('GET', '/products').last.url.queryParameters['page'],
        '1',
      );
      await tester.fling(
        find.byType(CustomScrollView),
        const Offset(0, -6000),
        3000,
      );
      await app.settle();
      final pages = app.backend
          .called('GET', '/products')
          .map((r) => r.url.queryParameters['page'])
          .toList();
      expect(pages, containsAllInOrder(['1', '2']));
      expect(pages.where((p) => p == '2'), hasLength(1)); // sin pedir doble
    });
  });

  group('ficha de producto', () {
    testWidgets('elige presentación y ve la oferta', (tester) async {
      final app = await startApp(
        tester,
        location: '/productos/alimento-seco-adulto',
      );
      expect(find.text('Alimento seco adulto'), findsOneWidget);
      expect(
        find.text('Por higiene, no se aceptan devoluciones una vez abierto.'),
        findsOneWidget,
      );
      expect(find.text(r'$10,90'), findsWidgets);
      await tapText(app, r'3 kg · $24,90');
      expect(find.text('−17 %'), findsOneWidget);
      expect(find.text(r'$29,90'), findsOneWidget); // precio anterior tachado
      expect(find.text('Bs. 908,85'), findsOneWidget);
    });

    testWidgets('cantidad entre 1 y 20', (tester) async {
      await startApp(tester, location: '/productos/mordedor-de-caucho');
      final minus = find.widgetWithIcon(IconButton, Icons.remove);
      final plus = find.widgetWithIcon(IconButton, Icons.add);
      expect(tester.widget<IconButton>(minus).onPressed, isNull);
      for (var i = 0; i < 25; i++) {
        await tester.tap(plus);
        await tester.pump();
      }
      expect(find.text('20'), findsOneWidget);
      expect(tester.widget<IconButton>(plus).onPressed, isNull);
      expect(find.text(r'$178,00'), findsOneWidget); // 20 × 8,90
    });

    testWidgets('agotado: no se puede añadir', (tester) async {
      await startApp(tester, location: '/productos/arena-aglomerante');
      final button = find.widgetWithText(FilledButton, 'Agotado');
      expect(button, findsOneWidget);
      expect(tester.widget<FilledButton>(button).onPressed, isNull);
      expect(find.byType(QuantityStepper), findsNothing);
    });

    testWidgets('sin sesión, añadir lleva a entrar y vuelve a la ficha', (
      tester,
    ) async {
      final app = await startApp(
        tester,
        location: '/productos/mordedor-de-caucho',
      );
      await tapText(app, 'Añadir al carrito');
      expect(find.text('Hola de nuevo'), findsOneWidget);
      await fill(tester, 'Correo', 'ana@petbf.com');
      await fill(tester, 'Contraseña', 'secreta123');
      await tester.tap(find.widgetWithText(FilledButton, 'Entrar'));
      await app.settle();
      expect(app.router.state.uri.path, '/productos/mordedor-de-caucho');
      expect(app.backend.called('POST', '/cart/items'), isEmpty);
    });

    testWidgets('con sesión añade al carrito y actualiza el contador', (
      tester,
    ) async {
      final app = await startApp(
        tester,
        signedInAs: 'ana@petbf.com',
        location: '/productos/mordedor-de-caucho',
      );
      await tester.tap(find.byTooltip('Añadir uno'));
      await tester.pump();
      await tapText(app, 'Añadir al carrito');
      expect(
        find.text('Añadiste 2 × Mordedor de caucho al carrito.'),
        findsOneWidget,
      );
      expect(app.backend.carts['ana@petbf.com'], {'v-mord': 2});
      await tapText(app, 'Ver carrito');
      expect(find.text('Tu carrito'), findsOneWidget);
      expect(find.text('2'), findsWidgets); // contador y cantidad
    });

    testWidgets('más que el stock: muestra el aviso de la API', (tester) async {
      final app = await startApp(
        tester,
        signedInAs: 'ana@petbf.com',
        location: '/productos/alimento-seco-adulto',
      );
      await tapText(app, r'3 kg · $24,90');
      for (var i = 0; i < 3; i++) {
        await tester.tap(find.byTooltip('Añadir uno'));
        await tester.pump();
      }
      await tapText(app, 'Añadir al carrito');
      expect(
        find.text('Solo hay 3 disponibles de esta presentación'),
        findsOneWidget,
      );
    });

    testWidgets('producto inexistente', (tester) async {
      await startApp(tester, location: '/productos/no-existe');
      expect(find.text('No lo encontramos'), findsOneWidget);
      expect(find.text('Producto no encontrado'), findsOneWidget);
      expect(find.text('Reintentar'), findsNothing);
    });
  });

  group('animales y adopción', () {
    testWidgets('pestañas de venta y adopción', (tester) async {
      final app = await startApp(tester, location: '/animales');
      expect(find.text('Max'), findsOneWidget);
      expect(find.text('Reservado'), findsOneWidget);
      expect(find.text(r'$150,00'), findsOneWidget);
      await tapText(app, 'En adopción');
      expect(find.text('Luna'), findsOneWidget);
      expect(
        app.backend
            .called('GET', '/animals')
            .map((r) => r.url.queryParameters['listingType']),
        containsAll(['SALE', 'ADOPTION']),
      );
    });

    testWidgets('/animales?tipo=adopcion abre la pestaña de adopción', (
      tester,
    ) async {
      await startApp(tester, location: '/animales?tipo=adopcion');
      expect(find.text('Luna'), findsOneWidget);
    });

    testWidgets('filtro por especie sin resultados', (tester) async {
      final app = await startApp(tester, location: '/animales');
      await tester.tap(find.widgetWithText(ChoiceChip, 'Aves'));
      await app.settle();
      expect(find.text('No hay animales en venta'), findsOneWidget);
    });

    testWidgets('ficha de adopción: datos, edad y aviso', (tester) async {
      await startApp(tester, location: '/animales/luna');
      expect(find.text('Luna'), findsOneWidget);
      expect(find.text('Hembra'), findsOneWidget);
      expect(find.text('Mestizo'), findsOneWidget);
      expect(
        find.text('1 año y 3 meses'),
        findsOneWidget,
      ); // nació el 1 ago 2025
      await tester.dragUntilVisible(
        find.text(
          'Las solicitudes de adopción se abren en la próxima versión.',
        ),
        find.byType(ListView).first,
        const Offset(0, -200),
      );
    });

    testWidgets('ficha de venta reservada', (tester) async {
      await startApp(tester, location: '/animales/max');
      expect(
        find.text('Reservado: ya hay alguien interesado.'),
        findsOneWidget,
      );
      expect(find.text(r'$150,00'), findsOneWidget);
      expect(find.text('Bs. 5.475,00'), findsOneWidget);
      expect(find.text('Sin dato'), findsOneWidget);
    });

    testWidgets('animal inexistente', (tester) async {
      await startApp(tester, location: '/animales/nadie');
      expect(find.text('Animal no encontrado'), findsOneWidget);
    });
  });
}
