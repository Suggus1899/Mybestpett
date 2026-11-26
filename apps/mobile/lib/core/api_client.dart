import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

import '../models/json.dart';
import 'token_store.dart';

/// Error de la API ya traducido a un mensaje para la persona.
class ApiException implements Exception {
  const ApiException(this.message, {this.status});

  /// Código HTTP; null si no se pudo conectar.
  final int? status;
  final String message;

  bool get isNetwork => status == null;
  bool get isUnauthorized => status == 401;
  bool get isNotFound => status == 404;

  @override
  String toString() => 'ApiException($status): $message';
}

const networkErrorMessage =
    'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.';
const sessionExpiredMessage = 'Tu sesión expiró. Vuelve a entrar.';
const genericErrorMessage = 'Algo salió mal. Inténtalo de nuevo.';

/// Mensaje legible a partir de una respuesta de error de la API (NestJS):
/// `{ "message": "..." }` o `{ "message": ["campo: ...", ...] }`.
String errorMessageFrom(int status, String body) {
  if (status == 429) return 'Demasiados intentos. Espera un minuto.';
  if (status == 413) return 'El archivo pesa más de 5 MB.';
  try {
    final json = jsonDecode(body);
    if (json is Map<String, Object?>) {
      final raw = json['message'];
      final message = raw is List<Object?> && raw.isNotEmpty ? raw.first : raw;
      if (message is String && message.isNotEmpty) {
        // "password: La contraseña..." -> "La contraseña..."
        return message.replaceFirst(RegExp(r'^[a-zA-Z.\d]+: '), '');
      }
    }
  } on FormatException {
    // Cuerpo que no es JSON: se usa el mensaje genérico.
  }
  if (status >= 500) {
    return 'El servidor tuvo un problema. Inténtalo de nuevo en unos minutos.';
  }
  return genericErrorMessage;
}

/// Archivo que se envía como `multipart/form-data`.
class UploadFile {
  const UploadFile({
    required this.field,
    required this.bytes,
    required this.filename,
    required this.contentType,
  });
  final String field;
  final Uint8List bytes;
  final String filename;
  final String contentType;
}

/// Cliente HTTP de la API de Petbf.
///
/// Sesión: el access token (JWT, 15 min) va en cada petición privada. Al
/// vencer se pide uno nuevo con el refresh token, que la API rota en cada uso.
/// Si llegan varias peticiones a la vez con el token vencido, se hace UNA sola
/// renovación y todas esperan su resultado: dos renovaciones con el mismo
/// refresh token harían que la API lo trate como robado y cierre la sesión.
class ApiClient {
  ApiClient({
    required this.baseUrl,
    required http.Client httpClient,
    required TokenStore tokenStore,
    DateTime Function()? now,
    this.timeout = const Duration(seconds: 20),
  }) : _http = httpClient,
       _store = tokenStore,
       _now = now ?? DateTime.now;

  final String baseUrl;
  final http.Client _http;
  final TokenStore _store;
  final DateTime Function() _now;
  final Duration timeout;

  AuthTokens? _tokens;
  bool _loaded = false;
  Future<AuthTokens?>? _refreshing;
  final _expired = StreamController<void>.broadcast();

  /// Avisa cuando la sesión se cerró porque la API ya no la acepta.
  Stream<void> get sessionExpired => _expired.stream;

  Future<AuthTokens?> currentTokens() async {
    if (!_loaded) {
      _tokens = await _store.read();
      _loaded = true;
    }
    return _tokens;
  }

  Future<bool> get hasSession async => (await currentTokens()) != null;

  /// Guarda los tokens de un login o registro.
  Future<void> saveTokens(Json json) async {
    final tokens = AuthTokens.fromApi(json, _now());
    _tokens = tokens;
    _loaded = true;
    await _store.write(tokens);
  }

  /// Cierra la sesión en este dispositivo y, si se puede, también en la API.
  Future<void> logout() async {
    final tokens = await currentTokens();
    _tokens = null;
    await _store.clear();
    if (tokens == null) return;
    try {
      await _send(
        'POST',
        '/auth/logout',
        body: {'refreshToken': tokens.refreshToken},
      );
    } on ApiException {
      // Sin conexión: el token local ya se borró y vence solo en la API.
    }
  }

  Future<Object?> get(
    String path, {
    Map<String, String?> query = const {},
    bool auth = false,
  }) => _request('GET', path, query: query, auth: auth);

  Future<Object?> post(String path, {Object? body, bool auth = true}) =>
      _request('POST', path, body: body, auth: auth);

  Future<Object?> put(String path, {Object? body}) =>
      _request('PUT', path, body: body, auth: true);

  Future<Object?> patch(String path, {Object? body}) =>
      _request('PATCH', path, body: body, auth: true);

  Future<Object?> delete(String path) => _request('DELETE', path, auth: true);

