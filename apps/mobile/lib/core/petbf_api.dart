import 'dart:typed_data';

import '../models/catalog.dart';
import '../models/json.dart';
import '../models/reviews.dart';
import '../models/shop.dart';
import 'api_client.dart';
import 'proof.dart';
import 'validators.dart';

/// Filtros del catálogo (GET /products).
class ProductQuery {
  const ProductQuery({
    this.search = '',
    this.category,
    this.species,
    this.onSale = false,
    this.sort = ProductSort.newest,
  });

  final String search;
  final String? category;
  final Species? species;
  final bool onSale;
  final ProductSort sort;

  ProductQuery copyWith({
    String? search,
    String? Function()? category,
    Species? Function()? species,
    bool? onSale,
    ProductSort? sort,
  }) => ProductQuery(
    search: search ?? this.search,
    category: category != null ? category() : this.category,
    species: species != null ? species() : this.species,
    onSale: onSale ?? this.onSale,
    sort: sort ?? this.sort,
  );

  bool get hasFilters => category != null || species != null || onSale;

  Map<String, String?> toQuery(int page, int pageSize) => {
    'q': searchQuery(search),
    'category': category,
    'species': species?.api,
    'onSale': onSale ? 'true' : null,
    'sort': sort == ProductSort.name ? 'name' : null,
    'page': '$page',
    'pageSize': '$pageSize',
  };

  @override
  bool operator ==(Object other) =>
      other is ProductQuery &&
      searchQuery(other.search) == searchQuery(search) &&
      other.category == category &&
      other.species == species &&
      other.onSale == onSale &&
      other.sort == sort;

  @override
  int get hashCode =>
      Object.hash(searchQuery(search), category, species, onSale, sort);
}

enum ProductSort { newest, name }

/// Filtros de animales (GET /animals).
class AnimalQuery {
  const AnimalQuery({this.listingType, this.species});
  final ListingType? listingType;
  final Species? species;

  @override
  bool operator ==(Object other) =>
      other is AnimalQuery &&
      other.listingType == listingType &&
      other.species == species;

  @override
  int get hashCode => Object.hash(listingType, species);
}

/// Las rutas de la API que usa la app del cliente, con sus tipos.
class PetbfApi {
  PetbfApi(this.client);
  final ApiClient client;

  static const pageSize = 24;

  // ---------- Cuenta ----------

  Future<User> register({
    required String email,
    required String password,
    required String firstName,
    required String lastName,
    String? phone,
  }) async {
    final json = asJson(
      await client.post(
        '/auth/register',
        auth: false,
        body: {
          'email': normalizeEmail(email),
          'password': password,
          'firstName': firstName.trim(),
          'lastName': lastName.trim(),
          if (phone != null && phone.trim().isNotEmpty) 'phone': phone.trim(),
        },
      ),
    );
    await client.saveTokens(json);
    return User.fromJson(json.obj('user'));
  }

  Future<User> login({required String email, required String password}) async {
    final json = asJson(
      await client.post(
        '/auth/login',
        auth: false,
        body: {'email': normalizeEmail(email), 'password': password},
      ),
    );
    await client.saveTokens(json);
    return User.fromJson(json.obj('user'));
  }

  Future<User> me() async =>
      User.fromJson(asJson(await client.get('/auth/me', auth: true)));

  Future<void> logout() => client.logout();

  // ---------- Catálogo ----------

  Future<List<Category>> categories() async =>
      asList(await client.get('/categories'), Category.fromJson);

  Future<Page<ProductCard>> products(
    ProductQuery query, {
    int page = 1,
  }) async => Page.fromJson(
    asJson(await client.get('/products', query: query.toQuery(page, pageSize))),
    ProductCard.fromJson,
  );

  Future<ProductDetail> product(String slug) async => ProductDetail.fromJson(
    asJson(await client.get('/products/${Uri.encodeComponent(slug)}')),
  );

  Future<Page<Animal>> animals(AnimalQuery query, {int page = 1}) async =>
      Page.fromJson(
        asJson(
          await client.get(
            '/animals',
            query: {
              'listingType': switch (query.listingType) {
                ListingType.sale => 'SALE',
                ListingType.adoption => 'ADOPTION',
                null => null,
              },
              'species': query.species?.api,
              'page': '$page',
              'pageSize': '$pageSize',
            },
          ),
        ),
        Animal.fromJson,
      );

  Future<Animal> animal(String slug) async => Animal.fromJson(
    asJson(await client.get('/animals/${Uri.encodeComponent(slug)}')),
  );

  // ---------- Reseñas y recomendaciones ----------

  Future<ReviewPage> reviews(
    String slug, {
    ReviewSort sort = ReviewSort.recent,
    int page = 1,
  }) async => ReviewPage.fromJson(
    asJson(
      await client.get(
        '/products/${Uri.encodeComponent(slug)}/reviews',
        query: {'sort': sort.name, 'page': '$page', 'pageSize': '10'},
      ),
    ),
  );

  Future<MyReview> myReview(String slug) async => MyReview.fromJson(
    asJson(
      await client.get(
        '/products/${Uri.encodeComponent(slug)}/reviews/mine',
        auth: true,
      ),
    ),
  );

  /// Crea o edita la reseña propia; responde como [myReview].
  Future<MyReview> saveReview(String slug, ReviewInput input) async =>
      MyReview.fromJson(
        asJson(
          await client.put(
            '/products/${Uri.encodeComponent(slug)}/reviews/mine',
            body: input.toJson(),
          ),
        ),
      );

  Future<void> deleteReview(String slug) =>
      client.delete('/products/${Uri.encodeComponent(slug)}/reviews/mine');

