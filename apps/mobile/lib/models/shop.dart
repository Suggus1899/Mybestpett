import '../core/money.dart';
import 'catalog.dart';
import 'json.dart';

class User {
  const User({
    required this.id,
    required this.email,
    required this.firstName,
    required this.lastName,
    required this.phone,
    required this.roles,
  });
  factory User.fromJson(Json json) => User(
    id: json.str('id'),
    email: json.str('email'),
    firstName: json.str('firstName'),
    lastName: json.str('lastName'),
    phone: json.strOrNull('phone'),
    roles: json.strings('roles'),
  );
  final String id;
  final String email;
  final String firstName;
  final String lastName;
  final String? phone;
  final List<String> roles;

  String get fullName => '$firstName $lastName';
}

/// Por qué una línea del carrito no se puede comprar tal como está.
enum CartIssue { unavailable, insufficientStock }

class CartItem {
  const CartItem({
    required this.variantId,
    required this.variantName,
    required this.productName,
    required this.productSlug,
    required this.image,
    required this.unitPriceUsdCents,
    required this.quantity,
    required this.lineTotalUsdCents,
    required this.issue,
    required this.available,
  });

  factory CartItem.fromJson(Json json) {
    final product = json.obj('product');
    return CartItem(
      variantId: json.str('variantId'),
      variantName: json.str('name'),
      productName: product.str('name'),
      productSlug: product.str('slug'),
      image: product.objOrNull('image') == null
          ? null
          : ImageRef.fromJson(product.obj('image')),
      unitPriceUsdCents: json.integer('unitPriceUsdCents'),
      quantity: json.integer('quantity'),
      lineTotalUsdCents: json.integer('lineTotalUsdCents'),
      issue: switch (json.strOrNull('issue')) {
        null => null,
        'unavailable' => CartIssue.unavailable,
        'insufficient_stock' => CartIssue.insufficientStock,
        final other => throw FormatException('Problema desconocido: $other'),
      },
      available: json.integer('available'),
    );
  }

  final String variantId;
  final String variantName;
  final String productName;
  final String productSlug;
  final ImageRef? image;
  final int unitPriceUsdCents;
  final int quantity;
  final int lineTotalUsdCents;
  final CartIssue? issue;

  /// Lo máximo que se puede pedir de esta presentación ahora mismo.
  final int available;
}

class Cart {
  const Cart({
    required this.items,
    required this.itemCount,
    required this.subtotalUsdCents,
    required this.canCheckout,
  });
  factory Cart.fromJson(Json json) => Cart(
    items: asList(json['items'], CartItem.fromJson),
    itemCount: json.integer('itemCount'),
    subtotalUsdCents: json.integer('subtotalUsdCents'),
    canCheckout: json.boolean('canCheckout'),
  );
  static const empty = Cart(
    items: [],
    itemCount: 0,
    subtotalUsdCents: 0,
    canCheckout: false,
  );
  final List<CartItem> items;
  final int itemCount;
  final int subtotalUsdCents;
  final bool canCheckout;
}

class Address {
  const Address({
    required this.id,
    required this.recipientName,
    required this.phone,
    required this.state,
    required this.city,
    required this.municipality,
    required this.line1,
    required this.referencePoint,
    required this.isDefault,
  });
  factory Address.fromJson(Json json) => Address(
    id: json.str('id'),
    recipientName: json.str('recipientName'),
    phone: json.str('phone'),
    state: json.str('state'),
    city: json.str('city'),
    municipality: json.strOrNull('municipality'),
    line1: json.str('line1'),
    referencePoint: json.strOrNull('referencePoint'),
    isDefault: json.boolean('isDefault'),
  );
  final String id;
  final String recipientName;
  final String phone;
  final String state;
  final String city;
  final String? municipality;
  final String line1;
  final String? referencePoint;
  final bool isDefault;

  String get summary => [line1, ?municipality, city, state].join(', ');
}

