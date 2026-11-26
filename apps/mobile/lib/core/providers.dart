import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/catalog.dart';
import '../models/json.dart';
import '../models/shop.dart';
import 'api_client.dart';
import 'petbf_api.dart';

/// Reloj de la app; las pruebas lo fijan para controlar plazos y edades.
final clockProvider = Provider<DateTime Function()>((ref) => DateTime.now);

/// Se reemplaza en main.dart (y en las pruebas) con el cliente real o uno falso.
final apiClientProvider = Provider<ApiClient>(
  (ref) => throw UnimplementedError('apiClientProvider sin configurar'),
);

final apiProvider = Provider<PetbfApi>(
  (ref) => PetbfApi(ref.watch(apiClientProvider)),
);

/// Reintentos automáticos de Riverpod: solo ante fallos de conexión
/// (3 intentos: 1 s, 2 s, 4 s). Un 4xx no mejora reintentando.
Duration? retryOnNetworkError(int retryCount, Object error) {
  if (error is ApiException && error.isNetwork && retryCount < 3) {
    return Duration(seconds: 1 << retryCount);
  }
  return null;
}

// ---------- Sesión ----------

/// La persona con sesión, o null si no ha entrado.
class SessionController extends AsyncNotifier<User?> {
  @override
  Future<User?> build() async {
    final client = ref.watch(apiClientProvider);
    final sub = client.sessionExpired.listen((_) {
      state = const AsyncData(null);
    });
    ref.onDispose(sub.cancel);

    if (!await client.hasSession) return null;
    try {
      return await ref.read(apiProvider).me();
    } on ApiException catch (e) {
      if (e.isUnauthorized) return null;
      rethrow; // sin conexión: la sesión sigue guardada; se reintenta.
    }
  }

  /// Los errores (correo repetido, contraseña incorrecta...) los muestra el formulario.
  Future<void> login(String email, String password) async {
    final user = await ref
        .read(apiProvider)
        .login(email: email, password: password);
    state = AsyncData(user);
  }

  Future<void> register({
    required String email,
    required String password,
    required String firstName,
    required String lastName,
    String? phone,
  }) async {
    final user = await ref
        .read(apiProvider)
        .register(
          email: email,
          password: password,
          firstName: firstName,
          lastName: lastName,
          phone: phone,
        );
    state = AsyncData(user);
  }

  Future<void> logout() async {
    await ref.read(apiProvider).logout();
    state = const AsyncData(null);
  }
}

final sessionProvider = AsyncNotifierProvider<SessionController, User?>(
  SessionController.new,
);

/// true si hay sesión (también si no se pudo confirmar por falta de conexión).
bool isSignedIn(AsyncValue<User?> session) =>
    session.value != null || session.hasError;

final isSignedInProvider = Provider<bool>(
  (ref) => isSignedIn(ref.watch(sessionProvider)),
);

// ---------- Datos públicos ----------

final ratesProvider = FutureProvider<Rates>((ref) async {
  try {
    return await ref.watch(apiProvider).rates();
  } on ApiException catch (e) {
    // Sin tasa se muestran solo los precios en dólares.
    if (e.isNetwork) rethrow;
    return const Rates();
  }
});

/// Tasa Bs/USD vigente o null si aún no hay.
final usdVesProvider = Provider<String?>(
  (ref) => ref.watch(ratesProvider).value?.usdVes,
);

final categoriesProvider = FutureProvider<List<Category>>(
  (ref) => ref.watch(apiProvider).categories(),
);

final productProvider = FutureProvider.autoDispose
    .family<ProductDetail, String>(
      (ref, slug) => ref.watch(apiProvider).product(slug),
    );

final animalProvider = FutureProvider.autoDispose.family<Animal, String>(
  (ref, slug) => ref.watch(apiProvider).animal(slug),
);

// ---------- Listas paginadas ----------

class PagedState<T> {
  const PagedState({
    this.items = const [],
    this.total = 0,
    this.page = 0,
    this.loading = true,
    this.error,
  });

  final List<T> items;
  final int total;
  final int page;
  final bool loading;
  final ApiException? error;

  bool get hasMore => page == 0 || items.length < total;
  bool get isEmpty => !loading && error == null && items.isEmpty;

  PagedState<T> copyWith({
    List<T>? items,
    int? total,
    int? page,
    bool? loading,
    ApiException? Function()? error,
  }) => PagedState(
    items: items ?? this.items,
    total: total ?? this.total,
    page: page ?? this.page,
    loading: loading ?? this.loading,
    error: error != null ? error() : this.error,
  );
}

/// Carga páginas una tras otra (scroll infinito). Una petición a la vez.
abstract class PagedNotifier<T> extends Notifier<PagedState<T>> {
  Future<Page<T>> fetch(int page);

  bool _busy = false;
  int _generation = 0;

  @override
  PagedState<T> build() {
    _busy = false;
    _generation++;
    // La primera página se pide después de devolver el estado inicial.
    Future.microtask(loadMore);
    return PagedState<T>();
  }

