import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/format.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../models/shop.dart';
import '../../widgets/common.dart';

/// Productos que se usan juntos a un precio menor que por separado.
class CombosScreen extends ConsumerWidget {
  const CombosScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final combos = ref.watch(combosProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Combos')),
      body: switch (combos) {
        AsyncData(:final value) when value.isEmpty => const EmptyView(
          icon: Icons.inventory_2_outlined,
          title: 'Por ahora no hay combos',
          message: 'Vuelve pronto.',
        ),
        AsyncData(:final value) => RefreshIndicator(
          onRefresh: () => ref.refresh(combosProvider.future),
          child: ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: value.length + 1,
            separatorBuilder: (_, _) => const SizedBox(height: 12),
            itemBuilder: (_, i) => i == 0
                ? const Text(
                    'Al añadir un combo entran todos sus productos al carrito. '
                    'El descuento se aplica solo por cada combo completo.',
                    style: TextStyle(color: PetbfColors.slate),
                  )
                : ComboCard(combo: value[i - 1]),
          ),
        ),
        AsyncError(:final error) => ErrorView(
          error: error,
          onRetry: () => ref.invalidate(combosProvider),
        ),
        _ => const LoadingView(),
      },
    );
  }
}

class ComboCard extends ConsumerStatefulWidget {
  const ComboCard({super.key, required this.combo});
  final Combo combo;

  @override
  ConsumerState<ComboCard> createState() => _ComboCardState();
}

class _ComboCardState extends ConsumerState<ComboCard> {
  int _qty = 1;
  bool _adding = false;

  Future<void> _add() async {
    if (_adding) return;
    final combo = widget.combo;
    if (!isSignedIn(ref.read(sessionProvider))) {
      await context.push(
        Uri(path: '/entrar', queryParameters: {'next': '/combos'}).toString(),
      );
      return;
    }
    setState(() => _adding = true);
    try {
      await ref.read(cartProvider.notifier).addCombo(combo.slug, _qty);
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            content: Text(
              _qty == 1
                  ? 'Añadiste el combo ${combo.name} al carrito.'
                  : 'Añadiste $_qty × el combo ${combo.name} al carrito.',
            ),
            action: SnackBarAction(
              label: 'Ver carrito',
              textColor: PetbfColors.amber,
              onPressed: () => context.go('/carrito'),
            ),
          ),
        );
      setState(() => _qty = 1);
    } catch (e) {
      if (mounted) {
        showMessage(context, messageOf(e));
        // El stock pudo cambiar: se recarga para mostrar lo real.
        ref.invalidate(combosProvider);
      }
    } finally {
      if (mounted) setState(() => _adding = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.combo;
    final max = c.maxToAdd;
    final qty = _qty > max && max > 0 ? max : _qty;
    return Panel(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(c.name, style: Theme.of(context).textTheme.titleLarge),
          if (c.description.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              c.description,
              style: const TextStyle(color: PetbfColors.slate),
            ),
          ],
          const SizedBox(height: 10),
          for (final i in c.items)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 2),
              child: InkWell(
                onTap: () => context.push('/productos/${i.productSlug}'),
                child: Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(
                        text: '${i.quantity} × ${i.productName}',
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                      TextSpan(
                        text: ' (${i.variantName})',
                        style: const TextStyle(color: PetbfColors.slate),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          const SizedBox(height: 10),
          Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 10,
            children: [
              Text(
                formatUsd(c.priceUsdCents),
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                ),
              ),
              Text(
                formatUsd(c.regularUsdCents),
                style: const TextStyle(
                  color: PetbfColors.slate,
                  decoration: TextDecoration.lineThrough,
                ),
              ),
              Text(
                'Ahorras ${formatUsd(c.savingsUsdCents)}',
                style: const TextStyle(
                  color: PetbfColors.petbf,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (max == 0)
            const Text(
              'Agotado por ahora',
              style: TextStyle(
                color: PetbfColors.danger,
                fontWeight: FontWeight.w700,
              ),
            )
          else
            Row(
              children: [
                QuantityStepper(
                  value: qty,
                  max: max,
                  label: 'Cantidad del combo ${c.name}',
                  onChanged: (v) => setState(() => _qty = v),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton(
                    onPressed: _adding ? null : _add,
                    child: Text(_adding ? 'Añadiendo…' : 'Añadir combo'),
                  ),
                ),
              ],
            ),
        ],
      ),
    );
  }
}