/// Datos de una dirección para crearla o editarla.
class AddressInput {
  const AddressInput({
    required this.recipientName,
    required this.phone,
    required this.state,
    required this.city,
    required this.municipality,
    required this.line1,
    required this.referencePoint,
    required this.isDefault,
  });
  final String recipientName;
  final String phone;
  final String state;
  final String city;
  final String municipality;
  final String line1;
  final String referencePoint;
  final bool isDefault;

  // Los opcionales vacíos van como cadena vacía: la API los guarda como null.
  Json toJson() => {
    'recipientName': recipientName.trim(),
    'phone': phone.trim(),
    'state': state,
    'city': city.trim(),
    'municipality': municipality.trim(),
    'line1': line1.trim(),
    'referencePoint': referencePoint.trim(),
    'isDefault': isDefault,
  };
}

class ShippingZone {
  const ShippingZone({
    required this.id,
    required this.name,
    required this.states,
    required this.carrier,
    required this.priceUsdCents,
    required this.freeOverUsdCents,
  });
  factory ShippingZone.fromJson(Json json) => ShippingZone(
    id: json.str('id'),
    name: json.str('name'),
    states: json.strings('states'),
    carrier: json.str('carrier'),
    priceUsdCents: json.integer('priceUsdCents'),
    freeOverUsdCents: json.intOrNull('freeOverUsdCents'),
  );
  final String id;
  final String name;
  final List<String> states;
  final String carrier;
  final int priceUsdCents;
  final int? freeOverUsdCents;

  int costFor(int subtotalUsdCents) => shippingCostCents(
    subtotalUsdCents,
    priceUsdCents: priceUsdCents,
    freeOverUsdCents: freeOverUsdCents,
  );
}

class PaymentMethod {
  const PaymentMethod({
    required this.id,
    required this.code,
    required this.name,
    required this.currency,
    required this.instructions,
  });
  factory PaymentMethod.fromJson(Json json) => PaymentMethod(
    id: json.str('id'),
    code: json.str('code'),
    name: json.str('name'),
    currency: currencyFromApi(json.str('currency')),
    instructions: json.str('instructions'),
  );
  final String id;
  final String code;
  final String name;
  final Currency currency;
  final String instructions;
}

enum OrderStatus {
  pendingPayment,
  paymentReported,
  paid,
  preparing,
  shipped,
  delivered,
  cancelled,
  refunded,
}

OrderStatus orderStatusFromApi(String value) => switch (value) {
  'PENDING_PAYMENT' => OrderStatus.pendingPayment,
  'PAYMENT_REPORTED' => OrderStatus.paymentReported,
  'PAID' => OrderStatus.paid,
  'PREPARING' => OrderStatus.preparing,
  'SHIPPED' => OrderStatus.shipped,
  'DELIVERED' => OrderStatus.delivered,
  'CANCELLED' => OrderStatus.cancelled,
  'REFUNDED' => OrderStatus.refunded,
  _ => throw FormatException('Estado de pedido desconocido: $value'),
};

extension OrderStatusLabel on OrderStatus {
  /// Mismos textos que la web.
  String get label => switch (this) {
    OrderStatus.pendingPayment => 'Esperando el pago',
    OrderStatus.paymentReported => 'Pago en revisión',
    OrderStatus.paid => 'Pagado',
    OrderStatus.preparing => 'En preparación',
    OrderStatus.shipped => 'Enviado',
    OrderStatus.delivered => 'Entregado',
    OrderStatus.cancelled => 'Cancelado',
    OrderStatus.refunded => 'Reembolsado',
  };
}

enum PaymentStatus { reported, verified, rejected }

extension PaymentStatusLabel on PaymentStatus {
  String get label => switch (this) {
    PaymentStatus.reported => 'En revisión',
    PaymentStatus.verified => 'Verificado',
    PaymentStatus.rejected => 'Rechazado',
  };
}

