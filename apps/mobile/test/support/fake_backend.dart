import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

typedef Json = Map<String, Object?>;

/// API falsa en memoria que imita las respuestas de la API real de Petbf
/// (mismas rutas, formas JSON, códigos y mensajes). Permite probar la app
/// completa (cliente HTTP, sesión, providers y pantallas) sin servidor.
class FakeBackend {
  FakeBackend() {
    client = MockClient(_handle);
  }

  late final http.Client client;
  final List<http.Request> requests = [];

  /// Respuestas forzadas: clave "MÉTODO /ruta" (sin /v1 ni query).
  final Map<String, http.Response Function(http.Request)> overrides = {};

  /// Si es true, toda petición falla como sin conexión.
  bool offline = false;

  // ---------- Datos ----------

  final users = <String, Json>{
    'ana@petbf.com': {
      'password': 'secreta123',
      'user': {
        'id': 'u-ana',
        'email': 'ana@petbf.com',
        'firstName': 'Ana',
        'lastName': 'Pérez',
        'phone': '0412-1234567',
        'createdAt': '2026-11-01T12:00:00.000Z',
        'roles': ['CUSTOMER'],
      },
    },
  };

  /// accessToken -> email
  final accessTokens = <String, String>{};

  /// refreshToken -> email (los usados se borran: rotación)
  final refreshTokens = <String, String>{};
  int _tokenCounter = 0;
  int refreshCalls = 0;
  int accessTtl = 900;

  FakeRates rates = const FakeRates(usdVes: '36.5', eurVes: '39.8');

  final categories = <Json>[
    {'id': 'c-perros', 'name': 'Perros', 'slug': 'perros', 'parentId': null},
    {
      'id': 'c-alimento',
      'name': 'Alimento para perro',
      'slug': 'perros-alimento',
      'parentId': 'c-perros',
    },
    {'id': 'c-gatos', 'name': 'Gatos', 'slug': 'gatos', 'parentId': null},
  ];

  final products = <Json>[
    product(
      id: 'p-1',
      name: 'Alimento seco adulto',
      slug: 'alimento-seco-adulto',
      category: 'perros-alimento',
      species: ['DOG'],
      returnable: false,
      variants: [
        variant('v-1kg', 'ALI-1KG', '1 kg', 1090, stock: 10),
        variant('v-3kg', 'ALI-3KG', '3 kg', 2490, compareAt: 2990, stock: 3),
      ],
    ),
    product(
      id: 'p-2',
      name: 'Arena aglomerante',
      slug: 'arena-aglomerante',
      category: 'gatos',
      species: ['CAT'],
      variants: [variant('v-arena', 'ARE-10', '10 kg', 1250, stock: 0)],
    ),
    product(
      id: 'p-3',
      name: 'Mordedor de caucho',
      slug: 'mordedor-de-caucho',
      category: 'perros',
      species: ['DOG'],
      variants: [variant('v-mord', 'MOR-M', 'Talla M', 890, stock: 50)],
    ),
  ];

  /// Combos: id, name, slug, description, priceUsdCents, isActive e items
  /// ({variantId, quantity}).
  final combos = <Json>[];

  /// Cupones: code, description, type (PERCENT|FIXED), value,
  /// minSubtotalUsdCents, maxDiscountUsdCents, startsAt, endsAt,
  /// maxRedemptions, perUserLimit, isActive.
  final coupons = <Json>[];

  static Json combo({
    required String slug,
    required String name,
    required int price,
    required Map<String, int> items,
    String description = 'Para empezar bien.',
    bool active = true,
  }) => {
    'id': 'cb-$slug',
    'name': name,
    'slug': slug,
    'description': description,
    'priceUsdCents': price,
    'isActive': active,
    'items': [
      for (final e in items.entries) {'variantId': e.key, 'quantity': e.value},
    ],
  };

  static Json coupon(
    String code, {
    String description = 'Descuento de prueba',
    String type = 'PERCENT',
    int value = 10,
    int minSubtotalUsdCents = 0,
    int? maxDiscountUsdCents,
    DateTime? startsAt,
    DateTime? endsAt,
    int? maxRedemptions,
    int perUserLimit = 1,
    bool active = true,
  }) => {
    'code': code,
    'description': description,
    'type': type,
    'value': value,
    'minSubtotalUsdCents': minSubtotalUsdCents,
    'maxDiscountUsdCents': maxDiscountUsdCents,
    'startsAt': startsAt,
    'endsAt': endsAt,
    'maxRedemptions': maxRedemptions,
    'perUserLimit': perUserLimit,
    'isActive': active,
  };

  /// Reseñas: id, productId, email, rating, title, body, status,
  /// hiddenReason, createdAt.
  final reviews = <Json>[];
  int _reviewCounter = 0;

  /// productId -> slugs recomendados (si falta, los de la misma especie).
  final recommendations = <String, List<String>>{};

  /// Añade una reseña ya publicada (de otra persona si no se da email).
  Json seedReview(
    String slug, {
    required int rating,
    String body = 'Muy buen producto para mi mascota.',
    String? title,
    String email = 'otra@petbf.com',
    String author = 'Otra P.',
    DateTime? createdAt,
    String status = 'VISIBLE',
    String? hiddenReason,
  }) {
    final product = products.firstWhere((p) => p['slug'] == slug);
    _reviewCounter++;
    final review = <String, Object?>{
      'id': 'r-$_reviewCounter',
      'productId': product['id'],
      'email': email,
      'author': author,
      'rating': rating,
      'title': title,
      'body': body,
      'status': status,
      'hiddenReason': hiddenReason,
      'createdAt': (createdAt ?? now).toIso8601String(),
      'updatedAt': (createdAt ?? now).toIso8601String(),
    };
    reviews.add(review);
    return review;
  }

  /// Especies que la tienda acepta (GET /animal-species).
  List<String> liveSpecies = ['DOG', 'CAT', 'BIRD', 'RODENT', 'FISH'];

  final animals = <Json>[
    animal(
      slug: 'luna',
      name: 'Luna',
      type: 'ADOPTION',
      species: 'CAT',
      sex: 'FEMALE',
      birthDate: '2025-08-01',
    ),
    animal(
      slug: 'max',
      name: 'Max',
      type: 'SALE',
      species: 'DOG',
      price: 15000,
      status: 'RESERVED',
    ),
  ];

  final zones = <Json>[
    {
      'id': 'z-caracas',
      'name': 'Delivery Caracas',
      'states': ['Distrito Capital', 'Miranda'],
      'carrier': 'Delivery propio',
      'priceUsdCents': 300,
      'freeOverUsdCents': 2500,
    },
    {
      'id': 'z-nacional',
      'name': 'Encomienda nacional',
      'states': ['Zulia', 'Lara', 'Carabobo'],
      'carrier': 'MRW',
      'priceUsdCents': 600,
      'freeOverUsdCents': 2500,
    },
  ];

