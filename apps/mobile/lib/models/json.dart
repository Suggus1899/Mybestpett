// Lectura de JSON con tipos estrictos. Si la API cambia la forma de una
// respuesta, falla aquí con un mensaje claro en vez de en una pantalla.

typedef Json = Map<String, Object?>;

Json asJson(Object? value) {
  if (value is Map<String, Object?>) return value;
  throw FormatException('Se esperaba un objeto JSON y llegó: $value');
}

List<T> asList<T>(Object? value, T Function(Json) parse) {
  if (value is! List<Object?>) {
    throw FormatException('Se esperaba una lista JSON y llegó: $value');
  }
  return [for (final item in value) parse(asJson(item))];
}

extension JsonRead on Json {
  T _get<T>(String key) {
    final value = this[key];
    if (value is T) return value;
    throw FormatException('Campo "$key": se esperaba $T y llegó $value');
  }

  String str(String key) => _get<String>(key);
  String? strOrNull(String key) => _get<String?>(key);
  int integer(String key) => _get<num>(key).toInt();
  int? intOrNull(String key) => _get<num?>(key)?.toInt();
  bool boolean(String key) => _get<bool>(key);
  Json obj(String key) => asJson(this[key]);
  Json? objOrNull(String key) => this[key] == null ? null : asJson(this[key]);
  DateTime date(String key) => DateTime.parse(str(key));
  DateTime? dateOrNull(String key) {
    final value = strOrNull(key);
    return value == null ? null : DateTime.parse(value);
  }

  List<String> strings(String key) => [
    for (final v in _get<List<Object?>>(key)) v as String,
  ];

  /// Decimal de Prisma: llega como texto ("36.5"); se acepta también número.
  String decimal(String key) {
    final value = this[key];
    if (value is String) return value;
    if (value is num) return value.toString();
    throw FormatException(
      'Campo "$key": se esperaba un decimal y llegó $value',
    );
  }

  String? decimalOrNull(String key) => this[key] == null ? null : decimal(key);
}

/// Respuesta paginada de la API.
class Page<T> {
  const Page({
    required this.items,
    required this.total,
    required this.page,
    required this.pageSize,
  });

  factory Page.fromJson(Json json, T Function(Json) parse) => Page(
    items: asList(json['items'], parse),
    total: json.integer('total'),
    page: json.integer('page'),
    pageSize: json.integer('pageSize'),
  );

  final List<T> items;
  final int total;
  final int page;
  final int pageSize;

  bool get hasMore => page * pageSize < total;
}