class OrderSummary {
  const OrderSummary({
    required this.id,
    required this.code,
    required this.status,
    required this.totalUsdCents,
    required this.totalCharged,
    required this.chargedCurrency,
    required this.paymentDueAt,
    required this.createdAt,
    required this.itemCount,
  });
  factory OrderSummary.fromJson(Json json) => OrderSummary(
    id: json.str('id'),
    code: json.str('code'),
    status: orderStatusFromApi(json.str('status')),
    totalUsdCents: json.integer('totalUsdCents'),
    totalCharged: json.decimal('totalCharged'),
    chargedCurrency: currencyFromApi(json.str('chargedCurrency')),
    paymentDueAt: json.date('paymentDueAt'),
    createdAt: json.date('createdAt'),
    itemCount: json.obj('_count').integer('items'),
  );
  final String id;
  final String code;
  final OrderStatus status;
  final int totalUsdCents;
  final String totalCharged;
  final Currency chargedCurrency;
  final DateTime paymentDueAt;
  final DateTime createdAt;
  final int itemCount;
}

class OrderItem {
  const OrderItem({
    required this.id,
    required this.productName,
    required this.productSlug,
    required this.variantName,
    required this.unitPriceUsdCents,
    required this.quantity,
    required this.isReturnable,
  });
  factory OrderItem.fromJson(Json json) => OrderItem(
    id: json.str('id'),
    productName: json.str('productName'),
    productSlug: json.str('productSlug'),
    variantName: json.str('variantName'),
    unitPriceUsdCents: json.integer('unitPriceUsdCents'),
    quantity: json.integer('quantity'),
    isReturnable: json.boolean('isReturnable'),
  );
  final String id;
  final String productName;
  final String productSlug;
  final String variantName;
  final int unitPriceUsdCents;
  final int quantity;
  final bool isReturnable;
}

class PaymentReport {
  const PaymentReport({
    required this.id,
    required this.reference,
    required this.amount,
    required this.currency,
    required this.paidAt,
    required this.status,
    required this.rejectionReason,
    required this.createdAt,
    this.proof,
  });
  factory PaymentReport.fromJson(Json json) => PaymentReport(
    id: json.str('id'),
    reference: json.str('reference'),
    amount: json.decimal('amount'),
    currency: currencyFromApi(json.str('currency')),
    paidAt: json.date('paidAt'),
    status: switch (json.str('status')) {
      'REPORTED' => PaymentStatus.reported,
      'VERIFIED' => PaymentStatus.verified,
      'REJECTED' => PaymentStatus.rejected,
      final other => throw FormatException(
        'Estado de pago desconocido: $other',
      ),
    },
    rejectionReason: json.strOrNull('rejectionReason'),
    createdAt: json.date('createdAt'),
    proof: switch (json.objOrNull('proof')) {
      final Json p => ProofInfo.fromJson(p),
      null => null,
    },
  );
  final String id;
  final String reference;
  final String amount;
  final Currency currency;
  final DateTime paidAt;
  final PaymentStatus status;
  final String? rejectionReason;
  final DateTime createdAt;

  /// Comprobante adjunto (solo sus datos; el archivo se pide aparte).
  final ProofInfo? proof;
}

/// Datos del comprobante de un pago.
class ProofInfo {
  const ProofInfo({
    required this.contentType,
    required this.sizeBytes,
    required this.createdAt,
  });
  factory ProofInfo.fromJson(Json json) => ProofInfo(
    contentType: json.str('contentType'),
    sizeBytes: json.integer('sizeBytes'),
    createdAt: json.date('createdAt'),
  );
  final String contentType;
  final int sizeBytes;
  final DateTime createdAt;

  bool get isImage => contentType.startsWith('image/');

  /// "JPG", "PNG", "WEBP" o "PDF".
  String get label => switch (contentType) {
    'image/jpeg' => 'JPG',
    'image/png' => 'PNG',
    'image/webp' => 'WEBP',
    'application/pdf' => 'PDF',
    _ => 'Archivo',
  };
}

enum ReturnStatus { requested, approved, rejected, refunded }