  final methods = <Json>[
    {
      'id': 'm-pm',
      'code': 'PAGO_MOVIL',
      'name': 'Pago Móvil',
      'currency': 'VES',
      'instructions': 'Banco 0102, 0412-0000000, J-12345678',
    },
    {
      'id': 'm-zelle',
      'code': 'ZELLE',
      'name': 'Zelle',
      'currency': 'USD',
      'instructions': 'pagos@petbf.com',
    },
    {
      'id': 'm-eur',
      'code': 'TRANSFER_EUR',
      'name': 'Transferencia en euros',
      'currency': 'EUR',
      'instructions': 'IBAN ES00 0000',
    },
  ];

  /// email -> variantId -> cantidad
  final carts = <String, Map<String, int>>{};

  /// email -> direcciones
  final addresses = <String, List<Json>>{};

  final orders = <Json>[];
  int _orderNumber = 0;
  DateTime now = DateTime.utc(2026, 11, 26, 14);

  // ---------- Fábricas ----------

  static Json variant(
    String id,
    String sku,
    String name,
    int price, {
    int? compareAt,
    int stock = 10,
    bool active = true,
  }) => {
    'id': id,
    'sku': sku,
    'name': name,
    'priceUsdCents': price,
    'compareAtUsdCents': compareAt,
    'stock': stock,
    'isActive': active,
  };

  static Json product({
    required String id,
    required String name,
    required String slug,
    required String category,
    required List<String> species,
    required List<Json> variants,
    bool returnable = true,
    bool active = true,
  }) => {
    'id': id,
    'name': name,
    'slug': slug,
    'category': category,
    'species': species,
    'isReturnable': returnable,
    'isActive': active,
    'description': 'Descripción de $name.',
    'variants': variants,
  };

  static Json animal({
    required String slug,
    required String name,
    required String type,
    required String species,
    int? price,
    String status = 'AVAILABLE',
    String sex = 'MALE',
    String? birthDate,
  }) => {
    'id': 'a-$slug',
    'name': name,
    'slug': slug,
    'listingType': type,
    'status': status,
    'species': species,
    'breed': null,
    'sex': sex,
    'birthDate': birthDate == null ? null : '${birthDate}T00:00:00.000Z',
    'description': '$name busca familia.',
    'priceUsdCents': price,
    'isVaccinated': true,
    'isSterilized': false,
    'images': <Json>[],
  };

  // ---------- Ayudas para las pruebas ----------

  Json? variantById(String id) {
    for (final p in products) {
      for (final v in p['variants']! as List<Json>) {
        if (v['id'] == id) return v;
      }
    }
    return null;
  }

  Json? productOfVariant(String id) => products
      .where((p) => (p['variants']! as List<Json>).any((v) => v['id'] == id))
      .firstOrNull;

  /// Inicia sesión directamente y devuelve los tokens para la app.
  Json issueTokensFor(String email) {
    _tokenCounter++;
    final at = 'at-$_tokenCounter';
    final rt = 'rt-$_tokenCounter';
    accessTokens[at] = email;
    refreshTokens[rt] = email;
    return {
      'accessToken': at,
      'accessTokenExpiresIn': accessTtl,
      'refreshToken': rt,
    };
  }

  void addAddress(String email, {String state = 'Distrito Capital'}) {
    final list = addresses.putIfAbsent(email, () => []);
    list.add({
      'id': 'ad-${list.length + 1}',
      'recipientName': 'Ana Pérez',
      'phone': '0412-1234567',
      'state': state,
      'city': 'Caracas',
      'municipality': 'Chacao',
      'line1': 'Av. Principal, edificio 1',
      'referencePoint': null,
      'isDefault': list.isEmpty,
    });
  }

  List<http.Request> called(String method, String path) => requests
      .where((r) => r.method == method && r.url.path == '/v1$path')
      .toList();

  // ---------- Servidor ----------

  Future<http.Response> _handle(http.Request request) async {
    requests.add(request);
    if (offline) throw http.ClientException('Sin conexión', request.url);
    final path = request.url.path.replaceFirst('/v1', '');
    final key = '${request.method} $path';
    final override = overrides[key];
    if (override != null) return override(request);
    try {
      return _route(request, path);
    } on _HttpError catch (e) {
      return _json(e.status, {
        'statusCode': e.status,
        'message': e.message,
        'error': 'Error',
      });
    }
  }

  http.Response _json(int status, Object? body) => http.Response(
    body == null ? '' : jsonEncode(body),
    status,
    headers: {'content-type': 'application/json; charset=utf-8'},
  );

  Json _body(http.Request r) =>
      r.body.isEmpty ? {} : jsonDecode(r.body) as Json;

  String _auth(http.Request r) {
    final header = r.headers['Authorization'] ?? '';
    final token = header.startsWith('Bearer ') ? header.substring(7) : null;
    final email = token == null ? null : accessTokens[token];
    if (email == null) throw const _HttpError(401, 'Unauthorized');
    return email;
  }

  Json _user(String email) => users[email]!['user']! as Json;

