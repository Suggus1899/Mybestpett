import 'dart:convert';

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
    if (m == 'GET' && path == '/shipping-zones') return _json(200, zones);
    if (m == 'GET' && path == '/payment-methods') return _json(200, methods);

    // Carrito
    if (segments.isNotEmpty && segments[0] == 'cart') {
      final email = _auth(r);
      final cart = carts.putIfAbsent(email, () => {});
      if (m == 'GET' && segments.length == 1) return _json(200, _cart(email));
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
    };
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

  Json _cart(String email) {
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
    final valid = items.where((i) => i['issue'] == null);
    return {
      'items': items,
      'itemCount': items.fold<int>(0, (n, i) => n + (i['quantity']! as int)),
      'subtotalUsdCents': valid.fold<int>(
        0,
        (n, i) => n + (i['lineTotalUsdCents']! as int),
      ),
      'canCheckout': items.isNotEmpty && valid.length == items.length,
    };
  }

  http.Response _checkout(String email, Json body) {
    if (body['acceptTerms'] != true) {
      throw const _HttpError(400, [
        'acceptTerms: Debes aceptar los términos y condiciones',
      ]);
    }
    final cart = _cart(email);
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
    final shipping = subtotal >= (zone['freeOverUsdCents']! as int)
        ? 0
        : zone['priceUsdCents']! as int;
    final total = subtotal + shipping;
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
  }) {
    addAddress(email);
    carts.putIfAbsent(email, () => {})['v-mord'] = 2;
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

  Json _public(Json o) => {
    for (final e in o.entries)
      if (e.key != '_owner') e.key: e.value,
  };

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
