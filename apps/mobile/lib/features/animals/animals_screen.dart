import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/petbf_api.dart';
import '../../core/providers.dart';
import '../../models/catalog.dart';
import '../../widgets/cards.dart';
import '../../widgets/common.dart';
import '../../widgets/paged_grid.dart';

/// Animales en venta y en adopción, en dos pestañas.
class AnimalsScreen extends ConsumerStatefulWidget {
  const AnimalsScreen({super.key, this.initialTab = 0});
  final int initialTab;

  @override
  ConsumerState<AnimalsScreen> createState() => _AnimalsScreenState();
}

class _AnimalsScreenState extends ConsumerState<AnimalsScreen> {
  Species? _species;

  @override
  Widget build(BuildContext context) {
    // Solo las especies que la tienda acepta (sin conexión, todas).
    final species = ref.watch(animalSpeciesProvider).value ?? Species.values;
    return DefaultTabController(
      length: 2,
      initialIndex: widget.initialTab,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Animales'),
          bottom: const TabBar(
            tabs: [
              Tab(text: 'En venta'),
              Tab(text: 'En adopción'),
            ],
          ),
        ),
        body: Column(
          children: [
            SizedBox(
              height: 56,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
                children: [
                  ChoiceChip(
                    label: const Text('Todos'),
                    selected: _species == null,
                    onSelected: (_) => setState(() => _species = null),
                  ),
                  for (final s in species) ...[
                    const SizedBox(width: 8),
                    ChoiceChip(
                      label: Text(s.label),
                      selected: _species == s,
                      onSelected: (v) =>
                          setState(() => _species = v ? s : null),
                    ),
                  ],
                ],
              ),
            ),
            Expanded(
              child: TabBarView(
                children: [
                  _AnimalGrid(
                    query: AnimalQuery(
                      listingType: ListingType.sale,
                      species: _species,
                    ),
                  ),
                  _AnimalGrid(
                    query: AnimalQuery(
                      listingType: ListingType.adoption,
                      species: _species,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AnimalGrid extends StatelessWidget {
  const _AnimalGrid({required this.query});
  final AnimalQuery query;

  @override
  Widget build(BuildContext context) => PagedGrid<Animal>(
    provider: animalsProvider(query),
    itemBuilder: (a) => AnimalTile(a),
    empty: EmptyView(
      icon: Icons.pets,
      title: query.listingType == ListingType.adoption
          ? 'Nadie espera hogar ahora mismo'
          : 'No hay animales en venta',
      message: 'Vuelve pronto: publicamos nuevos con frecuencia.',
    ),
  );
}