  http.Response _route(http.Request r, String path) {
    final m = r.method;
    final segments = path.split('/').where((s) => s.isNotEmpty).toList();

    // Cuenta
    if (m == 'POST' && path == '/auth/login') {
      final body = _body(r);
      final entry = users[body['email']];
      if (entry == null || entry['password'] != body['password']) {
        throw const _HttpError(401, 'Correo o contraseña incorrectos');
      }
      return _json(200, {
        'user': entry['user'],
        ...issueTokensFor(body['email']! as String),
      });
    }
    if (m == 'POST' && path == '/auth/register') {
      final body = _body(r);
      final email = body['email']! as String;
      if (users.containsKey(email)) {
        throw const _HttpError(409, 'Ya existe una cuenta con ese correo');
      }
      final user = {
        'id': 'u-${users.length + 1}',
        'email': email,
        'firstName': body['firstName'],
        'lastName': body['lastName'],
        'phone': body['phone'],
        'createdAt': now.toIso8601String(),
        'roles': ['CUSTOMER'],
      };
      users[email] = {'password': body['password'], 'user': user};
      return _json(201, {'user': user, ...issueTokensFor(email)});
    }
    if (m == 'POST' && path == '/auth/refresh') {
      refreshCalls++;
      final token = _body(r)['refreshToken'];
      final email = refreshTokens.remove(token);
      if (email == null) throw const _HttpError(401, 'Sesión inválida');
      return _json(200, issueTokensFor(email));
    }
    if (m == 'POST' && path == '/auth/logout') {
      refreshTokens.remove(_body(r)['refreshToken']);
      return _json(204, null);
    }
    if (m == 'GET' && path == '/auth/me') return _json(200, _user(_auth(r)));

    // Catálogo
    if (m == 'GET' && path == '/categories') return _json(200, categories);
    if (m == 'GET' && path == '/exchange-rates/current') {
      return _json(200, {
        'source': 'BCV',
        'usdVes': rates.usdVes == null
            ? null
            : {'rate': rates.usdVes, 'effectiveAt': '2026-11-26T04:00:00.000Z'},
        'eurVes': rates.eurVes == null
            ? null
            : {'rate': rates.eurVes, 'effectiveAt': '2026-11-26T04:00:00.000Z'},
      });
    }
    if (m == 'GET' && path == '/products') return _listProducts(r.url);
    if (segments.length >= 3 && segments[0] == 'products') {
      final p = products.where((p) => p['slug'] == segments[1]).firstOrNull;
      if (p == null || p['isActive'] != true) {
        throw const _HttpError(404, 'Producto no encontrado');
      }
      if (m == 'GET' && segments.length == 3 && segments[2] == 'reviews') {
        return _listReviews(p, r.url.queryParameters);
      }
      if (m == 'GET' &&
          segments.length == 3 &&
          segments[2] == 'recommendations') {
        return _json(200, _recommend(p));
      }
      if (segments.length == 4 &&
          segments[2] == 'reviews' &&
          segments[3] == 'mine') {
        final email = _auth(r);
        if (m == 'GET') return _json(200, _mine(p, email));
        if (m == 'PUT') return _upsertReview(p, email, _body(r));
        if (m == 'DELETE') {
          final before = reviews.length;
          reviews.removeWhere(
            (x) => x['productId'] == p['id'] && x['email'] == email,
          );
          if (reviews.length == before) {
            throw const _HttpError(
              404,
              'No tienes una reseña de este producto',
            );
          }
          return _json(204, null);
        }
      }
    }
    if (m == 'GET' && segments.length == 2 && segments[0] == 'products') {
      final p = products.where((p) => p['slug'] == segments[1]).firstOrNull;
      if (p == null || p['isActive'] != true) {
        throw const _HttpError(404, 'Producto no encontrado');
      }
      return _json(200, _detail(p));
    }
    if (m == 'GET' && path == '/animals') {
      final q = r.url.queryParameters;
      final list = animals
          .where(
            (a) =>
                q['listingType'] == null ||
                a['listingType'] == q['listingType'],
          )
          .where((a) => q['species'] == null || a['species'] == q['species'])
          .toList();
      return _paged(list, q);
    }
    if (m == 'GET' && segments.length == 2 && segments[0] == 'animals') {
      final a = animals.where((a) => a['slug'] == segments[1]).firstOrNull;
      if (a == null) throw const _HttpError(404, 'Animal no encontrado');
      return _json(200, a);
    }
    if (m == 'GET' && path == '/animal-species') {
      return _json(200, [
        for (final s in liveSpecies)
          {'species': s, 'allowed': 'any', 'note': ''},
      ]);
    }
    if (m == 'GET' && path == '/combos') {
      return _json(200, [
        for (final c in combos)
          if (c['isActive'] == true &&
              _comboSellable(c) &&
              _comboSavings(c) > 0)
            _presentCombo(c),
      ]);
    }
    if (m == 'GET' && segments.length == 2 && segments[0] == 'combos') {
      return _json(200, _presentCombo(_comboBySlug(segments[1])));
    }
    if (m == 'GET' && path == '/shipping-zones') return _json(200, zones);
    if (m == 'GET' && path == '/payment-methods') return _json(200, methods);

    // Carrito
    if (segments.isNotEmpty && segments[0] == 'cart') {
      final email = _auth(r);
      final cart = carts.putIfAbsent(email, () => {});
      if (m == 'GET' && segments.length == 1) {
        return _json(
          200,
          _cart(email, coupon: r.url.queryParameters['coupon']),
        );
      }
      if (m == 'POST' && segments.length == 3 && segments[1] == 'combos') {
        return _json(201, _addCombo(email, segments[2], _body(r)));
      }
      if (m == 'DELETE' && segments.length == 1) {
        cart.clear();
        return _json(200, _cart(email));
      }
      if (m == 'POST' && path == '/cart/items') {
        final body = _body(r);
        final id = body['variantId']! as String;
        final qty = (cart[id] ?? 0) + ((body['quantity'] as int?) ?? 1);
        if (qty > 20) {
          throw const _HttpError(
            400,
            'Puedes llevar hasta 20 unidades de cada presentación',
          );
        }
        _setLine(email, id, qty);
        return _json(201, _cart(email));
      }
      if (m == 'PUT' && segments.length == 3) {
        _setLine(email, segments[2], _body(r)['quantity']! as int);
        return _json(200, _cart(email));
      }
      if (m == 'DELETE' && segments.length == 3) {
        cart.remove(segments[2]);
        return _json(200, _cart(email));
      }
    }

    // Direcciones
    if (segments.isNotEmpty && segments[0] == 'addresses') {
      final email = _auth(r);
      final list = addresses.putIfAbsent(email, () => []);
      if (m == 'GET') return _json(200, list);
      if (m == 'POST') {
        if (list.length >= 10) {
          throw const _HttpError(400, 'Puedes guardar hasta 10 direcciones');
        }
        final body = _body(r);
        final isDefault = body['isDefault'] == true || list.isEmpty;
        if (isDefault) {
          for (final a in list) {
            a['isDefault'] = false;
          }
        }
        final address = {
          'id': 'ad-${list.length + 1}-${requests.length}',
          ...body,
          'municipality': _nullIfEmpty(body['municipality']),
          'referencePoint': _nullIfEmpty(body['referencePoint']),
          'isDefault': isDefault,
        };
        list.add(address);
        return _json(201, address);
      }
      final address = list.where((a) => a['id'] == segments[1]).firstOrNull;
      if (address == null) {
        throw const _HttpError(404, 'Dirección no encontrada');
      }
      if (m == 'PATCH') {
        final body = _body(r);
        if (body['isDefault'] == true) {
          for (final a in list) {
            a['isDefault'] = false;
          }
        } else {
          body.remove('isDefault');
        }
        address.addAll({
          ...body,
          if (body.containsKey('municipality'))
            'municipality': _nullIfEmpty(body['municipality']),
          if (body.containsKey('referencePoint'))
            'referencePoint': _nullIfEmpty(body['referencePoint']),
        });
        return _json(200, address);
      }
      if (m == 'DELETE') {
        list.remove(address);
        if (address['isDefault'] == true && list.isNotEmpty) {
          list.first['isDefault'] = true;
        }
        return _json(204, null);
      }
    }

    // Pedidos
    if (segments.isNotEmpty && segments[0] == 'orders') {
      final email = _auth(r);
      if (m == 'POST' && segments.length == 1) {
        return _checkout(email, _body(r));
      }
      if (m == 'GET' && segments.length == 1) {
        final mine = orders.reversed
            .where((o) => o['_owner'] == email)
            .map(_summary)
            .toList();
        return _paged(mine, r.url.queryParameters);
      }
      final order = orders
          .where((o) => o['id'] == segments[1] && o['_owner'] == email)
          .firstOrNull;
      if (order == null) throw const _HttpError(404, 'Pedido no encontrado');
      if (m == 'GET' && segments.length == 2) return _json(200, _public(order));
      if (m == 'POST' && segments.length == 3 && segments[2] == 'cancel') {
        if (order['status'] != 'PENDING_PAYMENT') {
          throw const _HttpError(409, 'Este pedido ya no se puede cancelar');
        }
        _transition(order, 'CANCELLED', 'Cancelado por el cliente');
        return _json(201, _public(order));
      }
      if (m == 'POST' && segments.length == 3 && segments[2] == 'payments') {
        return _report(order, _body(r));
      }
      if (m == 'POST' && segments.length == 3 && segments[2] == 'returns') {
        return _requestReturn(order, _body(r));
      }
      if (segments.length == 5 &&
          segments[2] == 'payments' &&
          segments[4] == 'proof') {
        if (m == 'PUT') return _attachProof(order, segments[3], r);
        if (m == 'GET') {
          final bytes = proofs[segments[3]];
          if (bytes == null) {
            throw const _HttpError(404, 'Este pago no tiene comprobante');
          }
          return http.Response.bytes(bytes, 200);
        }
      }
    }

    throw _HttpError(404, 'Cannot ${r.method} $path');
  }

