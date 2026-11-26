import 'package:material_ui/material_ui.dart';

/// Identidad visual de Petbf (la misma de la web).
abstract final class PetbfColors {
  static const petbf = Color(0xFF0E7566); // primario, texto blanco encima
  static const petbfDark = Color(0xFF0A5A4F);
  static const petbfSoft = Color(0xFFDDF0EC);
  static const amber = Color(0xFFF4A340); // ofertas, siempre con texto tinta
  static const ink = Color(0xFF18292E);
  static const slate = Color(0xFF4F6166); // texto secundario
  static const mist = Color(0xFFF2F6F5); // fondo
  static const line = Color(0xFFDCE4E2); // bordes
  static const danger = Color(0xFFB42318);
  static const dangerSoft = Color(0xFFFDECEA);
}

const _radiusCard = 16.0;
const _radiusField = 12.0;

ThemeData buildTheme() {
  const scheme = ColorScheme(
    brightness: Brightness.light,
    primary: PetbfColors.petbf,
    onPrimary: Colors.white,
    primaryContainer: PetbfColors.petbfSoft,
    onPrimaryContainer: PetbfColors.petbfDark,
    secondary: PetbfColors.amber,
    onSecondary: PetbfColors.ink,
    secondaryContainer: Color(0xFFFDE7CC),
    onSecondaryContainer: PetbfColors.ink,
    error: PetbfColors.danger,
    onError: Colors.white,
    errorContainer: PetbfColors.dangerSoft,
    onErrorContainer: PetbfColors.danger,
    surface: Colors.white,
    onSurface: PetbfColors.ink,
    onSurfaceVariant: PetbfColors.slate,
    surfaceContainerLowest: Colors.white,
    surfaceContainerLow: PetbfColors.mist,
    surfaceContainer: PetbfColors.mist,
    surfaceContainerHigh: PetbfColors.mist,
    surfaceContainerHighest: PetbfColors.line,
    outline: PetbfColors.slate,
    outlineVariant: PetbfColors.line,
  );

  const display = TextStyle(
    fontFamily: 'Fredoka',
    fontWeight: FontWeight.w600,
    color: PetbfColors.ink,
    height: 1.15,
  );

  final text = const TextTheme(
    displaySmall: TextStyle(fontSize: 32),
    headlineMedium: TextStyle(fontSize: 28),
    headlineSmall: TextStyle(fontSize: 24),
    titleLarge: TextStyle(fontSize: 22),
    titleMedium: TextStyle(fontSize: 18),
  ).apply(fontFamily: 'Fredoka');

  final body = const TextTheme(
    titleSmall: TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
    bodyLarge: TextStyle(fontSize: 16, height: 1.5),
    bodyMedium: TextStyle(fontSize: 15, height: 1.45),
    bodySmall: TextStyle(fontSize: 13, height: 1.4),
    labelLarge: TextStyle(fontSize: 16, fontWeight: FontWeight.w800),
    labelMedium: TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
    labelSmall: TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
  ).apply(fontFamily: 'Nunito', bodyColor: PetbfColors.ink);

  final textTheme = body.copyWith(
    displaySmall: display.merge(text.displaySmall),
    headlineMedium: display.merge(text.headlineMedium),
    headlineSmall: display.merge(text.headlineSmall),
    titleLarge: display.merge(text.titleLarge),
    titleMedium: display.merge(text.titleMedium),
  );

  const pill = StadiumBorder();
  const minButton = Size(64, 52); // táctiles de al menos 44 px

  final fieldBorder = OutlineInputBorder(
    borderRadius: BorderRadius.circular(_radiusField),
    borderSide: const BorderSide(color: PetbfColors.line),
  );

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    fontFamily: 'Nunito',
    textTheme: textTheme,
    scaffoldBackgroundColor: Colors.white,
    materialTapTargetSize: MaterialTapTargetSize.padded,
    appBarTheme: AppBarTheme(
      backgroundColor: Colors.white,
      foregroundColor: PetbfColors.ink,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0.5,
      centerTitle: false,
      titleTextStyle: textTheme.titleLarge,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        shape: pill,
        minimumSize: minButton,
        textStyle: textTheme.labelLarge,
        padding: const EdgeInsets.symmetric(horizontal: 24),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        shape: pill,
        minimumSize: minButton,
        textStyle: textTheme.labelLarge,
        foregroundColor: PetbfColors.petbf,
        side: const BorderSide(color: PetbfColors.line),
        padding: const EdgeInsets.symmetric(horizontal: 24),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        minimumSize: const Size(44, 44),
        textStyle: textTheme.labelLarge,
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      border: fieldBorder,
      enabledBorder: fieldBorder,
      focusedBorder: fieldBorder.copyWith(
        borderSide: const BorderSide(color: PetbfColors.petbf, width: 2),
      ),
      errorBorder: fieldBorder.copyWith(
        borderSide: const BorderSide(color: PetbfColors.danger),
      ),
      focusedErrorBorder: fieldBorder.copyWith(
        borderSide: const BorderSide(color: PetbfColors.danger, width: 2),
      ),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      errorMaxLines: 3,
      helperMaxLines: 3,
    ),
    cardTheme: CardThemeData(
      color: Colors.white,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(_radiusCard),
        side: const BorderSide(color: PetbfColors.line),
      ),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: PetbfColors.mist,
      selectedColor: PetbfColors.petbfSoft,
      side: const BorderSide(color: PetbfColors.line),
      shape: const StadiumBorder(),
      labelStyle: textTheme.labelMedium,
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      indicatorColor: PetbfColors.petbfSoft,
      labelTextStyle: WidgetStatePropertyAll(textTheme.labelSmall),
    ),
    dividerTheme: const DividerThemeData(color: PetbfColors.line, space: 1),
    snackBarTheme: SnackBarThemeData(
      behavior: SnackBarBehavior.floating,
      backgroundColor: PetbfColors.ink,
      contentTextStyle: textTheme.bodyMedium?.copyWith(color: Colors.white),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(_radiusField),
      ),
    ),
  );
}
