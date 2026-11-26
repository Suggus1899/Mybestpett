import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/money.dart';
import '../../core/proof.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/validators.dart';
import '../../models/shop.dart';
import '../../widgets/common.dart';
import '../account/auth_screens.dart';
import 'payment_proof.dart';

const reportedMessage =
    'Recibimos tu reporte. Te avisaremos cuando el equipo verifique el pago.';

/// Reporte del pago: el cliente dice qué pagó y el equipo lo verifica con el banco.
class ReportPaymentForm extends ConsumerStatefulWidget {
  const ReportPaymentForm({
    super.key,
    required this.order,
    required this.onReported,
  });
  final Order order;

  /// Recibe el mensaje para la persona (avisa si el comprobante no subió).
  final ValueChanged<String> onReported;

  @override
  ConsumerState<ReportPaymentForm> createState() => _ReportPaymentFormState();
}

class _ReportPaymentFormState extends ConsumerState<ReportPaymentForm> {
  final _form = GlobalKey<FormState>();
  final _reference = TextEditingController();
  late final _amount = TextEditingController(
    text: widget.order.totalCharged.replaceAll('.', ','),
  );
  final _bank = TextEditingController();
  late DateTime _paidAt = _now();
  PickedProof? _proof;
  bool _sending = false;
  String? _error;
  String? _dateError;

  DateTime _now() => ref.read(clockProvider)();

  @override
  void dispose() {
    _reference.dispose();
    _amount.dispose();
    _bank.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final now = _now();
    final created = widget.order.createdAt.toLocal();
    final first = DateTime(created.year, created.month, created.day);
    final last = DateTime(now.year, now.month, now.day);
    final picked = await showDatePicker(
      context: context,
      initialDate: _paidAt.isBefore(first) ? first : _paidAt,
      firstDate: first,
      lastDate: last.isBefore(first) ? first : last,
      helpText: 'Día del pago',
    );
    if (picked == null) return;
    setState(() {
      _paidAt = DateTime(
        picked.year,
        picked.month,
        picked.day,
        _paidAt.hour,
        _paidAt.minute,
      );
      _dateError = null;
    });
  }

  Future<void> _pickTime() async {
    final picked = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(_paidAt),
      helpText: 'Hora del pago',
    );
    if (picked == null) return;
    setState(() {
      _paidAt = DateTime(
        _paidAt.year,
        _paidAt.month,
        _paidAt.day,
        picked.hour,
        picked.minute,
      );
      _dateError = null;
    });
  }

  Future<void> _submit() async {
    if (_sending) return;
    final dateError = validatePaidAt(
      _paidAt,
      orderCreatedAt: widget.order.createdAt,
      now: _now(),
    );
    setState(() {
      _error = null;
      _dateError = dateError;
    });
    final valid = _form.currentState!.validate();
    if (!valid || dateError != null) return;

    setState(() => _sending = true);
    try {
      final api = ref.read(apiProvider);
      final order = await api.reportPayment(
        widget.order.id,
        PaymentInput(
          reference: normalizeReference(_reference.text),
          amount: normalizeAmount(_amount.text)!,
          paidAt: _paidAt,
          originBank: _bank.text,
        ),
      );
      var message = reportedMessage;
      final proof = _proof;
      final payment = order.payments
          .where((p) => p.status == PaymentStatus.reported)
          .firstOrNull;
      if (proof != null && payment != null) {
        try {
          await api.attachProof(order.id, payment.id, proof);
        } on ApiException catch (e) {
          // El pago ya quedó reportado: solo falta el archivo.
          message =
              'Recibimos tu reporte, pero el comprobante no subió: '
              '${e.message} Puedes adjuntarlo desde el pedido.';
        }
      }
      ref.invalidate(orderProvider(widget.order.id));
      ref.invalidate(ordersProvider);
      widget.onReported(message);
    } catch (e) {
      if (mounted) setState(() => _error = messageOf(e));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final o = widget.order;
    return Form(
      key: _form,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Debes pagar ${formatMoney(o.totalCharged, o.chargedCurrency)} por ${o.paymentMethodName}.',
          ),
          const SizedBox(height: 16),
          if (_error != null) ...[
            FormErrorBanner(_error!),
            const SizedBox(height: 14),
          ],
          TextFormField(
            controller: _reference,
            textCapitalization: TextCapitalization.characters,
            autocorrect: false,
            maxLength: 60,
            inputFormatters: [
              FilteringTextInputFormatter.allow(RegExp(r'[A-Za-z0-9\s-]')),
            ],
            validator: validateReference,
            decoration: const InputDecoration(
              labelText: 'Número de referencia',
              helperText: 'Tal como aparece en tu comprobante',
              counterText: '',
            ),
          ),
          const SizedBox(height: 14),
          TextFormField(
            controller: _amount,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: [
              FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
            ],
            validator: validateAmount,
            decoration: InputDecoration(
              labelText: 'Monto pagado',
              prefixText: switch (o.chargedCurrency) {
                Currency.usd => '\$ ',
                Currency.ves => 'Bs. ',
                Currency.eur => '€ ',
                Currency.usdt => 'USDT ',
              },
            ),
          ),
          const SizedBox(height: 14),
          TextFormField(
            controller: _bank,
            textCapitalization: TextCapitalization.words,
            maxLength: 80,
            validator: optionalText(80),
            decoration: const InputDecoration(
              labelText: 'Banco de origen (opcional)',
              counterText: '',
            ),
          ),
          const SizedBox(height: 14),
          Text(
            'Fecha y hora del pago',
            style: Theme.of(context).textTheme.titleSmall,
          ),
          const SizedBox(height: 6),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _pickDate,
                  icon: const Icon(Icons.calendar_today, size: 18),
                  label: const Text('Cambiar día'),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _pickTime,
                  icon: const Icon(Icons.schedule, size: 18),
                  label: const Text('Cambiar hora'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            formatLocalDateTime(_paidAt),
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
          if (_dateError != null)
            Text(
              _dateError!,
              style: const TextStyle(color: PetbfColors.danger),
            ),
          const SizedBox(height: 14),
          Text(
            'Comprobante (opcional)',
            style: Theme.of(context).textTheme.titleSmall,
          ),
          const Text(
            'Captura o PDF del pago, hasta 5 MB. Ayuda a verificarlo más rápido.',
            style: TextStyle(fontSize: 13, color: PetbfColors.slate),
          ),
          const SizedBox(height: 6),
          if (_proof == null)
            OutlinedButton.icon(
              onPressed: _sending
                  ? null
                  : () async {
                      final proof = await pickProof(context, ref);
                      if (proof != null && mounted) {
                        setState(() => _proof = proof);
                      }
                    },
              icon: const Icon(Icons.attach_file, size: 18),
              label: const Text('Adjuntar comprobante'),
            )
          else
            Row(
              children: [
                const Icon(Icons.description_outlined, size: 20),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    '${_proof!.name} · ${formatBytes(_proof!.bytes.length)}',
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                IconButton(
                  tooltip: 'Quitar comprobante',
                  onPressed: _sending
                      ? null
                      : () => setState(() => _proof = null),
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: _sending ? null : _submit,
            child: Text(_sending ? 'Enviando…' : 'Reportar pago'),
          ),
        ],
      ),
    );
  }
}