  static Object? _nullIfEmpty(Object? v) => v == '' ? null : v;

  http.Response _paged(List<Json> list, Map<String, String> q) {
    final page = int.parse(q['page'] ?? '1');
    final size = int.parse(q['pageSize'] ?? '24');
    final items = list.skip((page - 1) * size).take(size).toList();
    return _json(200, {
      'items': items,
      'total': list.length,
      'page': page,
      'pageSize': size,
    });
  }

  http.Response _listProducts(Uri url) {
    final q = url.queryParameters;
    final query = q['q'];
    if (query != null && query.trim().length < 2) {
      throw const _HttpError(400, ['q: Too small']);
    }
    Iterable<Json> list = products.where((p) => p['isActive'] == true);
    if (q['category'] != null) {
      final cat = categories
          .where((c) => c['slug'] == q['category'])
          .firstOrNull;
      final slugs = {
        q['category'],
        ...categories
            .where((c) => c['parentId'] == cat?['id'])
            .map((c) => c['slug']),
      };
      list = list.where((p) => slugs.contains(p['category']));
    }
    if (q['species'] != null) {
      list = list.where((p) => (p['species']! as List).contains(q['species']));
    }
    if (query != null) {
      list = list.where(
        (p) =>
            (p['name']! as String).toLowerCase().contains(query.toLowerCase()),
      );
    }
    if (q['onSale'] == 'true') {
      list = list.where(
        (p) => (p['variants']! as List<Json>).any(
          (v) => v['compareAtUsdCents'] != null,
        ),
      );
    }
    final sorted = list.toList();
    if (q['sort'] == 'name') {
      sorted.sort(
        (a, b) => (a['name']! as String).compareTo(b['name']! as String),
      );
    }
    return _paged(sorted.map(_card).toList(), q);
  }

  Json _category(String slug) {
    final c = categories.firstWhere((c) => c['slug'] == slug);
    return {'id': c['id'], 'name': c['name'], 'slug': c['slug']};
  }

  Json _card(Json p) {
    final variants =
        (p['variants']! as List<Json>)
            .where((v) => v['isActive'] == true)
            .toList()
          ..sort(
            (a, b) => (a['priceUsdCents']! as int).compareTo(
              b['priceUsdCents']! as int,
            ),
          );
    final cheapest = variants.firstOrNull;
    return {
      'id': p['id'],
      'name': p['name'],
      'slug': p['slug'],
      'species': p['species'],
      'isActive': p['isActive'],
      'category': _category(p['category']! as String),
      'brand': null,
      'image': null,
      'priceFromUsdCents': cheapest?['priceUsdCents'],
      'compareAtUsdCents': cheapest?['compareAtUsdCents'],
      'inStock': variants.any((v) => (v['stock']! as int) > 0),
      'rating': _rating(p),
    };
  }

  List<Json> _visibleReviews(Json p) => reviews
      .where((r) => r['productId'] == p['id'] && r['status'] == 'VISIBLE')
      .toList();

  Json _distribution(List<Json> list) {
    final distribution = [
      for (var stars = 1; stars <= 5; stars++)
        list.where((r) => r['rating'] == stars).length,
    ];
    final count = list.length;
    final sum = list.fold(0, (a, r) => a + (r['rating']! as int));
    return {
      'count': count,
      'average': count == 0 ? null : (sum / count * 10).round() / 10,
      'distribution': distribution,
    };
  }

  Json _rating(Json p) {
    final d = _distribution(_visibleReviews(p));
    return {'average': d['average'], 'count': d['count']};
  }

  http.Response _listReviews(Json p, Map<String, String> q) {
    final sort = q['sort'] ?? 'recent';
    if (!['recent', 'best', 'worst'].contains(sort)) {
      throw const _HttpError(400, ['sort: Invalid option']);
    }
    final list = _visibleReviews(p);
    int byDate(Json a, Json b) =>
        (b['createdAt']! as String).compareTo(a['createdAt']! as String);
    list.sort((a, b) {
      final byRating = switch (sort) {
        'best' => (b['rating']! as int).compareTo(a['rating']! as int),
        'worst' => (a['rating']! as int).compareTo(b['rating']! as int),
        _ => 0,
      };
      return byRating != 0 ? byRating : byDate(a, b);
    });
    final page = int.parse(q['page'] ?? '1');
    final size = int.parse(q['pageSize'] ?? '24');
    return _json(200, {
      'items': [
        for (final r in list.skip((page - 1) * size).take(size))
          {
            'id': r['id'],
            'rating': r['rating'],
            'title': r['title'],
            'body': r['body'],
            'createdAt': r['createdAt'],
            'updatedAt': r['updatedAt'],
            'author': r['author'],
            'verifiedPurchase': true,
          },
      ],
      'total': list.length,
      'page': page,
      'pageSize': size,
      'summary': _distribution(list),
    });
  }

  bool _bought(Json p, String email) => orders.any(
    (o) =>
        o['_owner'] == email &&
        o['status'] == 'DELIVERED' &&
        (o['items']! as List).any(
          (i) => (i as Json)['productSlug'] == p['slug'],
        ),
  );

