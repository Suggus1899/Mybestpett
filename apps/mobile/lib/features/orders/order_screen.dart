import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/format.dart';
import '../../core/money.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../models/shop.dart';
import '../../widgets/common.dart';
import 'report_payment_form.dart';

class OrderScreen extends ConsumerWidget {
  const OrderScreen({super.key, required this.id, this.now});
  final String id;

  /// Para pruebas: reloj fijo.
  final DateTime Function()? now;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final order = ref.watch(orderProvider(id));
    return Scaffold(
      appBar: AppBar(
        title: Text(
          order.value == null ? 'Pedido' : 'Pedido ${order.value!.code}',
        ),
      ),
      body: switch (order) {
        AsyncData(:final value) => RefreshIndicator(
          onRefresh: () => ref.refresh(orderProvider(id).future),
          child: OrderView(order: value, now: now ?? DateTime.now),
        ),
        AsyncError(:final error) => ErrorView(
          error: error,
          onRetry: () => ref.invalidate(orderProvider(id)),
        ),
        _ => const LoadingView(),
      },
    );
  }
}

class OrderView extends ConsumerStatefulWidget {
  const OrderView({super.key, required this.order, required this.now});
  final Order order;
  final DateTime Function() now;

  @override
  ConsumerState<OrderView> createState() => _OrderViewState();
}

class _OrderViewState extends ConsumerState<OrderView> {
  Timer? _ticker;
  bool _cancelling = false;