  /// Sube un archivo con sesión (p. ej. el comprobante de un pago).
  Future<Object?> upload(String method, String path, UploadFile file) =>
      _request(method, path, upload: file, auth: true);

  /// Descarga un archivo privado (p. ej. un comprobante) tal cual.
  Future<Uint8List> getBytes(String path) async =>
      (await _request('GET', path, auth: true, raw: true))! as Uint8List;

  Future<Object?> _request(
    String method,
    String path, {
    Map<String, String?> query = const {},
    Object? body,
    UploadFile? upload,
    bool raw = false,
    required bool auth,
  }) async {
    Object? read(http.Response response) =>
        raw ? _checked(response).bodyBytes : _decode(response);

    if (!auth) {
      return read(await _send(method, path, query: query, body: body));
    }

    var tokens = await currentTokens();
    if (tokens == null) {
      throw const ApiException(
        'Entra a tu cuenta para continuar.',
        status: 401,
      );
    }
    if (tokens.isExpired(_now())) {
      tokens = await _refresh(tokens);
    }
    var response = await _send(
      method,
      path,
      query: query,
      body: body,
      upload: upload,
      accessToken: tokens.accessToken,
    );
    if (response.statusCode == 401) {
      // Puede que otra petición ya haya renovado el token mientras tanto.
      final latest = _tokens;
      tokens = latest != null && latest.accessToken != tokens.accessToken
          ? latest
          : await _refresh(tokens);
      response = await _send(
        method,
        path,
        query: query,
        body: body,
        upload: upload,
        accessToken: tokens.accessToken,
      );
      if (response.statusCode == 401) {
        await _expire();
      }
    }
    return read(response);
  }

  Future<AuthTokens> _refresh(AuthTokens used) async {
    final pending = _refreshing ??= _doRefresh(used).whenComplete(() {
      _refreshing = null;
    });
    final tokens = await pending;
    if (tokens == null) {
      throw const ApiException(sessionExpiredMessage, status: 401);
    }
    return tokens;
  }

  Future<AuthTokens?> _doRefresh(AuthTokens used) async {
    final response = await _send(
      'POST',
      '/auth/refresh',
      body: {'refreshToken': used.refreshToken},
    );
    if (response.statusCode == 401 || response.statusCode == 400) {
      await _expire();
      return null;
    }
    final json = asJson(_decode(response));
    final tokens = AuthTokens.fromApi(json, _now());
    _tokens = tokens;
    await _store.write(tokens);
    return tokens;
  }

  Future<void> _expire() async {
    if (_tokens == null && _loaded) return;
    _tokens = null;
    _loaded = true;
    await _store.clear();
    _expired.add(null);
  }

  Future<http.Response> _send(
    String method,
    String path, {
    Map<String, String?> query = const {},
    Object? body,
    UploadFile? upload,
    String? accessToken,
  }) async {
    final params = {
      for (final e in query.entries)
        if (e.value != null && e.value!.isNotEmpty) e.key: e.value!,
    };
    final uri = Uri.parse('$baseUrl$path')
        .replace(queryParameters: params.isEmpty ? null : params);
    // Cada intento arma una petición nueva: una multipart no se reenvía.
    final http.BaseRequest request;
    if (upload != null) {
      request = http.MultipartRequest(method, uri)
        ..files.add(
          http.MultipartFile.fromBytes(
            upload.field,
            upload.bytes,
            filename: upload.filename,
            contentType: http.MediaType.parse(upload.contentType),
          ),
        );
    } else {
      final plain = http.Request(method, uri);
      if (body != null) {
        plain.headers['Content-Type'] = 'application/json';
        plain.body = jsonEncode(body);
      }
      request = plain;
    }
    request.headers['Accept'] = 'application/json';
    if (accessToken != null) {
      request.headers['Authorization'] = 'Bearer $accessToken';
    }
    try {
      final streamed = await _http.send(request).timeout(timeout);
      return await http.Response.fromStream(streamed).timeout(timeout);
    } on TimeoutException {
      throw const ApiException(networkErrorMessage);
    } on http.ClientException {
      throw const ApiException(networkErrorMessage);
    }
  }

  /// Lanza [ApiException] si la respuesta no es un 2xx.
  http.Response _checked(http.Response response) {
    final status = response.statusCode;
    if (status == 401 && response.request?.headers['Authorization'] != null) {
      throw const ApiException(sessionExpiredMessage, status: 401);
    }
    if (status < 200 || status >= 300) {
      throw ApiException(
        errorMessageFrom(status, response.body),
        status: status,
      );
    }
    return response;
  }

  Object? _decode(http.Response response) {
    final status = _checked(response).statusCode;
    if (status == 204 || response.body.isEmpty) return null;
    try {
      return jsonDecode(utf8.decode(response.bodyBytes));
    } on FormatException {
      throw ApiException(genericErrorMessage, status: status);
    }
  }

  void dispose() {
    unawaited(_expired.close());
    _http.close();
  }
}
