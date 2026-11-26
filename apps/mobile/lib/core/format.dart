import 'money.dart';

// Formatos de Venezuela, iguales a los de la web: punto de miles, coma decimal.

String _grouped(int whole) {
  final digits = whole.toString();
  final buffer = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buffer.write('.');
    buffer.write(digits[i]);
  }
  return buffer.toString();
}

/// 123456 -> "1.234,56"
String formatCents(int cents) {
  final sign = cents < 0 ? '-' : '';
  final value = cents.abs();
  final rest = (value % 100).toString().padLeft(2, '0');
  return '$sign${_grouped(value ~/ 100)},$rest';
}

/// 1250 -> "$12,50"
String formatUsd(int cents) => '\$${formatCents(cents)}';

/// Precio en bolívares con la tasa del BCV (Bs por 1 USD).
String formatBs(int usdCents, String usdVesRate) =>
    'Bs. ${formatCents(usdCentsToVesCents(usdCents, usdVesRate))}';

/// Monto en la moneda del pago.
String formatMoneyCents(int cents, Currency currency) {
  final value = formatCents(cents);
  return switch (currency) {
    Currency.usd => '\$$value',
    Currency.ves => 'Bs. $value',
    Currency.eur => '$value €',
    Currency.usdt => '$value USDT',
  };
}

/// Monto decimal de la API ("123.45") en la moneda del pago.
String formatMoney(String amount, Currency currency) =>
    formatMoneyCents(decimalToCents(amount), currency);

/// La tienda opera en Caracas: UTC-4 todo el año (sin horario de verano).
const caracasOffset = Duration(hours: -4);

DateTime toCaracas(DateTime instant) => instant.toUtc().add(caracasOffset);

const _months = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sept',
  'oct',
  'nov',
  'dic',
];

String _date(DateTime d) => '${d.day} ${_months[d.month - 1]} ${d.year}';

String _time(DateTime d) {
  final hour12 = d.hour % 12 == 0 ? 12 : d.hour % 12;
  final minutes = d.minute.toString().padLeft(2, '0');
  return '$hour12:$minutes ${d.hour < 12 ? 'a. m.' : 'p. m.'}';
}

/// "26 nov 2026" (hora de Caracas)
String formatDate(DateTime instant) => _date(toCaracas(instant));

/// "5:03 p. m." (hora de Caracas)
String formatTime(DateTime instant) => _time(toCaracas(instant));

/// "26 nov 2026, 5:03 p. m." (hora de Caracas)
String formatDateTime(DateTime instant) =>
    '${formatDate(instant)}, ${formatTime(instant)}';

/// Igual, pero con la hora tal como la eligió la persona en su teléfono.
String formatLocalDateTime(DateTime local) =>
    '${_date(local)}, ${_time(local)}';

/// Tiempo que falta, para el plazo de pago: "1 h 05 min", "12 min", "menos de 1 min".
String formatRemaining(Duration remaining) {
  if (remaining.inMinutes < 1) return 'menos de 1 min';
  final hours = remaining.inHours;
  final minutes = remaining.inMinutes % 60;
  if (hours == 0) return '$minutes min';
  return '$hours h ${minutes.toString().padLeft(2, '0')} min';
}

/// "1 año y 3 meses", "4 meses", "Menos de un mes" (como en la web).
String formatAge(DateTime birthDate, DateTime now) {
  var months = (now.year - birthDate.year) * 12 + (now.month - birthDate.month);
  if (now.day < birthDate.day) months -= 1;
  if (months < 1) return 'Menos de un mes';
  final years = months ~/ 12;
  final rest = months % 12;
  final y = years == 1 ? '1 año' : '$years años';
  final m = rest == 1 ? '1 mes' : '$rest meses';
  if (years == 0) return m;
  return rest == 0 ? y : '$y y $m';
}

/// Porcentaje de descuento redondeado: (2990, 2490) -> 17
int discountPercent(int compareAtCents, int priceCents) =>
    ((1 - priceCents / compareAtCents) * 100).round();
