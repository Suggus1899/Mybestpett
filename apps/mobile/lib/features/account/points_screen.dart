import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/format.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';

/// Saldo de puntos y sus movimientos.
class PointsScreen extends ConsumerWidget {
  const PointsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final history = ref.watch(pointsProvider);
    final balance = ref.watch(pointsBalanceProvider);
    final notifier = ref.read(pointsProvider.notifier);

    Future<void> refresh() async {
      ref.invalidate(pointsBalanceProvider);
      await notifier.refresh();
    }

    Widget body;
    if (history.items.isEmpty && history.error != null) {
      body = ErrorView(
        error: history.error!,
        onRetry: () {
          ref.invalidate(pointsBalanceProvider);
          notifier.refresh();
        },
      );
    } else if (history.items.isEmpty && history.loading) {
      body = const LoadingView();
    } else {
      body = RefreshIndicator(
        onRefresh: refresh,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const Text(
              'Ganas 1 punto por cada dólar que pagas en productos cuando '
              'recibes tu pedido. Cada 100 puntos valen 1 \$ de descuento: '
              'los usas al finalizar la compra.',
              style: TextStyle(color: PetbfColors.slate),
            ),
            const SizedBox(height: 16),
            Panel(
              color: PetbfColors.petbfSoft,
              child: switch (balance) {
                AsyncData(:final value) => Semantics(
                  container: true,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${value.balance} puntos',
                        style: Theme.of(context).textTheme.headlineMedium,
                      ),
                      Text(
                        'Equivalen a ${formatUsd(value.valueUsdCents)}',
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                    ],
                  ),
                ),
                AsyncError() => const Text('No se pudo cargar tu saldo.'),
                _ => const Text('Cargando tu saldo…'),
              },
            ),
            const SizedBox(height: 20),
            Text('Movimientos', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            if (history.isEmpty)
              const Text(
                'Todavía no tienes movimientos.',
                style: TextStyle(color: PetbfColors.slate),
              ),
            for (final e in history.items)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            e.reason.label,
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                          Text(
                            [formatDateTime(e.createdAt), ?e.note].join(' · '),
                            style: const TextStyle(
                              fontSize: 13,
                              color: PetbfColors.slate,
                            ),
                          ),
                          if (e.orderId != null)
                            InkWell(
                              onTap: () =>
                                  context.push('/pedidos/${e.orderId}'),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(
                                  vertical: 4,
                                ),
                                child: Text(
                                  'Pedido ${e.orderCode}',
                                  style: const TextStyle(
                                    fontSize: 13,
                                    color: PetbfColors.petbf,
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                    Text(
                      e.delta > 0 ? '+${e.delta}' : '−${-e.delta}',
                      style: TextStyle(
                        fontWeight: FontWeight.w800,
                        color: e.delta > 0
                            ? PetbfColors.petbf
                            : PetbfColors.danger,
                      ),
                    ),
                  ],
                ),
              ),
            if (history.error != null)
              TextButton(
                onPressed: notifier.loadMore,
                child: Text('${messageOf(history.error!)} Reintentar'),
              )
            else if (history.loading)
              const LoadingView()
            else if (history.hasMore)
              TextButton(
                onPressed: notifier.loadMore,
                child: const Text('Ver más'),
              ),
          ],
        ),
      );
    }
    return Scaffold(
      appBar: AppBar(title: const Text('Mis puntos')),
      body: body,
    );
  }
}
