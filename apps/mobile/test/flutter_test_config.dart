import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// Carga las fuentes reales de la app en las pruebas. Sin esto Flutter usa
/// una fuente de cuadros más ancha y los desbordes no serían los reales.
Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  TestWidgetsFlutterBinding.ensureInitialized();
  Future<void> load(String family, List<String> files) async {
    final loader = FontLoader(family);
    for (final file in files) {
      loader.addFont(rootBundle.load('assets/fonts/$file'));
    }
    await loader.load();
  }

  await load('Nunito', [
    'Nunito-Regular.ttf',
    'Nunito-Bold.ttf',
    'Nunito-ExtraBold.ttf',
  ]);
  await load('Fredoka', ['Fredoka-SemiBold.ttf']);
  await testMain();
}