  /// Hasta 4 productos para "También te puede gustar".
  Future<List<ProductCard>> recommendations(String slug) async => asList(
    await client.get('/products/${Uri.encodeComponent(slug)}/recommendations'),
    ProductCard.fromJson,
  );

  /// Especies de animales vivos que la tienda acepta.
  Future<List<Species>> animalSpecies() async => asList(
    await client.get('/animal-species'),
    (json) => speciesFromApi(json.str('species')),
  );

  Future<Rates> rates() async =>
      Rates.fromJson(asJson(await client.get('/exchange-rates/current')));

  // ---------- Carrito ----------

  /// Con [coupon], la API prueba el cupón: 400 con el motivo si no aplica.
  Future<Cart> cart({String? coupon}) async => Cart.fromJson(
    asJson(await client.get('/cart', auth: true, query: {'coupon': coupon})),
  );

  /// Añade todas las unidades del combo, o ninguna si alguna no alcanza.
  Future<Cart> addCombo(String slug, int quantity) async => Cart.fromJson(
    asJson(
      await client.post(
        '/cart/combos/${Uri.encodeComponent(slug)}',
        body: {'quantity': quantity},
      ),
    ),
  );

  Future<List<Combo>> combos() async =>
      asList(await client.get('/combos'), Combo.fromJson);

  Future<Cart> addToCart(String variantId, int quantity) async => Cart.fromJson(
    asJson(
      await client.post(
        '/cart/items',
        body: {'variantId': variantId, 'quantity': quantity},
      ),
    ),
  );

  Future<Cart> setQuantity(String variantId, int quantity) async =>
      Cart.fromJson(
        asJson(
          await client.put(
            '/cart/items/${Uri.encodeComponent(variantId)}',
            body: {'quantity': quantity},
          ),
        ),
      );

  Future<Cart> removeFromCart(String variantId) async => Cart.fromJson(
    asJson(
      await client.delete('/cart/items/${Uri.encodeComponent(variantId)}'),
    ),
  );

  Future<Cart> clearCart() async =>
      Cart.fromJson(asJson(await client.delete('/cart')));

  // ---------- Direcciones ----------

  Future<List<Address>> addresses() async =>
      asList(await client.get('/addresses', auth: true), Address.fromJson);

  Future<Address> createAddress(AddressInput input) async => Address.fromJson(
    asJson(await client.post('/addresses', body: input.toJson())),
  );

  Future<Address> updateAddress(String id, AddressInput input) async =>
      Address.fromJson(
        asJson(
          await client.patch(
            '/addresses/${Uri.encodeComponent(id)}',
            body: input.toJson(),
          ),
        ),
      );

  Future<void> deleteAddress(String id) =>
      client.delete('/addresses/${Uri.encodeComponent(id)}');

  // ---------- Checkout y pedidos ----------

  Future<List<ShippingZone>> shippingZones() async =>
      asList(await client.get('/shipping-zones'), ShippingZone.fromJson);

  Future<List<PaymentMethod>> paymentMethods() async =>
      asList(await client.get('/payment-methods'), PaymentMethod.fromJson);

  Future<Order> checkout({
    required String addressId,
    required String shippingZoneId,
    required String paymentMethodId,
    String? couponCode,
  }) async => Order.fromJson(
    asJson(
      await client.post(
        '/orders',
        body: {
          'addressId': addressId,
          'shippingZoneId': shippingZoneId,
          'paymentMethodId': paymentMethodId,
          'acceptTerms': true,
          'couponCode': ?couponCode,
        },
      ),
    ),
  );

  Future<Page<OrderSummary>> orders({int page = 1}) async => Page.fromJson(
    asJson(
      await client.get(
        '/orders',
        auth: true,
        query: {'page': '$page', 'pageSize': '20'},
      ),
    ),
    OrderSummary.fromJson,
  );

  Future<Order> order(String id) async => Order.fromJson(
    asJson(await client.get('/orders/${Uri.encodeComponent(id)}', auth: true)),
  );

  Future<Order> cancelOrder(String id) async => Order.fromJson(
    asJson(await client.post('/orders/${Uri.encodeComponent(id)}/cancel')),
  );

  Future<Order> reportPayment(String orderId, PaymentInput input) async =>
      Order.fromJson(
        asJson(
          await client.post(
            '/orders/${Uri.encodeComponent(orderId)}/payments',
            body: input.toJson(),
          ),
        ),
      );

  /// Adjunta o reemplaza el comprobante de un pago todavía en revisión.
  /// La API responde solo con los datos del comprobante guardado.
  Future<ProofInfo> attachProof(
    String orderId,
    String paymentId,
    PickedProof proof,
  ) async => ProofInfo.fromJson(
    asJson(
      await client.upload(
        'PUT',
        '/orders/${Uri.encodeComponent(orderId)}/payments/'
            '${Uri.encodeComponent(paymentId)}/proof',
        UploadFile(
          field: 'file',
          bytes: proof.bytes,
          filename: proof.name,
          contentType: proof.contentType,
        ),
      ),
    ),
  );

  /// El archivo del comprobante (solo lo ve el dueño del pedido y el equipo).
  Future<Uint8List> proofFile(String orderId, String paymentId) =>
      client.getBytes(
        '/orders/${Uri.encodeComponent(orderId)}/payments/'
        '${Uri.encodeComponent(paymentId)}/proof',
      );

  /// Pide la devolución de productos de un pedido entregado.
  Future<Order> requestReturn(
    String orderId, {
    required String reason,
    required List<ReturnLine> items,
  }) async => Order.fromJson(
    asJson(
      await client.post(
        '/orders/${Uri.encodeComponent(orderId)}/returns',
        body: {
          'reason': reason.trim(),
          'items': [for (final i in items) i.toJson()],
        },
      ),
    ),
  );
}