  Json _mine(Json p, String email) {
    final own = reviews
        .where((r) => r['productId'] == p['id'] && r['email'] == email)
        .firstOrNull;
    return {
      'canReview': _bought(p, email),
      'review': own == null
          ? null
          : {
              for (final k in [
                'id',
                'rating',
                'title',
                'body',
                'status',
                'hiddenReason',
                'createdAt',
                'updatedAt',
              ])
                k: own[k],
            },
    };
  }

  http.Response _upsertReview(Json p, String email, Json body) {
    final rating = body['rating'];
    final title = (body['title'] as String?)?.trim();
    final text = body['body'];
    if (rating is! int || rating < 1 || rating > 5) {
      throw const _HttpError(400, ['rating: Elige de 1 a 5 estrellas']);
    }
    if (title != null && title.length > 80) {
      throw const _HttpError(400, [
        'title: El título admite hasta 80 caracteres',
      ]);
    }
    if (text is! String) {
      throw const _HttpError(400, ['body: Cuéntanos tu experiencia']);
    }
    if (text.trim().length < 10) {
      throw const _HttpError(400, [
        'body: Cuéntanos un poco más (mínimo 10 caracteres)',
      ]);
    }
    if (text.trim().length > 1000) {
      throw const _HttpError(400, [
        'body: La reseña admite hasta 1000 caracteres',
      ]);
    }
    if (!_bought(p, email)) {
      throw const _HttpError(
        403,
        'Solo puedes reseñar productos que compraste y ya recibiste',
      );
    }
    final values = {
      'rating': rating,
      'title': (title == null || title.isEmpty) ? null : title,
      'body': text.trim(),
      'updatedAt': now.toIso8601String(),
    };
    final own = reviews
        .where((r) => r['productId'] == p['id'] && r['email'] == email)
        .firstOrNull;
    if (own != null) {
      own.addAll(values);
    } else {
      final user = _user(email);
      seedReview(
        p['slug']! as String,
        rating: rating,
        body: text.trim(),
        email: email,
        author: '${user['firstName']} ${(user['lastName']! as String)[0]}.',
      ).addAll(values);
    }
    return _json(200, _mine(p, email));
  }

  List<Json> _recommend(Json p) {
    final explicit = recommendations[p['id']];
    final list = explicit != null
        ? [
            for (final slug in explicit)
              products.firstWhere((x) => x['slug'] == slug),
          ]
        : products.where(
            (x) =>
                x['id'] != p['id'] &&
                x['isActive'] == true &&
                (x['species']! as List).any(
                  (s) => (p['species']! as List).contains(s),
                ),
          );
    return list.take(4).map(_card).toList();
  }

  Json _detail(Json p) => {
    'id': p['id'],
    'name': p['name'],
    'slug': p['slug'],
    'description': p['description'],
    'species': p['species'],
    'isReturnable': p['isReturnable'],
    'isActive': p['isActive'],
    'category': _category(p['category']! as String),
    'brand': null,
    'images': <Json>[],
    'rating': _rating(p),
    'variants': [
      for (final v in p['variants']! as List<Json>)
        if (v['isActive'] == true)
          {
            'id': v['id'],
            'sku': v['sku'],
            'name': v['name'],
            'priceUsdCents': v['priceUsdCents'],
            'compareAtUsdCents': v['compareAtUsdCents'],
            'isActive': true,
            'inStock': (v['stock']! as int) > 0,
          },
    ],
  };

  void _setLine(String email, String variantId, int quantity) {
    final v = variantById(variantId);
    final p = productOfVariant(variantId);
    if (v == null || v['isActive'] != true || p?['isActive'] != true) {
      throw const _HttpError(404, 'Producto no encontrado');
    }
    final stock = v['stock']! as int;
    if (stock == 0) throw const _HttpError(409, 'Producto agotado');
    if (stock < quantity) {
      throw _HttpError(409, 'Solo hay $stock disponibles de esta presentación');
    }
    carts.putIfAbsent(email, () => {})[variantId] = quantity;
  }

  Json _cart(String email, {String? coupon}) {
    final items = <Json>[];
    for (final MapEntry(key: id, value: qty) in (carts[email] ?? {}).entries) {
      final v = variantById(id)!;
      final p = productOfVariant(id)!;
      final stock = v['stock']! as int;
      final issue = v['isActive'] != true || p['isActive'] != true || stock == 0
          ? 'unavailable'
          : stock < qty
          ? 'insufficient_stock'
          : null;
      items.add({
        'variantId': id,
        'sku': v['sku'],
        'name': v['name'],
        'product': {'name': p['name'], 'slug': p['slug'], 'image': null},
        'unitPriceUsdCents': v['priceUsdCents'],
        'quantity': qty,
        'lineTotalUsdCents': (v['priceUsdCents']! as int) * qty,
        'issue': issue,
        'available': issue == 'unavailable' ? 0 : (stock < 20 ? stock : 20),
      });
    }
    final valid = items.where((i) => i['issue'] == null).toList();
    final subtotal = valid.fold<int>(
      0,
      (n, i) => n + (i['lineTotalUsdCents']! as int),
    );
    final applied = _comboDiscounts({
      for (final i in valid) i['variantId']! as String: i['quantity']! as int,
    });
    final comboDiscount = applied.fold<int>(
      0,
      (n, c) => n + (c['savingsUsdCents']! as int),
    );
    final base = subtotal - comboDiscount;
    final applying = coupon == null || coupon.isEmpty
        ? null
        : _usableCoupon(coupon, email, base);
    final couponAmount = applying == null ? 0 : _couponDiscount(base, applying);
    return {
      'items': items,
      'itemCount': items.fold<int>(0, (n, i) => n + (i['quantity']! as int)),
      'subtotalUsdCents': subtotal,
      'combos': applied,
      'comboDiscountUsdCents': comboDiscount,
      'coupon': applying == null
          ? null
          : {
              'code': applying['code'],
              'description': applying['description'],
              'discountUsdCents': couponAmount,
            },
      'itemsTotalUsdCents': base - couponAmount,
      'canCheckout': items.isNotEmpty && valid.length == items.length,
    };
  }

  // ---------- Combos y cupones (misma lógica que la API) ----------

  Json _comboBySlug(String slug) {
    final c = combos
        .where((c) => c['slug'] == slug && c['isActive'] == true)
        .firstOrNull;
    if (c == null || !_comboSellable(c) || _comboSavings(c) <= 0) {
      throw const _HttpError(404, 'Combo no encontrado');
    }
    return c;
  }

  List<Json> _comboItems(Json c) => (c['items']! as List).cast<Json>();

