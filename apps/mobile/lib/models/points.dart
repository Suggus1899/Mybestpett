import 'json.dart';

/// Reglas del programa de puntos (las mismas de la API): 1 punto por cada
/// dólar pagado en productos al recibir el pedido; 100 puntos valen 1 $ y se
/// canjean de 100 en 100.
const pointsStep = 100;

/// Centavos de descuento por cada punto (100 puntos = 100 centavos = 1 $).
const pointValueCents = 1;

/// Máximo de puntos que se pueden usar en un pedido cuyos productos cuestan
/// [itemsTotalUsdCents] (ya con combos y cupón): sin pasar del saldo ni de lo
/// que se paga por los productos, de 100 en 100.
int maxRedeemablePoints({
  required int balance,
  required int itemsTotalUsdCents,
}) {
  final usable = balance < itemsTotalUsdCents ? balance : itemsTotalUsdCents;
  return usable <= 0 ? 0 : usable ~/ pointsStep * pointsStep;
}

/// Puntos que gana un pedido: un punto por dólar completo pagado en
/// productos (sin envío y sin lo pagado con puntos).
int pointsEarnedFor(int paidItemsUsdCents) =>
    paidItemsUsdCents <= 0 ? 0 : paidItemsUsdCents ~/ 100;

enum PointsReason {
  earned('EARNED', 'Ganados por tu pedido'),
  redeemed('REDEEMED', 'Usados en tu pedido'),
  restored('RESTORED', 'Devueltos'),
  reversed('REVERSED', 'Descontados por un reembolso'),
  adjusted('ADJUSTED', 'Ajuste de la tienda');

  const PointsReason(this.api, this.label);
  final String api;
  final String label;

  static PointsReason fromApi(String value) => values.firstWhere(
    (r) => r.api == value,
    orElse: () => throw FormatException('Motivo de puntos desconocido: $value'),
  );
}

class PointsEntry {
  const PointsEntry({
    required this.id,
    required this.delta,
    required this.reason,
    required this.note,
    required this.createdAt,
    required this.orderId,
    required this.orderNumber,
  });
  factory PointsEntry.fromJson(Json json) {
    final order = json.objOrNull('order');
    return PointsEntry(
      id: json.str('id'),
      delta: json.integer('delta'),
      reason: PointsReason.fromApi(json.str('reason')),
      note: json.strOrNull('note'),
      createdAt: json.date('createdAt'),
      orderId: order?.str('id'),
      orderNumber: order?.integer('number'),
    );
  }
  final String id;

  /// Positivo si suma, negativo si resta.
  final int delta;
  final PointsReason reason;
  final String? note;
  final DateTime createdAt;
  final String? orderId;
  final int? orderNumber;

  /// "PB-000123", como en el resto de la tienda.
  String? get orderCode =>
      orderNumber == null ? null : 'PB-${'$orderNumber'.padLeft(6, '0')}';
}

/// Saldo y una página de movimientos.
class PointsSummary {
  const PointsSummary({
    required this.balance,
    required this.valueUsdCents,
    required this.items,
    required this.total,
    required this.page,
    required this.pageSize,
  });
  factory PointsSummary.fromJson(Json json) => PointsSummary(
    balance: json.integer('balance'),
    valueUsdCents: json.integer('valueUsdCents'),
    items: asList(json['items'], PointsEntry.fromJson),
    total: json.integer('total'),
    page: json.integer('page'),
    pageSize: json.integer('pageSize'),
  );
  static const empty = PointsSummary(
    balance: 0,
    valueUsdCents: 0,
    items: [],
    total: 0,
    page: 1,
    pageSize: 1,
  );
  final int balance;
  final int valueUsdCents;
  final List<PointsEntry> items;
  final int total;
  final int page;
  final int pageSize;

  Page<PointsEntry> get asPage =>
      Page(items: items, total: total, page: page, pageSize: pageSize);
}
