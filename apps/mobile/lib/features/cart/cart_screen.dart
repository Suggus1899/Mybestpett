import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/format.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/validators.dart';
import '../../models/shop.dart';
import '../../widgets/common.dart';

/// Envío gratis desde 25 $ (regla de la tienda; cada zona puede tener la suya).
const freeShippingFromCents = 2500;

class CartScreen extends ConsumerWidget {
  const CartScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final signedIn = ref.watch(isSignedInProvider);
    final cart = ref.watch(cartProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Tu carrito'),
        actions: [
          if ((cart.value?.items.isNotEmpty ?? false))
            TextButton(
              onPressed: () => _confirmClear(context, ref),
              child: const Text('Vaciar'),
            ),
        ],
      ),
      body: !signedIn
          ? const SignInPrompt(
              message: 'Para comprar necesitas una cuenta. Tu carrito se guarda en ella.',
              from: '/carrito',
            )
          : switch (cart) {
              AsyncData(:final value) when value.items.isEmpty => EmptyView(
                icon: Icons.shopping_bag_outlined,
                title: 'Tu carrito está vacío',
                message: 'Cuando añadas productos, aparecerán aquí.',
                action: FilledButton(
                  onPressed: () => context.go('/productos'),
                  child: const Text('Ver la tienda'),
                ),
              ),
              AsyncData(:final value) => _CartView(cart: value),
              AsyncError(:final error) => ErrorView(
                error: error,
                onRetry: () => ref.invalidate(cartProvider),
              ),
              _ => const LoadingView(),
            },
    );
  }

  Future<void> _confirmClear(BuildContext context, WidgetRef ref) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('¿Vaciar el carrito?'),
        content: const Text('Se quitarán todos los productos.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Vaciar'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(cartProvider.notifier).clear();
    } catch (e) {
      if (context.mounted) showMessage(context, messageOf(e));
    }
  }
}

class _CartView extends ConsumerWidget {
  const _CartView({required this.cart});
  final Cart cart;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rate = ref.watch(usdVesProvider);
    // El envío gratis se mide con lo que se paga, ya con los combos.
    final missing = freeShippingFromCents - cart.itemsTotalUsdCents;
    return Column(
      children: [
        Expanded(
          child: RefreshIndicator(
            onRefresh: () => ref.refresh(cartProvider.future),
            child: ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: cart.items.length,
              separatorBuilder: (_, _) => const SizedBox(height: 12),
              itemBuilder: (_, i) => _CartLine(item: cart.items[i]),
            ),
          ),
        ),
        SafeArea(
          top: false,
          child: Container(
            padding: const EdgeInsets.fromLTRB(20, 14, 20, 14),
            decoration: const BoxDecoration(
              color: Colors.white,
              border: Border(top: BorderSide(color: PetbfColors.line)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (cart.combos.isNotEmpty)
                  Row(
                    children: [
                      const Expanded(child: Text('Precio por separado')),
                      Text(formatUsd(cart.subtotalUsdCents)),
                    ],
                  ),
                for (final c in cart.combos)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 2),
                    child: Row(
                      children: [
                        Expanded(
                          child: Text(
                            c.label,
                            style: const TextStyle(
                              color: PetbfColors.petbf,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        Text(
                          '−${formatUsd(c.savingsUsdCents)}',
                          style: const TextStyle(
                            color: PetbfColors.petbf,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
                  ),
                Row(
                  children: [
                    Text(
                      cart.itemCount == 1
                          ? 'Subtotal (1 artículo)'
                          : 'Subtotal (${cart.itemCount} artículos)',
                    ),
                    const Spacer(),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text(
                          formatUsd(cart.itemsTotalUsdCents),
                          style: const TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        if (rate != null)
                          Text(
                            formatBs(cart.itemsTotalUsdCents, rate),
                            style: const TextStyle(
                              fontSize: 13,
                              color: PetbfColors.slate,
                            ),
                          ),
                      ],
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  missing > 0
                      ? 'Te faltan ${formatUsd(missing)} para el envío gratis.'
                      : 'Tu pedido tiene envío gratis.',
                  style: const TextStyle(
                    fontSize: 13,
                    color: PetbfColors.slate,
                  ),
                ),
                const Text(
                  '¿Tienes un cupón? Lo aplicas al finalizar la compra.',
                  style: TextStyle(fontSize: 13, color: PetbfColors.slate),
                ),
                if (!cart.canCheckout) ...[
                  const SizedBox(height: 6),
                  const Text(
                    'Revisa los productos marcados antes de pagar.',
                    style: TextStyle(
                      color: PetbfColors.danger,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
                const SizedBox(height: 10),
                FilledButton(
                  onPressed: cart.canCheckout
                      ? () => context.push('/checkout')
                      : null,
                  child: const Text('Ir a pagar'),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

class _CartLine extends ConsumerStatefulWidget {
  const _CartLine({required this.item});
  final CartItem item;

  @override
  ConsumerState<_CartLine> createState() => _CartLineState();
}

class _CartLineState extends ConsumerState<_CartLine> {
  bool _busy = false;

  Future<void> _run(Future<void> Function() action) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await action();
    } catch (e) {
      if (mounted) showMessage(context, messageOf(e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    final cart = ref.read(cartProvider.notifier);
    final issue = switch (item.issue) {
      CartIssue.unavailable => 'Ya no está disponible. Quítalo para continuar.',
      CartIssue.insufficientStock =>
        item.available == 1
            ? 'Solo queda 1. Ajusta la cantidad.'
            : 'Solo quedan ${item.available}. Ajusta la cantidad.',
      null => null,
    };
    // Se puede bajar la cantidad aunque supere el stock, para corregirla.
    final max = item.issue == CartIssue.unavailable
        ? item.quantity
        : (item.available < maxQuantity ? item.available : maxQuantity);

    return Panel(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(12),
            child: SizedBox(
              width: 80,
              height: 80,
              child: InkWell(
                onTap: () => context.push('/productos/${item.productSlug}'),
                child: NetImage(image: item.image, fallback: ''),
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Text(
                        item.productName,
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          height: 1.3,
                        ),
                      ),
                    ),
                    IconButton(
                      tooltip: 'Quitar ${item.productName}',
                      icon: const Icon(Icons.delete_outline),
                      onPressed: _busy
                          ? null
                          : () => _run(() => cart.remove(item.variantId)),
                    ),
                  ],
                ),
                Text(
                  '${item.variantName} · ${formatUsd(item.unitPriceUsdCents)} c/u',
                  style: const TextStyle(
                    fontSize: 13,
                    color: PetbfColors.slate,
                  ),
                ),
                if (issue != null) ...[
                  const SizedBox(height: 4),
                  Text(
                    issue,
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: PetbfColors.danger,
                    ),
                  ),
                ],
                const SizedBox(height: 8),
                Row(
                  children: [
                    QuantityStepper(
                      value: item.quantity,
                      max: max < 1 ? 1 : max,
                      enabled: !_busy && item.issue != CartIssue.unavailable,
                      label: 'Cantidad de ${item.productName}',
                      onChanged: (q) {
                        // Con menos stock que lo pedido, bajar va directo a lo disponible.
                        final target =
                            item.issue == CartIssue.insufficientStock &&
                                q < item.quantity
                            ? item.available
                            : q;
                        _run(() => cart.setQuantity(item.variantId, target));
                      },
                    ),
                    const Spacer(),
                    Text(
                      formatUsd(item.lineTotalUsdCents),
                      style: const TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