extension ReturnStatusLabel on ReturnStatus {
  String get label => switch (this) {
    ReturnStatus.requested => 'En revisión',
    ReturnStatus.approved => 'Aprobada',
    ReturnStatus.rejected => 'Rechazada',
    ReturnStatus.refunded => 'Reembolsada',
  };

  /// Una devolución abierta impide pedir otra del mismo pedido.
  bool get isOpen =>
      this == ReturnStatus.requested || this == ReturnStatus.approved;
}

/// Unidades de un producto del pedido incluidas en una devolución.
class ReturnLine {
  const ReturnLine({required this.orderItemId, required this.quantity});
  factory ReturnLine.fromJson(Json json) => ReturnLine(
    orderItemId: json.str('orderItemId'),
    quantity: json.integer('quantity'),
  );
  final String orderItemId;
  final int quantity;

  Json toJson() => {'orderItemId': orderItemId, 'quantity': quantity};
}

class ReturnRequest {
  const ReturnRequest({
    required this.id,
    required this.status,
    required this.reason,
    required this.refundUsdCents,
    required this.currency,
    required this.refundAmount,
    required this.decisionNote,
    required this.refundReference,
    required this.refundedAt,
    required this.createdAt,
    required this.items,
  });
  factory ReturnRequest.fromJson(Json json) => ReturnRequest(
    id: json.str('id'),
    status: switch (json.str('status')) {
      'REQUESTED' => ReturnStatus.requested,
      'APPROVED' => ReturnStatus.approved,
      'REJECTED' => ReturnStatus.rejected,
      'REFUNDED' => ReturnStatus.refunded,
      final other => throw FormatException(
        'Estado de devolución desconocido: $other',
      ),
    },
    reason: json.str('reason'),
    refundUsdCents: json.integer('refundUsdCents'),
    currency: currencyFromApi(json.str('currency')),
    refundAmount: json.decimal('refundAmount'),
    decisionNote: json.strOrNull('decisionNote'),
    refundReference: json.strOrNull('refundReference'),
    refundedAt: json.dateOrNull('refundedAt'),
    createdAt: json.date('createdAt'),
    items: asList(json['items'], ReturnLine.fromJson),
  );
  final String id;
  final ReturnStatus status;
  final String reason;
  final int refundUsdCents;
  final Currency currency;
  final String refundAmount;
  final String? decisionNote;
  final String? refundReference;
  final DateTime? refundedAt;
  final DateTime createdAt;
  final List<ReturnLine> items;
}

/// Un producto del pedido que todavía se puede devolver, y cuántas unidades.
class ReturnableLine {
  const ReturnableLine(this.item, this.left);
  final OrderItem item;
  final int left;
}

class StatusChange {
  const StatusChange({
    required this.status,
    required this.note,
    required this.createdAt,
  });
  factory StatusChange.fromJson(Json json) => StatusChange(
    status: orderStatusFromApi(json.str('toStatus')),
    note: json.strOrNull('note'),
    createdAt: json.date('createdAt'),
  );
  final OrderStatus status;
  final String? note;
  final DateTime createdAt;
}

class Order {
  const Order({
    required this.id,
    required this.code,
    required this.status,
    required this.chargedCurrency,
    required this.usdVesRate,
    required this.subtotalUsdCents,
    required this.shippingUsdCents,
    required this.totalUsdCents,
    required this.totalCharged,
    required this.recipientName,
    required this.phone,
    required this.state,
    required this.city,
    required this.municipality,
    required this.line1,
    required this.referencePoint,
    required this.shippingZoneName,
    required this.carrier,
    required this.trackingCode,
    required this.paymentDueAt,
    required this.createdAt,
    required this.items,
    required this.paymentMethodName,
    required this.paymentInstructions,
    required this.payments,
    required this.history,
    this.returns = const [],
    this.returnUntil,
  });

