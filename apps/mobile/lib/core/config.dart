import 'package:flutter/foundation.dart';

/// Dirección de la API, con el prefijo /v1.
///
/// Se pasa al compilar: `flutter run --dart-define=API_URL=https://api.petbf.com/v1`.
/// Sin valor, apunta a la API local: el emulador de Android llega a la
/// computadora por 10.0.2.2 y el simulador de iOS por localhost.
String apiBaseUrl() {
  const fromEnv = String.fromEnvironment('API_URL');
  final url = fromEnv.isNotEmpty
      ? fromEnv
      : defaultTargetPlatform == TargetPlatform.android
      ? 'http://10.0.2.2:3001/v1'
      : 'http://localhost:3001/v1';
  return checkApiUrl(url, release: kReleaseMode);
}

/// En una compilación de publicación solo se acepta https: los tokens de
/// sesión nunca deben viajar en claro.
String checkApiUrl(String url, {required bool release}) {
  final uri = Uri.tryParse(url);
  if (uri == null || !uri.hasScheme || uri.host.isEmpty) {
    throw ArgumentError.value(url, 'API_URL', 'no es una dirección válida');
  }
  if (release && uri.scheme != 'https') {
    throw ArgumentError.value(url, 'API_URL', 'debe usar https en producción');
  }
  return url.endsWith('/') ? url.substring(0, url.length - 1) : url;
}
