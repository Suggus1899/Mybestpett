import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../models/json.dart';

/// Tokens de la sesión. [accessExpiresAt] se calcula con el reloj del
/// teléfono al recibirlos; se renueva 30 s antes para no rozar el límite.
class AuthTokens {
  const AuthTokens({
    required this.accessToken,
    required this.refreshToken,
    required this.accessExpiresAt,
  });

  factory AuthTokens.fromApi(Json json, DateTime receivedAt) => AuthTokens(
    accessToken: json.str('accessToken'),
    refreshToken: json.str('refreshToken'),
    accessExpiresAt: receivedAt.add(
      Duration(seconds: json.integer('accessTokenExpiresIn')),
    ),
  );

  factory AuthTokens.fromStorage(Json json) => AuthTokens(
    accessToken: json.str('accessToken'),
    refreshToken: json.str('refreshToken'),
    accessExpiresAt: json.date('accessExpiresAt'),
  );

  final String accessToken;
  final String refreshToken;
  final DateTime accessExpiresAt;

  static const margin = Duration(seconds: 30);

  bool isExpired(DateTime now) =>
      !now.isBefore(accessExpiresAt.subtract(margin));

  Json toStorage() => {
    'accessToken': accessToken,
    'refreshToken': refreshToken,
    'accessExpiresAt': accessExpiresAt.toUtc().toIso8601String(),
  };
}

abstract interface class TokenStore {
  Future<AuthTokens?> read();
  Future<void> write(AuthTokens tokens);
  Future<void> clear();
}

/// Guarda los tokens en el Keychain (iOS) o el Keystore (Android), nunca en
/// texto plano ni en preferencias compartidas.
class SecureTokenStore implements TokenStore {
  SecureTokenStore([FlutterSecureStorage? storage])
    : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;
  static const _key = 'petbf.session';

  @override
  Future<AuthTokens?> read() async {
    try {
      final raw = await _storage.read(key: _key);
      if (raw == null) return null;
      return AuthTokens.fromStorage(asJson(jsonDecode(raw)));
    } catch (_) {
      // Datos dañados o ilegibles (p. ej. tras restaurar el teléfono):
      // se descartan y la persona vuelve a entrar.
      await clear();
      return null;
    }
  }

  @override
  Future<void> write(AuthTokens tokens) =>
      _storage.write(key: _key, value: jsonEncode(tokens.toStorage()));

  @override
  Future<void> clear() async {
    try {
      await _storage.delete(key: _key);
    } on Exception {
      // Nada que borrar o almacenamiento no disponible.
    }
  }
}

/// Para pruebas: guarda los tokens en memoria.
class MemoryTokenStore implements TokenStore {
  MemoryTokenStore([this.tokens]);
  AuthTokens? tokens;
  int writes = 0;

  @override
  Future<AuthTokens?> read() async => tokens;

  @override
  Future<void> write(AuthTokens value) async {
    tokens = value;
    writes++;
  }

  @override
  Future<void> clear() async => tokens = null;
}