  factory Order.fromJson(Json json) {
    final method = json.obj('paymentMethod');
    return Order(
      id: json.str('id'),
      code: json.str('code'),
      status: orderStatusFromApi(json.str('status')),
      chargedCurrency: currencyFromApi(json.str('chargedCurrency')),
      usdVesRate: json.decimalOrNull('usdVesRate'),
      subtotalUsdCents: json.integer('subtotalUsdCents'),
      shippingUsdCents: json.integer('shippingUsdCents'),
      totalUsdCents: json.integer('totalUsdCents'),
      totalCharged: json.decimal('totalCharged'),
      recipientName: json.str('recipientName'),
      phone: json.str('phone'),
      state: json.str('state'),
      city: json.str('city'),
      municipality: json.strOrNull('municipality'),
      line1: json.str('line1'),
      referencePoint: json.strOrNull('referencePoint'),
      shippingZoneName: json.str('shippingZoneName'),
      carrier: json.str('carrier'),
      trackingCode: json.strOrNull('trackingCode'),
      paymentDueAt: json.date('paymentDueAt'),
      createdAt: json.date('createdAt'),
      items: asList(json['items'], OrderItem.fromJson),
      paymentMethodName: method.str('name'),
      paymentInstructions: method.str('instructions'),
      payments: asList(json['payments'], PaymentReport.fromJson),
      history: asList(json['history'], StatusChange.fromJson),
      returns: asList(json['returns'] ?? const [], ReturnRequest.fromJson),
      returnUntil: json.dateOrNull('returnUntil'),
    );
  }

  final String id;
  final String code;
  final OrderStatus status;
  final Currency chargedCurrency;
  final String? usdVesRate;
  final int subtotalUsdCents;
  final int shippingUsdCents;
  final int totalUsdCents;

  /// Monto exacto a pagar en [chargedCurrency], congelado al crear el pedido.
  final String totalCharged;
  final String recipientName;
  final String phone;
  final String state;
  final String city;
  final String? municipality;
  final String line1;
  final String? referencePoint;
  final String shippingZoneName;
  final String carrier;
  final String? trackingCode;
  final DateTime paymentDueAt;
  final DateTime createdAt;
  final List<OrderItem> items;
  final String paymentMethodName;
  final String paymentInstructions;
  final List<PaymentReport> payments;
  final List<StatusChange> history;
  final List<ReturnRequest> returns;

  /// Hasta cuándo se puede pedir una devolución (3 días desde la entrega).
  final DateTime? returnUntil;

  bool get canReportPayment => status == OrderStatus.pendingPayment;
  bool get canCancel => status == OrderStatus.pendingPayment;

  /// Productos devolvibles con las unidades que no están ya en otra
  /// devolución (las rechazadas no cuentan), como calcula la API.
  List<ReturnableLine> get returnableLeft {
    final taken = <String, int>{};
    for (final r in returns) {
      if (r.status == ReturnStatus.rejected) continue;
      for (final line in r.items) {
        taken[line.orderItemId] =
            (taken[line.orderItemId] ?? 0) + line.quantity;
      }
    }
    return [
      for (final item in items)
        if (item.isReturnable && item.quantity - (taken[item.id] ?? 0) > 0)
          ReturnableLine(item, item.quantity - (taken[item.id] ?? 0)),
    ];
  }

  /// Dentro del plazo, sin otra devolución abierta y con algo por devolver.
  bool canRequestReturn(DateTime now) =>
      returnUntil != null &&
      returnUntil!.isAfter(now) &&
      !returns.any((r) => r.status.isOpen) &&
      returnableLeft.isNotEmpty;
}

/// Lo que el cliente declara haber pagado.
class PaymentInput {
  const PaymentInput({
    required this.reference,
    required this.amount,
    required this.paidAt,
    this.originBank,
  });
  final String reference;
  final String amount;
  final DateTime paidAt;
  final String? originBank;

  Json toJson() => {
    'reference': reference,
    'amount': amount,
    'paidAt': paidAt.toUtc().toIso8601String(),
    if (originBank != null && originBank!.trim().isNotEmpty)
      'originBank': originBank!.trim(),
  };
}
