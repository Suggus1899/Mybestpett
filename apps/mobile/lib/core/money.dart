// Dinero sin double: la API guarda céntimos enteros de USD y las tasas del BCV
// como texto decimal. Aquí se calcula con enteros (BigInt) y redondeo a la
// mitad hacia arriba, igual que la API, para que el monto estimado en la app
// coincida al céntimo con el que la API congela en el pedido.

/// Monedas en que se puede cobrar un pedido.
enum Currency { usd, ves, eur, usdt }

Currency currencyFromApi(String value) => switch (value) {
  'USD' => Currency.usd,
  'VES' => Currency.ves,
  'EUR' => Currency.eur,
  'USDT' => Currency.usdt,
  _ => throw FormatException('Moneda desconocida: $value'),
};

/// Un decimal exacto como fracción entera: [numerator] / 10^[scale].
class _Dec {
  const _Dec(this.numerator, this.scale);
  final BigInt numerator;
  final int scale;

  static final _pattern = RegExp(r'^\d+(\.\d+)?$');

  static _Dec parse(String text) {
    final value = text.trim();
    if (!_pattern.hasMatch(value)) {
      throw FormatException('Número decimal inválido: $text');
    }
    final parts = value.split('.');
    final decimals = parts.length == 2 ? parts[1] : '';
    return _Dec(BigInt.parse(parts[0] + decimals), decimals.length);
  }
}

BigInt _pow10(int n) => BigInt.from(10).pow(n);

/// División entera con redondeo a la mitad hacia arriba (valores positivos).
BigInt _divRound(BigInt a, BigInt b) =>
    (a * BigInt.two + b) ~/ (b * BigInt.two);

/// Bolívares (en céntimos) de un monto en céntimos de USD con la tasa dada
/// (Bs por 1 USD, texto decimal de la API).
int usdCentsToVesCents(int usdCents, String usdVesRate) {
  final rate = _Dec.parse(usdVesRate);
  return _divRound(
    BigInt.from(usdCents) * rate.numerator,
    _pow10(rate.scale),
  ).toInt();
}

/// Céntimos a cobrar en la moneda del método, como `chargedAmount` de la API:
/// Bs = USD × tasa del dólar; euros = USD × tasa del dólar ÷ tasa del euro;
/// USDT 1:1 con el dólar. Devuelve null si falta la tasa necesaria.
int? chargeCents(
  int usdCents,
  Currency currency, {
  String? usdVes,
  String? eurVes,
}) {
  switch (currency) {
    case Currency.usd:
    case Currency.usdt:
      return usdCents;
    case Currency.ves:
      if (usdVes == null) return null;
      return usdCentsToVesCents(usdCents, usdVes);
    case Currency.eur:
      if (usdVes == null || eurVes == null) return null;
      final usd = _Dec.parse(usdVes);
      final eur = _Dec.parse(eurVes);
      // cents × (u / 10^su) ÷ (e / 10^se) = cents × u × 10^se ÷ (e × 10^su)
      final denominator = eur.numerator * _pow10(usd.scale);
      if (denominator == BigInt.zero) return null;
      return _divRound(
        BigInt.from(usdCents) * usd.numerator * _pow10(eur.scale),
        denominator,
      ).toInt();
  }
}

/// Convierte un monto decimal de la API ("123.4", "100", "0.50") a céntimos.
int decimalToCents(String text) {
  final value = _Dec.parse(text);
  if (value.scale <= 2) {
    return (value.numerator * _pow10(2 - value.scale)).toInt();
  }
  return _divRound(value.numerator, _pow10(value.scale - 2)).toInt();
}

/// Céntimos como texto con punto y dos decimales, el formato que pide la API
/// al reportar un pago: 12345 -> "123.45".
String centsToApiAmount(int cents) {
  final whole = cents ~/ 100;
  final rest = (cents % 100).toString().padLeft(2, '0');
  return '$whole.$rest';
}

/// Envío gratis cuando el subtotal llega al mínimo de la zona (25 $ por defecto).
int shippingCostCents(
  int subtotalUsdCents, {
  required int priceUsdCents,
  required int? freeOverUsdCents,
}) {
  if (freeOverUsdCents != null && subtotalUsdCents >= freeOverUsdCents) {
    return 0;
  }
  return priceUsdCents;
}

/// Parte pagada de [listUsdCents] cuando el pedido tuvo [discountUsdCents] de
/// descuento sobre [subtotalUsdCents]; redondea hacia abajo, igual que la API.
int discountedShare(
  int listUsdCents, {
  required int subtotalUsdCents,
  required int discountUsdCents,
}) {
  if (discountUsdCents == 0 || subtotalUsdCents == 0) return listUsdCents;
  return (BigInt.from(listUsdCents) *
          BigInt.from(subtotalUsdCents - discountUsdCents) ~/
          BigInt.from(subtotalUsdCents))
      .toInt();
}