  bool _comboSellable(Json c) => _comboItems(c).every((i) {
    final v = variantById(i['variantId']! as String);
    return v != null &&
        v['isActive'] == true &&
        productOfVariant(i['variantId']! as String)!['isActive'] == true;
  });

  int _comboRegular(Json c) => _comboItems(c).fold(
    0,
    (n, i) =>
        n +
        (variantById(i['variantId']! as String)!['priceUsdCents']! as int) *
            (i['quantity']! as int),
  );

  int _comboSavings(Json c) => _comboRegular(c) - (c['priceUsdCents']! as int);

  Json _presentCombo(Json c) => {
    'id': c['id'],
    'name': c['name'],
    'slug': c['slug'],
    'description': c['description'],
    'priceUsdCents': c['priceUsdCents'],
    'regularUsdCents': _comboRegular(c),
    'savingsUsdCents': _comboSavings(c),
    'available': _comboItems(c)
        .map(
          (i) =>
              (variantById(i['variantId']! as String)!['stock']! as int) ~/
              (i['quantity']! as int),
        )
        .reduce((a, b) => a < b ? a : b),
    'items': [
      for (final i in _comboItems(c))
        {
          'quantity': i['quantity'],
          'variantId': i['variantId'],
          'variantName': variantById(i['variantId']! as String)!['name'],
          'sku': variantById(i['variantId']! as String)!['sku'],
          'unitPriceUsdCents': variantById(
            i['variantId']! as String,
          )!['priceUsdCents'],
          'product': {
            'name': productOfVariant(i['variantId']! as String)!['name'],
            'slug': productOfVariant(i['variantId']! as String)!['slug'],
            'image': null,
          },
        },
    ],
  };

  /// Cuántos combos completos hay en el carrito: primero los que más ahorran
  /// y una unidad cuenta para un solo combo.
  List<Json> _comboDiscounts(Map<String, int> cart) {
    final left = {...cart};
    final candidates =
        combos
            .where(
              (c) =>
                  c['isActive'] == true &&
                  _comboSellable(c) &&
                  _comboSavings(c) > 0,
            )
            .toList()
          ..sort((a, b) => _comboSavings(b).compareTo(_comboSavings(a)));
    final applied = <Json>[];
    for (final c in candidates) {
      final count = _comboItems(c)
          .map((i) => (left[i['variantId']] ?? 0) ~/ (i['quantity']! as int))
          .reduce((a, b) => a < b ? a : b);
      if (count <= 0) continue;
      for (final i in _comboItems(c)) {
        left[i['variantId']! as String] =
            left[i['variantId']]! - (i['quantity']! as int) * count;
      }
      applied.add({
        'comboId': c['id'],
        'name': c['name'],
        'count': count,
        'savingsUsdCents': _comboSavings(c) * count,
      });
    }
    return applied;
  }

  Json _addCombo(String email, String slug, Json body) {
    final c = _comboBySlug(slug);
    final times = (body['quantity'] as int?) ?? 1;
    if (times < 1 || times > 5) {
      throw const _HttpError(400, ['quantity: Cantidad inválida']);
    }
    final cart = carts.putIfAbsent(email, () => {});
    final wanted = <String, int>{};
    for (final i in _comboItems(c)) {
      final id = i['variantId']! as String;
      final qty = (cart[id] ?? 0) + (i['quantity']! as int) * times;
      final name = productOfVariant(id)!['name'];
      final v = variantById(id)!;
      if (qty > 20) {
        throw _HttpError(
          400,
          'Puedes llevar hasta 20 unidades de $name (${v['name']})',
        );
      }
      final stock = v['stock']! as int;
      if (qty > stock) {
        throw _HttpError(
          409,
          stock == 0
              ? '$name (${v['name']}) está agotado'
              : 'Solo hay $stock disponibles de $name (${v['name']})',
        );
      }
      wanted[id] = qty;
    }
    // Todo o nada: solo se escribe si cada producto alcanzó.
    cart.addAll(wanted);
    return _cart(email);
  }

  Json _usableCoupon(String code, String email, int base) {
    final upper = code.trim().toUpperCase();
    if (!RegExp(r'^[A-Z0-9][A-Z0-9-]{2,29}$').hasMatch(upper)) {
      throw const _HttpError(400, [
        'coupon: El cupón tiene de 3 a 30 letras, números o guiones',
      ]);
    }
    final c = coupons.where((c) => c['code'] == upper).firstOrNull;
    if (c == null || c['isActive'] != true) {
      throw const _HttpError(400, 'Ese cupón no existe o ya no está activo');
    }
    final startsAt = c['startsAt'] as DateTime?;
    final endsAt = c['endsAt'] as DateTime?;
    if (startsAt != null && startsAt.isAfter(now)) {
      throw const _HttpError(400, 'Ese cupón todavía no está vigente');
    }
    if (endsAt != null && !endsAt.isAfter(now)) {
      throw const _HttpError(400, 'Ese cupón ya venció');
    }
    final min = c['minSubtotalUsdCents']! as int;
    if (base < min) {
      throw _HttpError(
        400,
        'Ese cupón aplica en compras desde \$${(min / 100).toStringAsFixed(2)}',
      );
    }
    final used = orders.where(
      (o) => o['couponCode'] == upper && o['status'] != 'CANCELLED',
    );
    final maxRedemptions = c['maxRedemptions'] as int?;
    if (maxRedemptions != null && used.length >= maxRedemptions) {
      throw const _HttpError(400, 'Ese cupón ya se agotó');
    }
    final perUser = c['perUserLimit']! as int;
    if (used.where((o) => o['_owner'] == email).length >= perUser) {
      throw _HttpError(
        400,
        perUser == 1
            ? 'Ya usaste este cupón'
            : 'Ya usaste este cupón $perUser veces',
      );
    }
    return c;
  }

  int _couponDiscount(int base, Json c) {
    final raw = c['type'] == 'PERCENT'
        ? base * (c['value']! as int) ~/ 100
        : c['value']! as int;
    final cap = c['maxDiscountUsdCents'] as int?;
    final capped = cap == null ? raw : (raw < cap ? raw : cap);
    return capped > base ? base : (capped < 0 ? 0 : capped);
  }

