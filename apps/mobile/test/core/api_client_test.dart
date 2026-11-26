import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:petbf/core/api_client.dart';
import 'package:petbf/core/token_store.dart';

import '../support/fake_backend.dart';

const base = 'http://api.test/v1';

http.Response json(int status, Object? body) => http.Response(
  body == null ? '' : jsonEncode(body),
  status,
  headers: {'content-type': 'application/json; charset=utf-8'},
);

void main() {
  late DateTime clock;
  DateTime now() => clock;

  setUp(() => clock = DateTime.utc(2026, 11, 26, 12));

  ApiClient clientFor(http.Client http, {TokenStore? store}) => ApiClient(
    baseUrl: base,
    httpClient: http,
    tokenStore: store ?? MemoryTokenStore(),
    now: now,
    timeout: const Duration(milliseconds: 200),
  );

  AuthTokens tokens({
    String at = 'at-old',
    String rt = 'rt-old',
    int ttl = 900,
  }) => AuthTokens(
    accessToken: at,
    refreshToken: rt,
    accessExpiresAt: clock.add(Duration(seconds: ttl)),
  );

  group('errorMessageFrom', () {
    test('usa el mensaje de la API sin el nombre del campo', () {
      expect(
        errorMessageFrom(
          400,
          jsonEncode({
            'message': [
              'password: La contraseña debe tener al menos 8 caracteres',
            ],
          }),
        ),
        'La contraseña debe tener al menos 8 caracteres',
      );
      expect(
        errorMessageFrom(
          409,
          jsonEncode({'message': 'Ya existe una cuenta con ese correo'}),
        ),
        'Ya existe una cuenta con ese correo',
      );
    });

    test('429, 5xx y cuerpos sin JSON', () {
      expect(
        errorMessageFrom(429, ''),
        'Demasiados intentos. Espera un minuto.',
      );
      expect(
        errorMessageFrom(500, '<html>'),
        startsWith('El servidor tuvo un problema'),
      );
      expect(errorMessageFrom(400, 'nada'), genericErrorMessage);
      expect(
        errorMessageFrom(400, jsonEncode({'message': []})),
        genericErrorMessage,
      );
      expect(errorMessageFrom(400, jsonEncode([1, 2])), genericErrorMessage);
    });
  });

  group('peticiones públicas', () {
    test('arma la URL con /v1 y omite filtros vacíos', () async {
      late Uri seen;
      final client = clientFor(
        MockClient((r) async {
          seen = r.url;
          expect(r.headers['Authorization'], isNull);
          return json(200, {'ok': true});
        }),
      );
      final result = await client.get(
        '/products',
        query: {'q': 'perro', 'category': null, 'species': '', 'page': '2'},
      );
      expect(result, {'ok': true});
      expect(seen.toString(), '$base/products?q=perro&page=2');
    });

    test('lee bien acentos y eñes', () async {
      final client = clientFor(
        MockClient(
          (_) async => http.Response.bytes(
            utf8.encode(jsonEncode({'name': 'Cañón áéíóú'})),
            200,
            headers: {'content-type': 'application/json'},
          ),
        ),
      );
      expect(await client.get('/x'), {'name': 'Cañón áéíóú'});
    });

    test('204 devuelve null', () async {
      final client = clientFor(
        MockClient((_) async => json(204, null)),
        store: MemoryTokenStore(tokens()),
      );
      expect(await client.delete('/addresses/1'), isNull);
      expect(await client.get('/vacio'), isNull);
    });

    test('convierte los errores HTTP en ApiException con mensaje', () async {
      final client = clientFor(
        MockClient(
          (_) async => json(404, {'message': 'Producto no encontrado'}),
        ),
      );
      await expectLater(
        client.get('/products/x'),
        throwsA(
          isA<ApiException>()
              .having((e) => e.status, 'status', 404)
              .having((e) => e.isNotFound, 'isNotFound', true)
              .having((e) => e.message, 'message', 'Producto no encontrado'),
        ),
      );
    });

    test('sin conexión o sin respuesta: error de red', () async {
      final offline = clientFor(
        MockClient((r) async => throw http.ClientException('fallo', r.url)),
      );
      await expectLater(
        offline.get('/x'),
        throwsA(
          isA<ApiException>().having((e) => e.isNetwork, 'isNetwork', true),
        ),
      );

      final slow = clientFor(
        MockClient((_) async {
          await Future<void>.delayed(const Duration(seconds: 1));
          return json(200, {});
        }),
      );
      await expectLater(
        slow.get('/x'),
        throwsA(
          isA<ApiException>().having(
            (e) => e.message,
            'message',
            networkErrorMessage,
          ),
        ),
      );
    });

    test('respuesta 200 que no es JSON', () async {
      final client = clientFor(
        MockClient((_) async => http.Response('<html>', 200)),
      );
      await expectLater(client.get('/x'), throwsA(isA<ApiException>()));
    });
  });

  group('sesión', () {
    test(
      'sin tokens, una ruta privada pide entrar sin llamar a la API',
      () async {
        var calls = 0;
        final client = clientFor(
          MockClient((_) async {
            calls++;
            return json(200, {});
          }),
        );
        await expectLater(
          client.get('/cart', auth: true),
          throwsA(isA<ApiException>().having((e) => e.status, 'status', 401)),
        );
        expect(calls, 0);
      },
    );

    test('saveTokens guarda y calcula el vencimiento con el reloj', () async {
      final store = MemoryTokenStore();
      final client = clientFor(
        MockClient((_) async => json(200, {})),
        store: store,
      );
      await client.saveTokens({
        'accessToken': 'a',
        'refreshToken': 'r',
        'accessTokenExpiresIn': 900,
      });
      expect(
        store.tokens!.accessExpiresAt,
        clock.add(const Duration(seconds: 900)),
      );
      expect(await client.hasSession, isTrue);
    });

    test('envía el access token vigente', () async {
      final client = clientFor(
        MockClient((r) async {
          expect(r.headers['Authorization'], 'Bearer at-old');
          return json(200, {'items': []});
        }),
        store: MemoryTokenStore(tokens()),
      );
      expect(await client.get('/cart', auth: true), {'items': []});
    });

    test(
      'renueva antes de pedir si el token ya venció (con 30 s de margen)',
      () async {
        final backend = FakeBackend();
        final issued = backend.issueTokensFor('ana@petbf.com');
        final store = MemoryTokenStore(
          AuthTokens(
            accessToken: 'vencido',
            refreshToken: issued['refreshToken']! as String,
            accessExpiresAt: clock.add(const Duration(seconds: 20)),
          ),
        );
        final client = clientFor(backend.client, store: store);
        final me = await client.get('/auth/me', auth: true);
        expect((me! as Map)['email'], 'ana@petbf.com');
        expect(backend.refreshCalls, 1);
        expect(store.tokens!.refreshToken, isNot(issued['refreshToken']));
      },
    );

    test('ante un 401 renueva una vez y reintenta la petición', () async {
      final backend = FakeBackend();
      final issued = backend.issueTokensFor('ana@petbf.com');
      final store = MemoryTokenStore(
        AuthTokens(
          accessToken: 'revocado',
          refreshToken: issued['refreshToken']! as String,
          accessExpiresAt: clock.add(const Duration(minutes: 10)),
        ),
      );
      final client = clientFor(backend.client, store: store);
      final me = await client.get('/auth/me', auth: true);
      expect((me! as Map)['firstName'], 'Ana');
      expect(backend.refreshCalls, 1);
      expect(backend.called('GET', '/auth/me'), hasLength(2));
    });

    test(
      'varias peticiones a la vez con el token vencido: UNA sola renovación',
      () async {
        final backend = FakeBackend();
        final issued = backend.issueTokensFor('ana@petbf.com');
        final store = MemoryTokenStore(
          AuthTokens(
            accessToken: 'vencido',
            refreshToken: issued['refreshToken']! as String,
            accessExpiresAt: clock.subtract(const Duration(minutes: 1)),
          ),
        );
        final client = clientFor(backend.client, store: store);
        final results = await Future.wait([
          client.get('/auth/me', auth: true),
          client.get('/cart', auth: true),
          client.get('/addresses', auth: true),
        ]);
        expect(results, hasLength(3));
        // Con dos renovaciones, la segunda usaría un token ya rotado y la API
        // cerraría la sesión por posible robo.
        expect(backend.refreshCalls, 1);
      },
    );

    test('si la renovación falla, borra la sesión y avisa', () async {
      final backend = FakeBackend();
      final store = MemoryTokenStore(
        tokens(at: 'vencido', rt: 'rt-revocado', ttl: -60),
      );
      final client = clientFor(backend.client, store: store);
      final expired = expectLater(client.sessionExpired, emits(null));
      await expectLater(
        client.get('/cart', auth: true),
        throwsA(
          isA<ApiException>()
              .having((e) => e.status, 'status', 401)
              .having((e) => e.message, 'message', sessionExpiredMessage),
        ),
      );
      await expired;
      expect(store.tokens, isNull);
      expect(await client.hasSession, isFalse);
    });

    test('si tras renovar sigue en 401, cierra la sesión', () async {
      final backend = FakeBackend();
      final issued = backend.issueTokensFor('ana@petbf.com');
      backend.overrides['GET /cart'] = (_) =>
          json(401, {'message': 'Unauthorized'});
      final store = MemoryTokenStore(
        AuthTokens(
          accessToken: issued['accessToken']! as String,
          refreshToken: issued['refreshToken']! as String,
          accessExpiresAt: clock.add(const Duration(minutes: 10)),
        ),
      );
      final client = clientFor(backend.client, store: store);
      await expectLater(
        client.get('/cart', auth: true),
        throwsA(isA<ApiException>()),
      );
      expect(store.tokens, isNull);
    });

    test('sin conexión al renovar NO borra la sesión', () async {
      final store = MemoryTokenStore(tokens(ttl: -60));
      final client = clientFor(
        MockClient((r) async => throw http.ClientException('sin red', r.url)),
        store: store,
      );
      await expectLater(
        client.get('/cart', auth: true),
        throwsA(
          isA<ApiException>().having((e) => e.isNetwork, 'isNetwork', true),
        ),
      );
      expect(store.tokens, isNotNull);
    });

    test('logout revoca en la API y borra los tokens', () async {
      final backend = FakeBackend();
      final issued = backend.issueTokensFor('ana@petbf.com');
      final store = MemoryTokenStore(
        AuthTokens(
          accessToken: issued['accessToken']! as String,
          refreshToken: issued['refreshToken']! as String,
          accessExpiresAt: clock.add(const Duration(minutes: 10)),
        ),
      );
      final client = clientFor(backend.client, store: store);
      await client.logout();
      expect(store.tokens, isNull);
      final call = backend.called('POST', '/auth/logout').single;
      expect(jsonDecode(call.body), {'refreshToken': issued['refreshToken']});
      expect(backend.refreshTokens, isEmpty);
    });

    test('logout sin conexión igual borra los tokens locales', () async {
      final store = MemoryTokenStore(tokens());
      final client = clientFor(
        MockClient((r) async => throw http.ClientException('sin red', r.url)),
        store: store,
      );
      await client.logout();
      expect(store.tokens, isNull);
    });

    test('envía JSON en el cuerpo', () async {
      final client = clientFor(
        MockClient((r) async {
          expect(r.headers['Content-Type'], startsWith('application/json'));
          expect(jsonDecode(r.body), {'variantId': 'v', 'quantity': 2});
          return json(201, {});
        }),
        store: MemoryTokenStore(tokens()),
      );
      await client.post('/cart/items', body: {'variantId': 'v', 'quantity': 2});
    });
  });

  group('SecureTokenStore', () {
    test('AuthTokens se guarda y se lee igual', () {
      final t = tokens();
      final copy = AuthTokens.fromStorage(t.toStorage());
      expect(copy.accessToken, t.accessToken);
      expect(copy.refreshToken, t.refreshToken);
      expect(copy.accessExpiresAt, t.accessExpiresAt);
    });

    test('isExpired con margen de 30 s', () {
      final t = AuthTokens(
        accessToken: 'a',
        refreshToken: 'r',
        accessExpiresAt: clock.add(const Duration(seconds: 31)),
      );
      expect(t.isExpired(clock), isFalse);
      expect(t.isExpired(clock.add(const Duration(seconds: 1))), isTrue);
    });
  });

  test('dispose cierra el cliente HTTP', () {
    final client = clientFor(MockClient((_) async => json(200, {})));
    expect(client.dispose, returnsNormally);
  });

  group('subir y bajar archivos', () {
    test('sube multipart y reintenta con un token nuevo tras un 401', () async {
      final seen = <String>[];
      final store = MemoryTokenStore()..tokens = tokens();
      final client = clientFor(
        MockClient((r) async {
          if (r.url.path.endsWith('/auth/refresh')) {
            return json(200, {
              'accessToken': 'at-new',
              'refreshToken': 'rt-new',
              'accessTokenExpiresIn': 900,
            });
          }
          final auth = r.headers['Authorization'];
          seen.add('${r.headers['content-type']!.split(';').first} $auth');
          expect(latin1.decode(r.bodyBytes), contains('name="file"'));
          expect(latin1.decode(r.bodyBytes), contains('filename="p.png"'));
          if (auth == 'Bearer at-old') return json(401, {'message': 'x'});
          return json(200, {'ok': true});
        }),
        store: store,
      );
      final result = await client.upload(
        'PUT',
        '/orders/o-1/payments/p-1/proof',
        UploadFile(
          field: 'file',
          bytes: Uint8List.fromList([1, 2, 3]),
          filename: 'p.png',
          contentType: 'image/png',
        ),
      );
      expect(result, {'ok': true});
      expect(seen, [
        'multipart/form-data Bearer at-old',
        'multipart/form-data Bearer at-new',
      ]);
    });

    test('descarga bytes tal cual y traduce los errores', () async {
      final store = MemoryTokenStore()..tokens = tokens();
      final client = clientFor(
        MockClient((r) async {
          if (r.url.path.endsWith('/missing')) {
            return json(404, {'message': 'Este pago no tiene comprobante'});
          }
          return http.Response.bytes([0x89, 0x50, 0x4e, 0x47], 200);
        }),
        store: store,
      );
      expect(await client.getBytes('/file'), [0x89, 0x50, 0x4e, 0x47]);
      await expectLater(
        client.getBytes('/missing'),
        throwsA(
          isA<ApiException>()
              .having((e) => e.status, 'status', 404)
              .having(
                (e) => e.message,
                'message',
                'Este pago no tiene comprobante',
              ),
        ),
      );
    });

    test('413 se explica como archivo demasiado grande', () {
      expect(
        errorMessageFrom(413, 'Payload Too Large'),
        'El archivo pesa más de 5 MB.',
      );
    });
  });
}
