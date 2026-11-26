// Validaciones de formularios. Repiten las reglas de la API (esquemas Zod)
// para avisar antes de enviar; la API vuelve a validar todo igualmente.
// Cada función devuelve el mensaje de error o null si el valor es válido.

/// Las 24 entidades federales de Venezuela, como en la API.
const veStates = [
  'Amazonas',
  'Anzoátegui',
  'Apure',
  'Aragua',
  'Barinas',
  'Bolívar',
  'Carabobo',
  'Cojedes',
  'Delta Amacuro',
  'Distrito Capital',
  'Falcón',
  'Guárico',
  'La Guaira',
  'Lara',
  'Mérida',
  'Miranda',
  'Monagas',
  'Nueva Esparta',
  'Portuguesa',
  'Sucre',
  'Táchira',
  'Trujillo',
  'Yaracuy',
  'Zulia',
];

/// Cantidad máxima por presentación en el carrito (MAX_QUANTITY en la API).
const maxQuantity = 20;

// Mismo patrón que z.email() de Zod 4.
final _emailPattern = RegExp(
  r"^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$",
);
final _phonePattern = RegExp(r'^\+?[0-9\s-]{10,16}$');
final _referencePattern = RegExp(r'^[A-Z0-9-]{4,40}$');
final _amountPattern = RegExp(r'^\d{1,12}(\.\d{1,2})?$');

/// Los teclados del móvil suelen añadir un espacio y mayúsculas al correo.
String normalizeEmail(String value) => value.trim().toLowerCase();

String? validateEmail(String? value) {
  final email = normalizeEmail(value ?? '');
  if (email.isEmpty) return 'Escribe tu correo';
  if (email.length > 254 || !_emailPattern.hasMatch(email)) {
    return 'Correo inválido';
  }
  return null;
}

/// Contraseña nueva (registro): de 8 a 128 caracteres.
String? validateNewPassword(String? value) {
  final password = value ?? '';
  if (password.isEmpty) return 'Escribe una contraseña';
  if (password.length < 8) {
    return 'La contraseña debe tener al menos 8 caracteres';
  }
  if (password.length > 128) return 'Máximo 128 caracteres';
  return null;
}

/// Contraseña al entrar: solo se exige que no esté vacía.
String? validateLoginPassword(String? value) {
  final password = value ?? '';
  if (password.isEmpty) return 'Escribe tu contraseña';
  if (password.length > 128) return 'Máximo 128 caracteres';
  return null;
}

/// Texto obligatorio con largo máximo (nombres, ciudad, dirección...).
String? Function(String?) requiredText(String label, int max) {
  return (value) {
    final text = (value ?? '').trim();
    if (text.isEmpty) return 'Escribe $label';
    if (text.length > max) return 'Máximo $max caracteres';
    return null;
  };
}

/// Texto opcional con largo máximo.
String? Function(String?) optionalText(int max) {
  return (value) {
    if ((value ?? '').trim().length > max) return 'Máximo $max caracteres';
    return null;
  };
}

String? validatePhone(String? value) {
  final phone = (value ?? '').trim();
  if (phone.isEmpty) return 'Escribe un teléfono';
  if (!_phonePattern.hasMatch(phone)) {
    return 'Teléfono inválido. Ejemplo: 0412-1234567';
  }
  return null;
}

/// Teléfono opcional (registro).
String? validateOptionalPhone(String? value) {
  if ((value ?? '').trim().isEmpty) return null;
  return validatePhone(value);
}

String? validateState(String? value) {
  if (value == null || value.isEmpty) return 'Elige un estado';
  if (!veStates.contains(value)) return 'Estado inválido';
  return null;
}

/// Referencia del pago: sin espacios y en mayúsculas, como la guarda la API
/// (así se detecta si ya se usó).
String normalizeReference(String value) =>
    value.replaceAll(RegExp(r'\s+'), '').toUpperCase();

String? validateReference(String? value) {
  final reference = normalizeReference(value ?? '');
  if (reference.isEmpty) return 'Escribe la referencia del pago';
  if (!_referencePattern.hasMatch(reference)) {
    return 'Referencia inválida: de 4 a 40 letras, números o guiones';
  }
  return null;
}

/// Acepta coma decimal ("123,45"), que es lo habitual en Venezuela, y la
/// convierte al punto que pide la API. Rechaza separadores de miles porque
/// "1.234" sería ambiguo.
String? normalizeAmount(String value) {
  final text = value.trim();
  if (text.contains('.') && text.contains(',')) return null;
  final amount = text.replaceAll(',', '.');
  if (!_amountPattern.hasMatch(amount)) return null;
  return amount;
}

String? validateAmount(String? value) {
  final text = (value ?? '').trim();
  if (text.isEmpty) return 'Escribe el monto que pagaste';
  if (text.contains('.') && text.contains(',')) {
    return 'Escribe el monto sin separador de miles, por ejemplo 1234,50';
  }
  final amount = normalizeAmount(text);
  if (amount == null) return 'Monto inválido: hasta 2 decimales';
  if (double.parse(amount) <= 0) return 'El monto debe ser mayor que cero';
  return null;
}

/// Margen para relojes desfasados entre el teléfono y el servidor (como la API).
const clockSkew = Duration(minutes: 10);

/// La fecha del pago no puede ser futura ni anterior al pedido.
String? validatePaidAt(
  DateTime? paidAt, {
  required DateTime orderCreatedAt,
  required DateTime now,
}) {
  if (paidAt == null) return 'Indica cuándo pagaste';
  if (paidAt.isAfter(now.add(clockSkew))) {
    return 'La fecha del pago no puede estar en el futuro';
  }
  if (paidAt.isBefore(orderCreatedAt.subtract(clockSkew))) {
    return 'La fecha del pago es anterior al pedido';
  }
  return null;
}

/// Búsqueda del catálogo: la API pide de 2 a 80 caracteres.
String? searchQuery(String value) {
  final q = value.trim();
  if (q.length < 2) return null;
  return q.length > 80 ? q.substring(0, 80) : q;
}

/// Motivo de una devolución: de 10 a 500 caracteres, como la API.
String? validateReturnReason(String? value) {
  final text = value?.trim() ?? '';
  if (text.length < 10) return 'Cuéntanos el motivo (mínimo 10 caracteres)';
  if (text.length > 500) return 'El motivo admite hasta 500 caracteres';
  return null;
}

/// Reseña: título opcional de hasta 80 y texto de 10 a 1000 caracteres.
String? validateReviewTitle(String? value) => (value?.trim().length ?? 0) > 80
    ? 'El título admite hasta 80 caracteres'
    : null;

String? validateReviewBody(String? value) {
  final text = value?.trim() ?? '';
  if (text.isEmpty) return 'Cuéntanos tu experiencia';
  if (text.length < 10) return 'Cuéntanos un poco más (mínimo 10 caracteres)';
  if (text.length > 1000) return 'La reseña admite hasta 1000 caracteres';
  return null;
}
