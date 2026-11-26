import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/format.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../models/catalog.dart';
import '../../widgets/common.dart';
import '../../widgets/rating.dart';
import 'reviews_section.dart';

class ProductScreen extends ConsumerWidget {
  const ProductScreen({super.key, required this.slug});
  final String slug;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final product = ref.watch(productProvider(slug));
    return switch (product) {
      AsyncData(:final value) => _ProductView(product: value),
      AsyncError(:final error) => Scaffold(
        appBar: AppBar(),
        body: ErrorView(
          error: error,
          onRetry: () => ref.invalidate(productProvider(slug)),
        ),
      ),
      _ => Scaffold(appBar: AppBar(), body: const LoadingView()),
    };
  }
}

/// Galería deslizable con indicador de página.
class Gallery extends StatefulWidget {
  const Gallery({super.key, required this.images, required this.fallback});
  final List<ImageRef> images;
  final String fallback;

  @override
  State<Gallery> createState() => _GalleryState();
}

class _GalleryState extends State<Gallery> {
  int _page = 0;

  @override
  Widget build(BuildContext context) {
    final images = widget.images;
    return AspectRatio(
      aspectRatio: 1,
      child: Stack(
        children: [
          if (images.isEmpty)
            Positioned.fill(
              child: NetImage(image: null, fallback: widget.fallback),
            )
          else
            PageView.builder(
              itemCount: images.length,
              onPageChanged: (i) => setState(() => _page = i),
              itemBuilder: (_, i) =>
                  NetImage(image: images[i], fallback: widget.fallback),
            ),
          if (images.length > 1)
            Positioned(
              bottom: 12,
              left: 0,
              right: 0,
              child: Semantics(
                label: 'Foto ${_page + 1} de ${images.length}',
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    for (var i = 0; i < images.length; i++)
                      Container(
                        width: 8,
                        height: 8,
                        margin: const EdgeInsets.symmetric(horizontal: 3),
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: i == _page ? PetbfColors.petbf : Colors.white,
                          border: Border.all(color: PetbfColors.petbf),
                        ),
                      ),
                  ],
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _ProductView extends ConsumerStatefulWidget {
  const _ProductView({required this.product});
  final ProductDetail product;

  @override
  ConsumerState<_ProductView> createState() => _ProductViewState();
}

class _ProductViewState extends ConsumerState<_ProductView> {
  late Variant? _variant =
      widget.product.variants.where((v) => v.inStock).firstOrNull ??
      widget.product.variants.firstOrNull;
  int _qty = 1;
  bool _adding = false;

  Future<void> _add() async {
    final variant = _variant;
    if (variant == null || _adding) return;
    if (!isSignedIn(ref.read(sessionProvider))) {
      await context.push(
        Uri(
          path: '/entrar',
          queryParameters: {'next': '/productos/${widget.product.slug}'},
        ).toString(),
      );
      return;
    }
    setState(() => _adding = true);
    try {
      await ref.read(cartProvider.notifier).add(variant.id, _qty);
      if (!mounted) return;
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            content: Text(
              _qty == 1
                  ? 'Añadiste ${widget.product.name} al carrito.'
                  : 'Añadiste $_qty × ${widget.product.name} al carrito.',
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
      if (mounted) showMessage(context, messageOf(e));
    } finally {
      if (mounted) setState(() => _adding = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.product;
    final variant = _variant;
    final text = Theme.of(context).textTheme;
    final available = variant?.inStock ?? false;

    return Scaffold(
      appBar: AppBar(),
      body: ListView(
        children: [
          Gallery(images: p.images, fallback: p.categoryName),
          Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  [p.categoryName, ?p.brandName].join(' · '),
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: PetbfColors.slate,
                  ),
                ),
                const SizedBox(height: 6),
                Text(p.name, style: text.headlineSmall),
                if (p.rating.hasReviews) ...[
                  const SizedBox(height: 4),
                  RatingStars(p.rating, size: 16),
                ],
                const SizedBox(height: 10),
                if (variant != null)
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: PriceView(
                          usdCents: variant.priceUsdCents,
                          compareAtUsdCents: variant.compareAtUsdCents,
                          large: true,
                        ),
                      ),
                      if (variant.compareAtUsdCents != null)
                        OfferBadge(
                          '−${discountPercent(variant.compareAtUsdCents!, variant.priceUsdCents)} %',
                        ),
                    ],
                  ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Icon(
                      available ? Icons.check : Icons.block,
                      size: 18,
                      color: available ? PetbfColors.petbf : PetbfColors.danger,
                    ),
                    const SizedBox(width: 6),
                    Text(
                      variant == null
                          ? 'No disponible'
                          : available
                          ? 'En stock'
                          : 'Agotado',
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        color: available
                            ? PetbfColors.petbf
                            : PetbfColors.danger,
                      ),
                    ),
                  ],
                ),
                if (p.variants.length > 1) ...[
                  const SizedBox(height: 20),
                  Text('Presentación', style: text.titleSmall),
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final v in p.variants)
                        ChoiceChip(
                          label: Text(
                            '${v.name} · ${formatUsd(v.priceUsdCents)}${v.inStock ? '' : ' · agotado'}',
                          ),
                          selected: v.id == variant?.id,
                          onSelected: (_) => setState(() {
                            _variant = v;
                            _qty = 1;
                          }),
                        ),
                    ],
                  ),
                ],
                if (available) ...[
                  const SizedBox(height: 20),
                  Row(
                    children: [
                      Expanded(child: Text('Cantidad', style: text.titleSmall)),
                      QuantityStepper(
                        value: _qty,
                        onChanged: (v) => setState(() => _qty = v),
                      ),
                    ],
                  ),
                ],
                const SizedBox(height: 20),
                Text('Descripción', style: text.titleSmall),
                const SizedBox(height: 6),
                Text(p.description),
                const SizedBox(height: 16),
                Panel(
                  color: PetbfColors.mist,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('Envío gratis desde \$25.'),
                      const SizedBox(height: 4),
                      Text(
                        p.isReturnable
                            ? 'Puedes devolverlo hasta 3 días después de recibirlo.'
                            : 'Por higiene, no se aceptan devoluciones una vez abierto.',
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 28),
                ProductReviews(slug: p.slug),
                const SizedBox(height: 28),
                Recommendations(slug: p.slug),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: SafeArea(
        child: Container(
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 12),
          decoration: const BoxDecoration(
            border: Border(top: BorderSide(color: PetbfColors.line)),
            color: Colors.white,
          ),
          child: Row(
            children: [
              if (variant != null && available) ...[
                Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Total',
                      style: TextStyle(fontSize: 13, color: PetbfColors.slate),
                    ),
                    Text(
                      formatUsd(variant.priceUsdCents * _qty),
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ],
                ),
                const SizedBox(width: 14),
              ],
              Expanded(
                child: FilledButton.icon(
                  onPressed: available && !_adding ? _add : null,
                  icon: const Icon(Icons.shopping_bag_outlined),
                  label: Text(
                    !available
                        ? 'Agotado'
                        : _adding
                        ? 'Añadiendo…'
                        : 'Añadir al carrito',
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
