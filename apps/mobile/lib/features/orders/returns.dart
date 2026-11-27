import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/format.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/validators.dart';
import '../../models/shop.dart';
import '../../widgets/common.dart';
import '../account/auth_screens.dart';

/// Invita a pedir una devolución mientras el plazo de 3 días siga abierto.
class ReturnPanel extends StatelessWidget {
  const ReturnPanel({super.key, required this.order});
  final Order order;

  Future<void> _open(BuildContext context) async {
    final sent = await showModalBottomSheet<bool>(
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
                'Pedir devolución',
                style: Theme.of(sheet).textTheme.titleLarge,
              ),
              const SizedBox(height: 12),
              ReturnRequestForm(
                order: order,
                onSent: () => Navigator.pop(sheet, true),
              ),
            ],
          ),
        ),
      ),
    );
    if (sent == true && context.mounted) {
      showMessage(
        context,
        'Recibimos tu solicitud. Te avisaremos cuando el equipo la revise.',
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '¿Algo no salió bien?',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 6),
          Text(
            'Puedes pedir una devolución hasta el '
            '${formatDateTime(order.returnUntil!)}. El alimento y los '
            'productos de higiene no se devuelven, y el envío no se '
            'reembolsa. Te devolvemos el dinero por ${order.paymentMethodName}.',
          ),
          const SizedBox(height: 12),
          OutlinedButton(
            onPressed: () => _open(context),
            child: const Text('Pedir devolución'),
          ),
        ],
      ),
    );
  }
}

/// Unidades por producto y motivo. Solo ofrece lo que aún se puede devolver.
class ReturnRequestForm extends ConsumerStatefulWidget {
  const ReturnRequestForm({
    super.key,
    required this.order,
    required this.onSent,
  });
  final Order order;
  final VoidCallback onSent;

  @override
  ConsumerState<ReturnRequestForm> createState() => _ReturnRequestFormState();
}

class _ReturnRequestFormState extends ConsumerState<ReturnRequestForm> {
  final _form = GlobalKey<FormState>();
  final _reason = TextEditingController();
  final _quantities = <String, int>{};
  bool _sending = false;
  String? _error;
  String? _itemsError;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_sending) return;
    final lines = [
      for (final e in _quantities.entries)
        if (e.value > 0) ReturnLine(orderItemId: e.key, quantity: e.value),
    ];
    setState(() {
      _error = null;
      _itemsError = lines.isEmpty ? 'Elige al menos un producto' : null;
    });
    final valid = _form.currentState!.validate();
    if (!valid || lines.isEmpty) return;

    setState(() => _sending = true);
    try {
      await ref
          .read(apiProvider)
          .requestReturn(widget.order.id, reason: _reason.text, items: lines);
      ref.invalidate(orderProvider(widget.order.id));
      widget.onSent();
    } catch (e) {
      if (mounted) setState(() => _error = messageOf(e));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final lines = widget.order.returnableLeft;
    // Con combos o cupón se devuelve lo pagado, no el precio de lista.
    final refund = widget.order.refundFor(
      [
        for (final l in lines)
          l.item.unitPriceUsdCents * (_quantities[l.item.id] ?? 0),
      ].fold(0, (a, b) => a + b),
    );
    return Form(
      key: _form,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_error != null) ...[
            FormErrorBanner(_error!),
            const SizedBox(height: 14),
          ],
          Text(
            '¿Qué quieres devolver?',
            style: Theme.of(context).textTheme.titleSmall,
          ),
          const SizedBox(height: 8),
          for (final l in lines)
            Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          l.item.productName,
                          style: const TextStyle(fontWeight: FontWeight.w700),
                        ),
                        Text(
                          '${l.item.variantName} · puedes devolver ${l.left}',
                          style: const TextStyle(
                            fontSize: 13,
                            color: PetbfColors.slate,
                          ),
                        ),
                      ],
                    ),
                  ),
                  QuantityStepper(
                    value: _quantities[l.item.id] ?? 0,
                    min: 0,
                    max: l.left,
                    label: 'Unidades de ${l.item.productName}',
                    onChanged: (v) => setState(() {
                      _quantities[l.item.id] = v;
                      _itemsError = null;
                    }),
                  ),
                ],
              ),
            ),
          if (_itemsError != null)
            Text(
              _itemsError!,
              style: const TextStyle(color: PetbfColors.danger),
            ),
          const SizedBox(height: 12),
          TextFormField(
            controller: _reason,
            maxLines: 3,
            maxLength: 500,
            validator: validateReturnReason,
            decoration: const InputDecoration(
              labelText: 'Motivo',
              hintText: 'Cuéntanos qué pasó con el producto',
            ),
          ),
          if (refund > 0) ...[
            const SizedBox(height: 6),
            Text(
              'Te devolveremos el equivalente a ${formatUsd(refund)} por '
              '${widget.order.paymentMethodName}, con la tasa del pedido.',
              style: const TextStyle(color: PetbfColors.slate),
            ),
          ],
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _sending ? null : _submit,
            child: Text(_sending ? 'Enviando…' : 'Enviar solicitud'),
          ),
        ],
      ),
    );
  }
}

/// Devoluciones del pedido con su estado, monto y reembolso.
class ReturnsList extends StatelessWidget {
  const ReturnsList({super.key, required this.order});
  final Order order;

  @override
  Widget build(BuildContext context) {
    String name(String id) =>
        order.items.where((i) => i.id == id).firstOrNull?.productName ??
        'Producto';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Devoluciones', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 6),
        for (final r in order.returns)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${r.status.label} · ${formatMoney(r.refundAmount, r.currency)}',
                  style: const TextStyle(fontWeight: FontWeight.w800),
                ),
                Text(
                  r.items
                      .map((l) => '${l.quantity} × ${name(l.orderItemId)}')
                      .join(', '),
                ),
                Text(
                  'Motivo: ${r.reason}',
                  style: const TextStyle(color: PetbfColors.slate),
                ),
                if (r.decisionNote != null)
                  Text(
                    r.decisionNote!,
                    style: TextStyle(
                      color: r.status == ReturnStatus.rejected
                          ? PetbfColors.danger
                          : PetbfColors.slate,
                      fontWeight: r.status == ReturnStatus.rejected
                          ? FontWeight.w700
                          : FontWeight.w400,
                    ),
                  ),
                if (r.refundedAt != null)
                  Text(
                    'Reembolsado el ${formatDateTime(r.refundedAt!)}'
                    '${r.refundReference == null ? '' : ' · Ref. ${r.refundReference}'}',
                    style: const TextStyle(color: PetbfColors.slate),
                  ),
              ],
            ),
          ),
      ],
    );
  }
}
