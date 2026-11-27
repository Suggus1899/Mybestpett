import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import 'core/providers.dart';
import 'features/account/account_screen.dart';
import 'features/account/addresses_screen.dart';
import 'features/account/auth_screens.dart';
import 'features/account/points_screen.dart';
import 'features/animals/animal_screen.dart';
import 'features/animals/animals_screen.dart';
import 'features/cart/cart_screen.dart';
import 'features/catalog/catalog_screen.dart';
import 'features/catalog/combos_screen.dart';
import 'features/catalog/product_screen.dart';
import 'features/checkout/checkout_screen.dart';
import 'features/home/home_screen.dart';
import 'features/orders/order_screen.dart';
import 'features/orders/orders_screen.dart';
import 'widgets/shell.dart';

/// Rutas que exigen cuenta: sin sesión se va a entrar y se vuelve después.
const protectedPrefixes = [
  '/checkout',
  '/pedidos',
  '/cuenta/direcciones',
  '/cuenta/puntos',
];

/// Solo se aceptan rutas internas en `next` (evita redirecciones raras).
String safeNext(String? value, {String fallback = '/cuenta'}) {
  if (value == null || !value.startsWith('/') || value.startsWith('//')) {
    return fallback;
  }
  return value;
}

/// Decide a dónde ir según la sesión. Separada del router para probarla.
String? redirectFor(Uri uri, {required bool signedIn, required bool loading}) {
  final path = uri.path;
  final isProtected = protectedPrefixes.any(
    (p) => path == p || path.startsWith('$p/'),
  );
  if (isProtected && !signedIn && !loading) {
    return Uri(
      path: '/entrar',
      queryParameters: {'next': uri.toString()},
    ).toString();
  }
  final isAuthPage = path == '/entrar' || path == '/registro';
  if (isAuthPage && signedIn) {
    return safeNext(uri.queryParameters['next']);
  }
  return null;
}

final _rootKey = GlobalKey<NavigatorState>(debugLabel: 'root');

final routerProvider = Provider<GoRouter>((ref) {
  // El router se reevalúa cuando cambia la sesión (entrar, salir, expirar).
  final refresh = ValueNotifier<int>(0);
  ref.listen(sessionProvider, (_, _) => refresh.value++);
  ref.onDispose(refresh.dispose);

  final router = GoRouter(
    navigatorKey: _rootKey,
    initialLocation: '/',
    refreshListenable: refresh,
    redirect: (context, state) {
      // Se lee la sesión directamente: un provider derivado sin oyentes
      // puede devolver un valor anterior dentro de este callback.
      final session = ref.read(sessionProvider);
      return redirectFor(
        state.uri,
        signedIn: isSignedIn(session),
        loading: session.isLoading && !session.hasValue,
      );
    },
    routes: [
      StatefulShellRoute.indexedStack(
        builder: (context, state, shell) => AppShell(shell: shell),
        branches: [
          StatefulShellBranch(
            routes: [GoRoute(path: '/', builder: (_, _) => const HomeScreen())],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/productos',
                builder: (_, state) => CatalogScreen(
                  key: ValueKey(state.uri.query),
                  initial: catalogQueryFromUri(state.uri),
                ),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/animales',
                builder: (_, state) => AnimalsScreen(
                  key: ValueKey(state.uri.query),
                  initialTab: state.uri.queryParameters['tipo'] == 'adopcion'
                      ? 1
                      : 0,
                ),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(path: '/carrito', builder: (_, _) => const CartScreen()),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/cuenta',
                builder: (_, _) => const AccountScreen(),
              ),
            ],
          ),
        ],
      ),
      GoRoute(
        parentNavigatorKey: _rootKey,
        path: '/productos/:slug',
        builder: (_, state) =>
            ProductScreen(slug: state.pathParameters['slug']!),
      ),
      GoRoute(
        parentNavigatorKey: _rootKey,
        path: '/combos',
        builder: (_, _) => const CombosScreen(),
      ),
      GoRoute(
        parentNavigatorKey: _rootKey,
        path: '/animales/:slug',
        builder: (_, state) =>
            AnimalScreen(slug: state.pathParameters['slug']!),
      ),
      GoRoute(
        parentNavigatorKey: _rootKey,
        path: '/entrar',
        builder: (_, state) =>
            LoginScreen(next: safeNext(state.uri.queryParameters['next'])),
      ),
      GoRoute(
        parentNavigatorKey: _rootKey,
        path: '/registro',
        builder: (_, state) =>
            RegisterScreen(next: safeNext(state.uri.queryParameters['next'])),
      ),
      GoRoute(
        parentNavigatorKey: _rootKey,
        path: '/checkout',
        builder: (_, _) => const CheckoutScreen(),
      ),
      GoRoute(
        parentNavigatorKey: _rootKey,
        path: '/pedidos',
        builder: (_, _) => const OrdersScreen(),
        routes: [
          GoRoute(
            parentNavigatorKey: _rootKey,
            path: ':id',
            builder: (_, state) => OrderScreen(id: state.pathParameters['id']!),
          ),
        ],
      ),
      GoRoute(
        parentNavigatorKey: _rootKey,
        path: '/cuenta/direcciones',
        builder: (_, _) => const AddressesScreen(),
      ),
      GoRoute(
        parentNavigatorKey: _rootKey,
        path: '/cuenta/puntos',
        builder: (_, _) => const PointsScreen(),
      ),
    ],
    errorBuilder: (context, state) => Scaffold(
      appBar: AppBar(),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                'Esta página no existe',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () => context.go('/'),
                child: const Text('Ir al inicio'),
              ),
            ],
          ),
        ),
      ),
    ),
  );
  ref.onDispose(router.dispose);
  return router;
});