  http.Response _checkout(String email, Json body) {
    if (body['acceptTerms'] != true) {
      throw const _HttpError(400, [
        'acceptTerms: Debes aceptar los términos y condiciones',
      ]);
    }
    final cart = _cart(email, coupon: body['couponCode'] as String?);
    final items = cart['items']! as List<Json>;
    if (items.isEmpty) throw const _HttpError(400, 'El carrito está vacío');
    if (cart['canCheckout'] != true) {
      throw const _HttpError(
        409,
        'Revisa tu carrito: hay productos sin stock suficiente',
      );
    }
    final address = (addresses[email] ?? [])
        .where((a) => a['id'] == body['addressId'])
        .firstOrNull;
    if (address == null) throw const _HttpError(404, 'Dirección no encontrada');
    final zone = zones
        .where((z) => z['id'] == body['shippingZoneId'])
        .firstOrNull;
    if (zone == null) {
      throw const _HttpError(400, 'Zona de envío no disponible');
    }
    if (!(zone['states']! as List).contains(address['state'])) {
      throw _HttpError(
        400,
        'La zona «${zone['name']}» no llega a ${address['state']}',
      );
    }
    final method = methods
        .where((x) => x['id'] == body['paymentMethodId'])
        .firstOrNull;
    if (method == null) {
      throw const _HttpError(400, 'Método de pago no disponible');
    }

    final subtotal = cart['subtotalUsdCents']! as int;
    // El envío gratis se mide con lo que se paga por los productos.
    final itemsTotal = cart['itemsTotalUsdCents']! as int;
    final shipping = itemsTotal >= (zone['freeOverUsdCents']! as int)
        ? 0
        : zone['priceUsdCents']! as int;
    final total = itemsTotal + shipping;
    final couponInfo = cart['coupon'] as Json?;
    final charged = switch (method['currency']) {
      'VES' => (total * double.parse(rates.usdVes!) / 100).toStringAsFixed(2),
      'EUR' =>
        (total *
                double.parse(rates.usdVes!) /
                double.parse(rates.eurVes!) /
                100)
            .toStringAsFixed(2),
      _ => (total / 100).toStringAsFixed(2),
    };
    for (final i in items) {
      final v = variantById(i['variantId']! as String)!;
      v['stock'] = (v['stock']! as int) - (i['quantity']! as int);
    }
    _orderNumber++;
    final order = <String, Object?>{
      '_owner': email,
      'id': 'o-$_orderNumber',
      'number': _orderNumber,
      'code': 'PB-${_orderNumber.toString().padLeft(6, '0')}',
      'status': 'PENDING_PAYMENT',
      'chargedCurrency': method['currency'],
      'usdVesRate': rates.usdVes,
      'eurVesRate': rates.eurVes,
      'rateEffectiveAt': '2026-11-26T04:00:00.000Z',
      'subtotalUsdCents': subtotal,
      'comboDiscountUsdCents': cart['comboDiscountUsdCents'],
      'couponDiscountUsdCents': couponInfo?['discountUsdCents'] ?? 0,
      'couponCode': couponInfo?['code'],
      'shippingUsdCents': shipping,
      'totalUsdCents': total,
      'totalCharged': charged,
      'recipientName': address['recipientName'],
      'phone': address['phone'],
      'state': address['state'],
      'city': address['city'],
      'municipality': address['municipality'],
      'line1': address['line1'],
      'referencePoint': address['referencePoint'],
      'shippingZoneName': zone['name'],
      'carrier': zone['carrier'],
      'trackingCode': null,
      'paymentDueAt': now.add(const Duration(hours: 2)).toIso8601String(),
      'createdAt': now.toIso8601String(),
      'items': [
        for (final i in items)
          {
            'id': 'oi-${i['variantId']}',
            'productName': (i['product']! as Json)['name'],
            'productSlug': (i['product']! as Json)['slug'],
            'variantName': i['name'],
            'sku': i['sku'],
            'unitPriceUsdCents': i['unitPriceUsdCents'],
            'quantity': i['quantity'],
            'isReturnable': productOfVariant(
              i['variantId']! as String,
            )!['isReturnable'],
          },
      ],
      'paymentMethod': {
        'code': method['code'],
        'name': method['name'],
        'currency': method['currency'],
        'instructions': method['instructions'],
      },
      'payments': <Json>[],
      'returns': <Json>[],
      'deliveredAt': null,
      'history': [
        {
          'toStatus': 'PENDING_PAYMENT',
          'note': null,
          'createdAt': now.toIso8601String(),
        },
      ],
    };
    orders.add(order);
    carts[email]!.clear();
    return _json(201, _public(order));
  }

  /// Añade un pedido ya hecho (para probar estados).
  Json seedOrder(
    String email, {
    String status = 'PENDING_PAYMENT',
    DateTime? createdAt,
    Map<String, int> items = const {'v-mord': 2},
    DateTime? deliveredAt,
  }) {
    addAddress(email);
    carts.putIfAbsent(email, () => {}).addAll(items);
    final saved = now;
    if (createdAt != null) now = createdAt;
    _checkout(email, {
      'addressId': addresses[email]!.last['id'],
      'shippingZoneId': 'z-caracas',
      'paymentMethodId': 'm-pm',
      'acceptTerms': true,
    });
    now = saved;
    final order = orders.last;
    if (status != 'PENDING_PAYMENT') _transition(order, status, null);
    if (status == 'DELIVERED') {
      order['deliveredAt'] = (deliveredAt ?? now).toIso8601String();
    }
    return order;
  }

  void _transition(Json order, String status, String? note) {
    order['status'] = status;
    (order['history']! as List).add({
      'toStatus': status,
      'note': note,
      'createdAt': now.toIso8601String(),
    });
  }

  Json _summary(Json o) => {
    'id': o['id'],
    'number': o['number'],
    'code': o['code'],
    'status': o['status'],
    'totalUsdCents': o['totalUsdCents'],
    'totalCharged': o['totalCharged'],
    'chargedCurrency': o['chargedCurrency'],
    'paymentDueAt': o['paymentDueAt'],
    'createdAt': o['createdAt'],
    '_count': {'items': (o['items']! as List).length},
  };

  Json _public(Json o) {
    final delivered = o['deliveredAt'] as String?;
    return {
      for (final e in o.entries)
        if (e.key != '_owner') e.key: e.value,
      'returnUntil': o['status'] == 'DELIVERED' && delivered != null
          ? DateTime.parse(delivered).add(returnWindow).toIso8601String()
          : null,
    };
  }

  static const returnWindow = Duration(days: 3);

  /// Comprobantes guardados: id del pago -> bytes.
  final proofs = <String, Uint8List>{};

