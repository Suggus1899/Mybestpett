import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/petbf_api.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../models/catalog.dart';
import '../../widgets/cards.dart';
import '../../widgets/common.dart';
import '../../widgets/paged_grid.dart';

/// Filtros desde la ruta: /productos?q=&categoria=&especie=DOG&ofertas=1&orden=nombre
ProductQuery catalogQueryFromUri(Uri uri) {
  final p = uri.queryParameters;
  Species? species;
  for (final s in Species.values) {
    if (s.api == p['especie']) species = s;
  }
  final category = p['categoria'];
  return ProductQuery(
    search: p['q'] ?? '',
    category: category != null && category.isNotEmpty ? category : null,
    species: species,
    onSale: p['ofertas'] == '1',
    sort: p['orden'] == 'nombre' ? ProductSort.name : ProductSort.newest,
  );
}

class CatalogScreen extends ConsumerStatefulWidget {
  const CatalogScreen({super.key, this.initial = const ProductQuery()});
  final ProductQuery initial;

  @override
  ConsumerState<CatalogScreen> createState() => _CatalogScreenState();
}

class _CatalogScreenState extends ConsumerState<CatalogScreen> {
  late ProductQuery _query = widget.initial;
  late final _search = TextEditingController(text: widget.initial.search);
  Timer? _debounce;

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    super.dispose();
  }

  void _update(ProductQuery next) => setState(() => _query = next);

  // Espera a que la persona deje de escribir para no pedir una página por letra.
  void _onSearchChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), () {
      if (mounted) _update(_query.copyWith(search: value));
    });
  }

  Future<void> _pickCategory() async {
    final picked = await showModalBottomSheet<String?>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (context) => _CategorySheet(selected: _query.category),
    );
    if (picked == null) return;
    _update(_query.copyWith(category: () => picked.isEmpty ? null : picked));
  }

  @override
  Widget build(BuildContext context) {
    final categories = ref.watch(categoriesProvider).value ?? const [];
    final categoryName = categories
        .where((c) => c.slug == _query.category)
        .map((c) => c.name)
        .firstOrNull;
    final tooShort = _search.text.trim().length == 1;

    return Scaffold(
      appBar: AppBar(title: const Text('Tienda')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: TextField(
              controller: _search,
              onChanged: (value) {
                setState(() {}); // actualiza el aviso de largo mínimo
                _onSearchChanged(value);
              },
              textInputAction: TextInputAction.search,
              maxLength: 80,
              decoration: InputDecoration(
                hintText: 'Busca alimento, juguetes, camas…',
                prefixIcon: const Icon(Icons.search),
                counterText: '',
                helperText: tooShort ? 'Escribe al menos 2 letras' : null,
                fillColor: PetbfColors.mist,
                border: const OutlineInputBorder(
                  borderRadius: BorderRadius.all(Radius.circular(999)),
                  borderSide: BorderSide.none,
                ),
                enabledBorder: const OutlineInputBorder(
                  borderRadius: BorderRadius.all(Radius.circular(999)),
                  borderSide: BorderSide.none,
                ),
                suffixIcon: _search.text.isEmpty
                    ? null
                    : IconButton(
                        tooltip: 'Borrar búsqueda',
                        icon: const Icon(Icons.close),
                        onPressed: () {
                          _search.clear();
                          _debounce?.cancel();
                          _update(_query.copyWith(search: ''));
                        },
                      ),
              ),
            ),
          ),
          SizedBox(
            height: 52,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              children: [
                FilterChip(
                  label: const Text('Ofertas'),
                  selected: _query.onSale,
                  onSelected: (v) => _update(_query.copyWith(onSale: v)),
                ),
                const SizedBox(width: 8),
                ActionChip(
                  avatar: const Icon(Icons.category_outlined, size: 18),
                  label: Text(categoryName ?? 'Categoría'),
                  backgroundColor: _query.category != null
                      ? PetbfColors.petbfSoft
                      : null,
                  onPressed: _pickCategory,
                ),
                const SizedBox(width: 8),
                for (final s in Species.values) ...[
                  ChoiceChip(
                    label: Text(s.label),
                    selected: _query.species == s,
                    onSelected: (v) =>
                        _update(_query.copyWith(species: () => v ? s : null)),
                  ),
                  const SizedBox(width: 8),
                ],
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 8, 0),
            child: Row(
              children: [
                Expanded(child: _ResultCount(query: _query)),
                if (_query.hasFilters)
                  TextButton(
                    onPressed: () => _update(
                      ProductQuery(search: _query.search, sort: _query.sort),
                    ),
                    child: const Text('Quitar filtros'),
                  ),
                PopupMenuButton<ProductSort>(
                  tooltip: 'Ordenar',
                  initialValue: _query.sort,
                  onSelected: (sort) => _update(_query.copyWith(sort: sort)),
                  itemBuilder: (_) => const [
                    PopupMenuItem(
                      value: ProductSort.newest,
                      child: Text('Más nuevos'),
                    ),
                    PopupMenuItem(
                      value: ProductSort.name,
                      child: Text('Nombre (A-Z)'),
                    ),
                  ],
                  icon: const Icon(Icons.sort),
                ),
              ],
            ),
          ),
          Expanded(
            child: PagedGrid<ProductCard>(
              provider: productsProvider(_query),
              itemBuilder: (p) => ProductTile(p),
              empty: EmptyView(
                icon: Icons.search_off,
                title: 'Sin resultados',
                message: _query.hasFilters || _query.search.trim().length >= 2
                    ? 'Prueba con otras palabras o quita algún filtro.'
                    : 'Todavía no hay productos a la venta.',
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _ResultCount extends ConsumerWidget {
  const _ResultCount({required this.query});
  final ProductQuery query;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(productsProvider(query));
    if (state.page == 0) return const SizedBox.shrink();
    final total = state.total;
    return Text(
      total == 1 ? '1 producto' : '$total productos',
      style: const TextStyle(color: PetbfColors.slate),
    );
  }
}

/// Lista de categorías con sus subcategorías debajo. Devuelve el slug elegido,
/// '' para quitar el filtro o null si se cierra.
class _CategorySheet extends ConsumerWidget {
  const _CategorySheet({required this.selected});
  final String? selected;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final categories = ref.watch(categoriesProvider);
    return SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * 0.7,
        ),
        child: switch (categories) {
          AsyncData(:final value) => ListView(
            shrinkWrap: true,
            children: [
              ListTile(
                title: const Text('Todas las categorías'),
                selected: selected == null,
                onTap: () => Navigator.pop(context, ''),
              ),
              for (final parent in value.where((c) => c.parentId == null)) ...[
                ListTile(
                  title: Text(
                    parent.name,
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                  selected: selected == parent.slug,
                  onTap: () => Navigator.pop(context, parent.slug),
                ),
                for (final child in value.where((c) => c.parentId == parent.id))
                  ListTile(
                    contentPadding: const EdgeInsets.only(left: 40, right: 16),
                    title: Text(child.name),
                    selected: selected == child.slug,
                    onTap: () => Navigator.pop(context, child.slug),
                  ),
              ],
            ],
          ),
          AsyncError(:final error) => ErrorView(
            error: error,
            onRetry: () => ref.invalidate(categoriesProvider),
          ),
          _ => const LoadingView(),
        },
      ),
    );
  }
}