  @override
  void initState() {
    super.initState();
    // El contador del plazo de pago se actualiza cada 30 s.
    if (widget.order.canReportPayment) {
      _ticker = Timer.periodic(
        const Duration(seconds: 30),
        (_) => setState(() {}),
      );
    }
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  Future<void> _report() async {
    final reported = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (sheet) => Padding(
        padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(sheet).bottom),
        child: SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Reportar pago',
                style: Theme.of(sheet).textTheme.titleLarge,
              ),
              const SizedBox(height: 12),
              ReportPaymentForm(
                order: widget.order,
                now: widget.now,
                onReported: () => Navigator.pop(sheet, true),
              ),
            ],
          ),
        ),
      ),
    );
    if (reported == true && mounted) {
      showMessage(
        context,
        'Recibimos tu reporte. Te avisaremos cuando el equipo verifique el pago.',
      );
    }
  }

  Future<void> _cancel() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialog) => AlertDialog(
        title: const Text('¿Cancelar este pedido?'),
        content: const Text(
          'Los productos vuelven a la tienda y no podrás reportar el pago.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialog, false),
            child: const Text('No, volver'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: PetbfColors.danger),
            onPressed: () => Navigator.pop(dialog, true),
            child: const Text('Sí, cancelar'),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _cancelling = true);
    try {
      await ref.read(apiProvider).cancelOrder(widget.order.id);
      ref.invalidate(orderProvider(widget.order.id));
      ref.invalidate(ordersProvider);
      if (mounted) showMessage(context, 'Cancelaste el pedido.');
    } catch (e) {
      if (mounted) {
        showMessage(context, messageOf(e));
        ref.invalidate(orderProvider(widget.order.id));
      }
    } finally {
      if (mounted) setState(() => _cancelling = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final o = widget.order;
    final text = Theme.of(context).textTheme;
    final remaining = o.paymentDueAt.difference(widget.now());
    final overdue = o.canReportPayment && remaining.isNegative;
    final lastRejected = o.payments
        .where((p) => p.status == PaymentStatus.rejected)
        .firstOrNull;

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                formatDateTime(o.createdAt),
                style: const TextStyle(color: PetbfColors.slate),
              ),
            ),
            StatusChip(o.status),
          ],
        ),
        const SizedBox(height: 16),
        if (o.canReportPayment) ...[
          Panel(
            color: const Color(0xFFFDE7CC),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Falta tu pago', style: text.titleMedium),
                const SizedBox(height: 6),
                Text.rich(
                  TextSpan(
                    children: [
                      const TextSpan(text: 'Paga '),
                      TextSpan(
                        text: formatMoney(o.totalCharged, o.chargedCurrency),
                        style: const TextStyle(fontWeight: FontWeight.w800),
                      ),
                      TextSpan(text: ' por ${o.paymentMethodName}.'),
                    ],
                  ),
                ),
                const SizedBox(height: 8),
                SelectableText(o.paymentInstructions),
                const SizedBox(height: 4),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    onPressed: () async {
                      await Clipboard.setData(
                        ClipboardData(
                          text: centsToApiAmount(
                            decimalToCents(o.totalCharged),
                          ),
                        ),
                      );
                      if (context.mounted) {
                        showMessage(context, 'Monto copiado.');
                      }
                    },
                    icon: const Icon(Icons.copy, size: 18),
                    label: const Text('Copiar monto'),
                  ),
                ),
                if (lastRejected != null) ...[
                  const SizedBox(height: 4),
                  Text(
                    'Tu reporte anterior fue rechazado'
                    '${lastRejected.rejectionReason == null ? '.' : ': ${lastRejected.rejectionReason}'}',
                    style: const TextStyle(
                      color: PetbfColors.danger,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
                const SizedBox(height: 8),
                Text(
                  overdue
                      ? 'El plazo para reportar el pago venció. El pedido se cancelará.'
                      : 'Te quedan ${formatRemaining(remaining)} para reportarlo '
                            '(hasta las ${formatTime(o.paymentDueAt)}).',
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 12),
                FilledButton(
                  onPressed: overdue ? null : _report,
                  child: const Text('Ya pagué: reportar pago'),
                ),
                TextButton(
                  style: TextButton.styleFrom(
                    foregroundColor: PetbfColors.danger,
                  ),
                  onPressed: _cancelling ? null : _cancel,
                  child: Text(_cancelling ? 'Cancelando…' : 'Cancelar pedido'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
        ],
        if (o.status == OrderStatus.paymentReported) ...[
          const Panel(
            color: PetbfColors.petbfSoft,
            child: Text(
              'Estamos revisando tu pago. Te avisaremos cuando lo verifiquemos.',
            ),
          ),
          const SizedBox(height: 16),
        ],
        if (o.trackingCode != null) ...[
          Panel(
            color: PetbfColors.petbfSoft,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Envío', style: text.titleMedium),
                const SizedBox(height: 4),
                Text('${o.carrier} · Guía '),
                SelectableText(
                  o.trackingCode!,
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
        ],
        Text('Productos', style: text.titleMedium),
        const SizedBox(height: 8),
        for (final item in o.items)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: InkWell(
              onTap: () => context.push('/productos/${item.productSlug}'),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${item.quantity} × ${item.productName}',
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                        Text(
                          item.isReturnable
                              ? item.variantName
                              : '${item.variantName} · sin devolución una vez abierto',
                          style: const TextStyle(
                            fontSize: 13,
                            color: PetbfColors.slate,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Text(formatUsd(item.unitPriceUsdCents * item.quantity)),
                ],
              ),
            ),
          ),
        const Divider(height: 24),
        _Line('Subtotal', formatUsd(o.subtotalUsdCents)),
        _Line(
          'Envío (${o.shippingZoneName})',
          o.shippingUsdCents == 0 ? 'Gratis' : formatUsd(o.shippingUsdCents),
        ),
        _Line('Total', formatUsd(o.totalUsdCents), bold: true),
        _Line(
          'A pagar por ${o.paymentMethodName}',
          formatMoney(o.totalCharged, o.chargedCurrency),
          bold: true,
        ),
        if (o.usdVesRate != null)
          Text(
            'Tasa BCV del pedido: Bs. ${formatCents(decimalToCents(o.usdVesRate!))} por dólar',
            style: const TextStyle(fontSize: 13, color: PetbfColors.slate),
          ),
        const SizedBox(height: 20),
        Text('Entrega', style: text.titleMedium),
        const SizedBox(height: 6),
        Text(
          o.recipientName,
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        Text([o.line1, ?o.municipality, o.city, o.state].join(', ')),
        if (o.referencePoint != null) Text(o.referencePoint!),
        Text(o.phone),
        if (o.payments.isNotEmpty) ...[
          const SizedBox(height: 20),
          Text('Pagos reportados', style: text.titleMedium),
          const SizedBox(height: 6),
          for (final p in o.payments)
            ListTile(
              contentPadding: EdgeInsets.zero,
              title: Text(
                'Ref. ${p.reference} · ${formatMoney(p.amount, p.currency)}',
              ),
              subtitle: Text(
                [
                  formatDateTime(p.paidAt),
                  p.status.label,
                  if (p.rejectionReason != null) p.rejectionReason!,
                ].join(' · '),
              ),
            ),
        ],
        const SizedBox(height: 20),
        Text('Historial', style: text.titleMedium),
        const SizedBox(height: 6),
        for (final h in o.history)
          ListTile(
            contentPadding: EdgeInsets.zero,
            leading: const Icon(
              Icons.circle,
              size: 12,
              color: PetbfColors.petbf,
            ),
            minLeadingWidth: 12,
            title: Text(h.status.label),
            subtitle: Text([formatDateTime(h.createdAt), ?h.note].join(' · ')),
          ),
      ],
    );
  }
}

class _Line extends StatelessWidget {
  const _Line(this.label, this.value, {this.bold = false});
  final String label;
  final String value;
  final bool bold;
  @override
  Widget build(BuildContext context) {
    final style = TextStyle(
      fontWeight: bold ? FontWeight.w800 : FontWeight.w400,
    );
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Expanded(child: Text(label, style: style)),
          Text(value, style: style),
        ],
      ),
    );
  }
}