  Future<void> loadMore() async {
    if (_busy || (state.page > 0 && !state.hasMore)) return;
    _busy = true;
    final generation = _generation;
    state = state.copyWith(loading: true, error: () => null);
    try {
      final next = await fetch(state.page + 1);
      if (!ref.mounted || generation != _generation) return;
      state = state.copyWith(
        items: [...state.items, ...next.items],
        total: next.total,
        page: next.page,
        loading: false,
      );
    } on ApiException catch (e) {
      if (!ref.mounted || generation != _generation) return;
      state = state.copyWith(loading: false, error: () => e);
    } finally {
      if (generation == _generation) _busy = false;
    }
  }

  /// Vuelve a la primera página (tirar para actualizar).
  Future<void> refresh() async {
    _generation++;
    _busy = false;
    state = PagedState<T>();
    await loadMore();
  }
}

class ProductsNotifier extends PagedNotifier<ProductCard> {
  ProductsNotifier(this.query);
  final ProductQuery query;

  @override
  Future<Page<ProductCard>> fetch(int page) =>
      ref.read(apiProvider).products(query, page: page);
}

final productsProvider = NotifierProvider.autoDispose
    .family<ProductsNotifier, PagedState<ProductCard>, ProductQuery>(
      ProductsNotifier.new,
    );

class AnimalsNotifier extends PagedNotifier<Animal> {
  AnimalsNotifier(this.query);
  final AnimalQuery query;

  @override
  Future<Page<Animal>> fetch(int page) =>
      ref.read(apiProvider).animals(query, page: page);
}

final animalsProvider = NotifierProvider.autoDispose
    .family<AnimalsNotifier, PagedState<Animal>, AnimalQuery>(
      AnimalsNotifier.new,
    );

class OrdersNotifier extends PagedNotifier<OrderSummary> {
  @override
  PagedState<OrderSummary> build() {
    ref.watch(sessionProvider.select((s) => s.value?.id));
    return super.build();
  }

  @override
  Future<Page<OrderSummary>> fetch(int page) =>
      ref.read(apiProvider).orders(page: page);
}

final ordersProvider =
    NotifierProvider.autoDispose<OrdersNotifier, PagedState<OrderSummary>>(
      OrdersNotifier.new,
    );

// ---------- Compra (con sesión) ----------

/// Carrito de la persona con sesión; vacío si no ha entrado.
class CartController extends AsyncNotifier<Cart> {
  @override
  Future<Cart> build() async {
    final userId = ref.watch(sessionProvider.select((s) => s.value?.id));
    if (userId == null) return Cart.empty;
    return ref.read(apiProvider).cart();
  }

  PetbfApi get _api => ref.read(apiProvider);

  /// Si la API rechaza el cambio (sin stock, agotado...), se recarga el
  /// carrito para mostrar lo real y se relanza el error para avisar.
  Future<void> _apply(Future<Cart> Function() change) async {
    try {
      state = AsyncData(await change());
    } on ApiException catch (e) {
      if (e.status == 409 || e.status == 404 || e.status == 400) {
        unawaited(_reload());
      }
      rethrow;
    }
  }

  Future<void> _reload() async {
    try {
      state = AsyncData(await _api.cart());
    } on ApiException {
      // Se queda el último carrito conocido.
    }
  }

  Future<void> add(String variantId, int quantity) =>
      _apply(() => _api.addToCart(variantId, quantity));

  Future<void> setQuantity(String variantId, int quantity) =>
      _apply(() => _api.setQuantity(variantId, quantity));

  Future<void> remove(String variantId) =>
      _apply(() => _api.removeFromCart(variantId));

  Future<void> clear() => _apply(_api.clearCart);

  /// Tras un pedido la API vacía el carrito.
  void markEmpty() => state = const AsyncData(Cart.empty);
}

final cartProvider = AsyncNotifierProvider<CartController, Cart>(
  CartController.new,
);

final cartCountProvider = Provider<int>(
  (ref) => ref.watch(cartProvider).value?.itemCount ?? 0,
);

class AddressesController extends AsyncNotifier<List<Address>> {
  @override
  Future<List<Address>> build() async {
    final userId = ref.watch(sessionProvider.select((s) => s.value?.id));
    if (userId == null) return const [];
    return ref.read(apiProvider).addresses();
  }

  PetbfApi get _api => ref.read(apiProvider);

  Future<Address> create(AddressInput input) async {
    final address = await _api.createAddress(input);
    state = AsyncData(await _api.addresses());
    return address;
  }

  Future<void> edit(String id, AddressInput input) async {
    await _api.updateAddress(id, input);
    state = AsyncData(await _api.addresses());
  }

  Future<void> remove(String id) async {
    await _api.deleteAddress(id);
    state = AsyncData(await _api.addresses());
  }
}

final addressesProvider =
    AsyncNotifierProvider<AddressesController, List<Address>>(
      AddressesController.new,
    );

final shippingZonesProvider = FutureProvider.autoDispose<List<ShippingZone>>(
  (ref) => ref.watch(apiProvider).shippingZones(),
);

final paymentMethodsProvider = FutureProvider.autoDispose<List<PaymentMethod>>(
  (ref) => ref.watch(apiProvider).paymentMethods(),
);

final orderProvider = FutureProvider.autoDispose.family<Order, String>(
  (ref, id) => ref.watch(apiProvider).order(id),
);