  http.Response _requestReturn(Json order, Json body) {
    if (order['status'] != 'DELIVERED' || order['deliveredAt'] == null) {
      throw const _HttpError(
        409,
        'Solo se devuelve un pedido que ya te entregamos',
      );
    }
    final delivered = DateTime.parse(order['deliveredAt']! as String);
    if (now.isAfter(delivered.add(returnWindow))) {
      throw const _HttpError(
        409,
        'Pasaron más de 3 días desde la entrega: ya no admite devolución',
      );
    }
    final reason = (body['reason'] as String? ?? '').trim();
    if (reason.length < 10) {
      throw const _HttpError(400, [
        'reason: Cuéntanos el motivo (mínimo 10 caracteres)',
      ]);
    }
    final lines = (body['items'] as List? ?? []).cast<Json>();
    if (lines.isEmpty) {
      throw const _HttpError(400, ['items: Elige al menos un producto']);
    }
    final returns = order['returns']! as List;
    if (returns.cast<Json>().any(
      (r) => r['status'] == 'REQUESTED' || r['status'] == 'APPROVED',
    )) {
      throw const _HttpError(
        409,
        'Ya tienes una devolución abierta para este pedido',
      );
    }
    final items = (order['items']! as List).cast<Json>();
    var refund = 0;
    for (final line in lines) {
      final item = items
          .where((i) => i['id'] == line['orderItemId'])
          .firstOrNull;
      if (item == null) {
        throw const _HttpError(400, 'Ese producto no es del pedido');
      }
      if (item['isReturnable'] != true) {
        throw _HttpError(
          400,
          '${item['productName']} no admite devolución (alimento o higiene)',
        );
      }
      final taken = returns
          .cast<Json>()
          .where((r) => r['status'] != 'REJECTED')
          .expand((r) => (r['items']! as List).cast<Json>())
          .where((l) => l['orderItemId'] == item['id'])
          .fold(0, (a, l) => a + (l['quantity']! as int));
      final left = (item['quantity']! as int) - taken;
      if ((line['quantity']! as int) > left) {
        throw _HttpError(
          400,
          'De ${item['productName']} puedes devolver como máximo $left',
        );
      }
      refund +=
          (item['unitPriceUsdCents']! as int) * (line['quantity']! as int);
    }
    // Con combos o cupón se devuelve lo pagado, no el precio de lista.
    final discount =
        (order['comboDiscountUsdCents']! as int) +
        (order['couponDiscountUsdCents']! as int);
    final listSubtotal = order['subtotalUsdCents']! as int;
    if (discount != 0 && listSubtotal != 0) {
      refund = refund * (listSubtotal - discount) ~/ listSubtotal;
    }
    returns.insert(0, {
      'id': 'ret-${requests.length}',
      'status': 'REQUESTED',
      'reason': reason,
      'refundUsdCents': refund,
      'currency': order['chargedCurrency'],
      'refundAmount': order['chargedCurrency'] == 'VES'
          ? (refund * double.parse(order['usdVesRate']! as String) / 100)
                .toStringAsFixed(2)
          : (refund / 100).toStringAsFixed(2),
      'decisionNote': null,
      'refundReference': null,
      'refundedAt': null,
      'createdAt': now.toIso8601String(),
      'items': [
        for (final l in lines)
          {'orderItemId': l['orderItemId'], 'quantity': l['quantity']},
      ],
    });
    return _json(201, _public(order));
  }

  http.Response _attachProof(Json order, String paymentId, http.Request r) {
    final payment = (order['payments']! as List)
        .cast<Json>()
        .where((p) => p['id'] == paymentId)
        .firstOrNull;
    if (payment == null) throw const _HttpError(404, 'Pago no encontrado');
    final file = _multipartFile(r, 'file');
    if (file == null || file.isEmpty) {
      throw const _HttpError(400, 'Adjunta el comprobante en el campo "file"');
    }
    if (file.length > 5 * 1024 * 1024) {
      throw const _HttpError(400, 'El comprobante pesa más de 5 MB');
    }
    final type = _sniff(file);
    if (type == null) {
      throw const _HttpError(
        400,
        'El comprobante debe ser una imagen JPG, PNG o WebP, o un PDF',
      );
    }
    if (payment['status'] != 'REPORTED') {
      throw const _HttpError(
        409,
        'Este pago ya fue revisado: no admite comprobante',
      );
    }
    proofs[paymentId] = file;
    final proof = {
      'contentType': type,
      'sizeBytes': file.length,
      'createdAt': now.toIso8601String(),
    };
    payment['proof'] = proof;
    // Como la API: responde solo los datos del comprobante.
    return _json(200, proof);
  }

  static String? _sniff(Uint8List b) {
    if (b.length >= 3 && b[0] == 0xff && b[1] == 0xd8 && b[2] == 0xff) {
      return 'image/jpeg';
    }
    if (b.length >= 8 && b[0] == 0x89 && b[1] == 0x50) return 'image/png';
    if (b.length >= 5 && latin1.decode(b.sublist(0, 5)) == '%PDF-') {
      return 'application/pdf';
    }
    return null;
  }

  /// Bytes del campo [field] de un cuerpo multipart/form-data.
  static Uint8List? _multipartFile(http.Request r, String field) {
    final type = r.headers['content-type'] ?? '';
    final match = RegExp('boundary=(.+)').firstMatch(type);
    if (!type.startsWith('multipart/form-data') || match == null) return null;
    final body = latin1.decode(r.bodyBytes);
    final start = body.indexOf('name="$field"');
    if (start < 0) return null;
    final dataStart = body.indexOf('\r\n\r\n', start) + 4;
    final dataEnd = body.indexOf('\r\n--${match.group(1)}', dataStart);
    return Uint8List.fromList(r.bodyBytes.sublist(dataStart, dataEnd));
  }

  final usedReferences = <String>{};

  http.Response _report(Json order, Json body) {
    if (order['status'] == 'PAYMENT_REPORTED') {
      throw const _HttpError(
        409,
        'Ya reportaste un pago; espera a que el equipo lo revise',
      );
    }
    if (order['status'] != 'PENDING_PAYMENT') {
      throw const _HttpError(409, 'Este pedido no admite reportes de pago');
    }
    final reference = body['reference']! as String;
    if (!RegExp(r'^[A-Z0-9-]{4,40}$').hasMatch(reference)) {
      throw const _HttpError(400, [
        'reference: Referencia inválida: de 4 a 40 letras, números o guiones',
      ]);
    }
    if (usedReferences.contains(reference)) {
      throw const _HttpError(409, 'Esa referencia ya se usó en otro pago');
    }
    usedReferences.add(reference);
    (order['payments']! as List).insert(0, {
      'id': 'pay-${requests.length}',
      'reference': reference,
      'amount': body['amount'],
      'currency': order['chargedCurrency'],
      'paidAt': body['paidAt'],
      'status': 'REPORTED',
      'rejectionReason': null,
      'createdAt': now.toIso8601String(),
      'proof': null,
    });
    _transition(order, 'PAYMENT_REPORTED', 'Referencia $reference');
    return _json(201, _public(order));
  }
}

class FakeRates {
  const FakeRates({this.usdVes, this.eurVes});
  final String? usdVes;
  final String? eurVes;
}

class _HttpError implements Exception {
  const _HttpError(this.status, this.message);
  final int status;
  final Object message;
}
