import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/format.dart';
import '../../core/money.dart';
import '../../core/petbf_api.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../models/catalog.dart';
import '../../widgets/cards.dart';
import '../../widgets/common.dart';

const _newest = ProductQuery();
const _adoption = AnimalQuery(listingType: ListingType.adoption);

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final products = ref.watch(productsProvider(_newest));
    final adoption = ref.watch(animalsProvider(_adoption));
    final rates = ref.watch(ratesProvider).value;
    final text = Theme.of(context).textTheme;

    Future<void> refresh() async {
      ref.invalidate(ratesProvider);
      await Future.wait([
        ref.read(productsProvider(_newest).notifier).refresh(),
        ref.read(animalsProvider(_adoption).notifier).refresh(),
      ]);
    }

    return Scaffold(
      appBar: AppBar(
        title: Row(
          children: [
            const Icon(Icons.pets, color: PetbfColors.petbf),
            const SizedBox(width: 8),
            Text('Petbf', style: text.headlineSmall),
          ],
        ),
      ),
      body: RefreshIndicator(
        onRefresh: refresh,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
          children: [
            InkWell(
              borderRadius: BorderRadius.circular(999),
              onTap: () => context.go('/productos'),
              child: Container(
                height: 48,
                padding: const EdgeInsets.symmetric(horizontal: 16),
                decoration: BoxDecoration(
                  color: PetbfColors.mist,
                  borderRadius: BorderRadius.circular(999),
                ),
                child: const Row(
                  children: [
                    Icon(Icons.search, color: PetbfColors.slate),
                    SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Busca alimento, juguetes, camas…',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(color: PetbfColors.slate),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 20),
            Panel(
              color: PetbfColors.petbfSoft,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const OfferBadge('Ofertas'),
                  const SizedBox(height: 10),
                  Text(
                    'Todo para tu mascota, con envío gratis desde \$25',
                    style: text.headlineSmall,
                  ),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 8,
                    children: [
                      FilledButton(
                        onPressed: () => context.go('/productos?ofertas=1'),
                        child: const Text('Ver ofertas'),
                      ),
                      OutlinedButton(
                        onPressed: () => context.push('/combos'),
                        child: const Text('Ver combos'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            if (rates?.usdVes != null) ...[
              const SizedBox(height: 10),
              Text(
                'Tasa BCV: Bs. ${formatCents(decimalToCents(rates!.usdVes!))} por dólar'
                '${rates.usdEffectiveAt == null ? '' : ' · ${formatDate(rates.usdEffectiveAt!)}'}',
                style: const TextStyle(fontSize: 13, color: PetbfColors.slate),
              ),
            ],
            const SizedBox(height: 24),
            const SectionTitle('¿Para quién compras?'),
            const SizedBox(height: 12),
            SizedBox(
              height: 100,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                itemCount: Species.values.length,
                separatorBuilder: (_, _) => const SizedBox(width: 10),
                itemBuilder: (context, i) {
                  final s = Species.values[i];
                  return InkWell(
                    borderRadius: BorderRadius.circular(16),
                    onTap: () => context.go('/productos?especie=${s.api}'),
                    child: SizedBox(
                      width: 72,
                      child: Column(
                        children: [
                          const CircleAvatar(
                            radius: 32,
                            backgroundColor: PetbfColors.mist,
                            child: Icon(Icons.pets, color: PetbfColors.petbf),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            s.label,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
            const SizedBox(height: 24),
            SectionTitle(
              'Lo más nuevo',
              trailing: TextButton(
                onPressed: () => context.go('/productos'),
                child: const Text('Ver todo'),
              ),
            ),
            const SizedBox(height: 8),
            if (products.error != null && products.items.isEmpty)
              ErrorView(
                error: products.error!,
                onRetry: () =>
                    ref.read(productsProvider(_newest).notifier).loadMore(),
              )
            else if (products.items.isEmpty && products.loading)
              const LoadingView()
            else if (products.items.isEmpty)
              const Text(
                'Pronto tendremos productos aquí.',
                style: TextStyle(color: PetbfColors.slate),
              )
            else
              GridView.builder(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                gridDelegate: cardGridDelegate,
                itemCount: products.items.length.clamp(0, 6),
                itemBuilder: (_, i) => ProductTile(products.items[i]),
              ),
            const SizedBox(height: 24),
            SectionTitle(
              'Buscan hogar',
              trailing: TextButton(
                onPressed: () => context.go('/animales?tipo=adopcion'),
                child: const Text('Ver todos'),
              ),
            ),
            const SizedBox(height: 8),
            if (adoption.items.isEmpty)
              Text(
                adoption.loading
                    ? 'Cargando…'
                    : 'Ahora mismo no hay animales en adopción.',
                style: const TextStyle(color: PetbfColors.slate),
              )
            else
              SizedBox(
                height: 280,
                child: ListView.separated(
                  scrollDirection: Axis.horizontal,
                  itemCount: adoption.items.length.clamp(0, 8),
                  separatorBuilder: (_, _) => const SizedBox(width: 12),
                  itemBuilder: (_, i) => SizedBox(
                    width: 170,
                    child: AnimalTile(adoption.items[i]),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
