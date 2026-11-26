import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../core/providers.dart';
import 'cards.dart';
import 'common.dart';

/// Rejilla con scroll infinito y "tirar para actualizar" sobre un [PagedNotifier].
class PagedGrid<T> extends ConsumerWidget {
  const PagedGrid({
    super.key,
    required this.provider,
    required this.itemBuilder,
    required this.empty,
  });

  final NotifierProvider<PagedNotifier<T>, PagedState<T>> provider;
  final Widget Function(T item) itemBuilder;
  final Widget empty;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(provider);
    final notifier = ref.read(provider.notifier);

    if (state.items.isEmpty) {
      if (state.error != null) {
        return ErrorView(error: state.error!, onRetry: notifier.loadMore);
      }
      if (state.loading) return const LoadingView();
      return RefreshIndicator(
        onRefresh: notifier.refresh,
        child: ListView(children: [const SizedBox(height: 40), empty]),
      );
    }

    return RefreshIndicator(
      onRefresh: notifier.refresh,
      child: NotificationListener<ScrollNotification>(
        onNotification: (n) {
          // Pide la siguiente página al acercarse al final.
          if (n.metrics.extentAfter < 600 && state.hasMore && !state.loading) {
            notifier.loadMore();
          }
          return false;
        },
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            SliverPadding(
              padding: const EdgeInsets.all(16),
              sliver: SliverGrid.builder(
                gridDelegate: cardGridDelegate,
                itemCount: state.items.length,
                itemBuilder: (_, i) => itemBuilder(state.items[i]),
              ),
            ),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.only(bottom: 24),
                child: state.error != null
                    ? Center(
                        child: Column(
                          children: [
                            Text(messageOf(state.error!)),
                            TextButton(
                              onPressed: notifier.loadMore,
                              child: const Text('Reintentar'),
                            ),
                          ],
                        ),
                      )
                    : state.loading
                    ? const LoadingView()
                    : state.hasMore
                    ? Center(
                        child: TextButton(
                          onPressed: notifier.loadMore,
                          child: const Text('Ver más'),
                        ),
                      )
                    : const SizedBox.shrink(),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
