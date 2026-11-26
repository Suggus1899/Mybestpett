import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/format.dart';
import '../../core/proof.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../models/shop.dart';
import '../../widgets/common.dart';

/// Pide un archivo a la persona y lo valida. null si cancela o no sirve (y
/// en ese caso ya mostró el motivo).
Future<PickedProof?> pickProof(BuildContext context, WidgetRef ref) async {
  try {
    return await ref.read(proofPickerProvider).pick();
  } on ProofError catch (e) {
    if (context.mounted) showMessage(context, e.message);
    return null;
  }
}

/// Un pago reportado, con su comprobante. Mientras está en revisión se puede
/// adjuntar o reemplazar.
class PaymentTile extends ConsumerStatefulWidget {
  const PaymentTile({super.key, required this.order, required this.payment});
  final Order order;
  final PaymentReport payment;

  @override
  ConsumerState<PaymentTile> createState() => _PaymentTileState();
}

class _PaymentTileState extends ConsumerState<PaymentTile> {
  bool _uploading = false;

  Future<void> _attach() async {
    final proof = await pickProof(context, ref);
    if (proof == null || !mounted) return;
    setState(() => _uploading = true);
    try {
      await ref
          .read(apiProvider)
          .attachProof(widget.order.id, widget.payment.id, proof);
      ref.invalidate(orderProvider(widget.order.id));
      if (mounted) showMessage(context, 'Comprobante adjuntado.');
    } catch (e) {
      if (mounted) showMessage(context, messageOf(e));
    } finally {
      if (mounted) setState(() => _uploading = false);
    }
  }

  Future<void> _view() async {
    final file = ref
        .read(apiProvider)
        .proofFile(widget.order.id, widget.payment.id);
    await showDialog<void>(
      context: context,
      builder: (dialog) => Dialog(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              FutureBuilder(
                future: file,
                builder: (context, snap) => switch (snap) {
                  AsyncSnapshot(:final data?) => InteractiveViewer(
                    child: Image.memory(
                      data,
                      semanticLabel: 'Comprobante del pago',
                      errorBuilder: (_, _, _) =>
                          const Text('No se pudo mostrar la imagen.'),
                    ),
                  ),
                  AsyncSnapshot(:final error?) => Padding(
                    padding: const EdgeInsets.all(16),
                    child: Text(messageOf(error)),
                  ),
                  _ => const Padding(
                    padding: EdgeInsets.all(32),
                    child: CircularProgressIndicator(),
                  ),
                },
              ),
              TextButton(
                onPressed: () => Navigator.pop(dialog),
                child: const Text('Cerrar'),
              ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.payment;
    final proof = p.proof;
    final rejected = p.status == PaymentStatus.rejected;
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Ref. ${p.reference} · ${formatMoney(p.amount, p.currency)}',
            style: const TextStyle(fontWeight: FontWeight.w700),
          ),
          Text(
            [
              formatDateTime(p.paidAt),
              p.status.label,
              ?p.rejectionReason,
            ].join(' · '),
            style: TextStyle(
              color: rejected ? PetbfColors.danger : PetbfColors.slate,
            ),
          ),
          Text(
            proof == null
                ? 'Sin comprobante'
                : 'Comprobante ${proof.label} · ${formatBytes(proof.sizeBytes)}',
            style: const TextStyle(fontSize: 13, color: PetbfColors.slate),
          ),
          Wrap(
            spacing: 4,
            children: [
              if (proof != null && proof.isImage)
                TextButton(
                  onPressed: _view,
                  child: const Text('Ver comprobante'),
                ),
              if (p.status == PaymentStatus.reported)
                TextButton.icon(
                  onPressed: _uploading ? null : _attach,
                  icon: const Icon(Icons.attach_file, size: 18),
                  label: Text(
                    _uploading
                        ? 'Subiendo…'
                        : proof == null
                        ? 'Adjuntar comprobante'
                        : 'Reemplazar comprobante',
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
