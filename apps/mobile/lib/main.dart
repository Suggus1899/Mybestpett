import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:material_ui/material_ui.dart';

import 'app.dart';
import 'core/api_client.dart';
import 'core/config.dart';
import 'core/providers.dart';
import 'core/token_store.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final client = ApiClient(
    baseUrl: apiBaseUrl(),
    httpClient: http.Client(),
    tokenStore: SecureTokenStore(),
  );
  runApp(
    ProviderScope(
      retry: retryOnNetworkError,
      overrides: [apiClientProvider.overrideWithValue(client)],
      child: const PetbfApp(),
    ),
  );
}
