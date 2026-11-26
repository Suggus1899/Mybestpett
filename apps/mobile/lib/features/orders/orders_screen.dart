import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/format.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';

class OrdersScreen extends ConsumerWidget {
  const OrdersScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(ordersProvider);
    final notifier = ref.read(ordersProvider.notifier);

    Widget body;
    if (state.items.isEmpty && state.error != null) {
      body = ErrorView(error: state.error!, onRetry: notifier.loadMore);
    } else if (state.items.isEmpty && state.loading) {
      body = const LoadingView();
    } else if (state.items.isEmpty) {
      body = EmptyView(
        icon: Icons.receipt_long_outlined,
        title: 'Aún no tienes pedidos',
        message: 'Cuando compres, aquí verás su estado.',
        action: FilledButton(
          onPressed: () => context.go('/productos'),
          child: const Text('Ver la tienda'),
        ),
      );
    } else {
      body = RefreshIndicator(
        onRefresh: notifier.refresh,
        child: ListView.separated(
          padding: const EdgeInsets.all(16),
          itemCount: state.items.length + 1,
          separatorBuilder: (_, _) => const SizedBox(height: 12),
          itemBuilder: (context, i) {
            if (i == state.items.length) {
              if (state.error != null) {
                return TextButton(
                  onPressed: notifier.loadMore,
                  child: Text('${messageOf(state.error!)} Reintentar'),
                );
              }
              if (state.loading) return const LoadingView();
              return state.hasMore
                  ? TextButton(
                      onPressed: notifier.loadMore,
                      child: const Text('Ver más'),
                    )
                  : const SizedBox.shrink();
            }
            final o = state.items[i];
            return Card(
              clipBehavior: Clip.antiAlias,
              child: InkWell(
                onTap: () => context.push('/pedidos/${o.id}'),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              'Pedido ${o.code}',
                              style: Theme.of(context).textTheme.titleMedium,
                            ),
                          ),
                          StatusChip(o.status),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(
                        formatDateTime(o.createdAt),
                        style: const TextStyle(color: PetbfColors.slate),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '${o.itemCount == 1 ? '1 producto' : '${o.itemCount} productos'} · '
                        '${formatUsd(o.totalUsdCents)} · ${formatMoney(o.totalCharged, o.chargedCurrency)}',
                      ),
                    ],
                  ),
                ),
              ),
            );
          },
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Mis pedidos')),
      body: body,
    );
  }
}
