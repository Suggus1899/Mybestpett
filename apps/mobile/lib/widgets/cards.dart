import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../core/format.dart';
import '../core/theme.dart';
import '../models/catalog.dart';
import 'common.dart';

/// Rejilla de 2 columnas para tarjetas.
const cardGridDelegate = SliverGridDelegateWithMaxCrossAxisExtent(
  maxCrossAxisExtent: 220,
  mainAxisSpacing: 12,
  crossAxisSpacing: 12,
  childAspectRatio: 0.58,
);

class ProductTile extends StatelessWidget {
  const ProductTile(this.product, {super.key});
  final ProductCard product;

  @override
  Widget build(BuildContext context) {
    final price = product.priceFromUsdCents;
    final compareAt = product.compareAtUsdCents;
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push('/productos/${product.slug}'),
        child: Padding(
          padding: const EdgeInsets.all(8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      NetImage(
                        image: product.image,
                        fallback: product.categoryName,
                      ),
                      if (price != null && compareAt != null)
                        Positioned(
                          top: 6,
                          left: 6,
                          child: OfferBadge(
                            '−${discountPercent(compareAt, price)} %',
                          ),
                        ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Text(
                product.name,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  height: 1.3,
                ),
              ),
              const SizedBox(height: 4),
              if (price != null)
                PriceView(
                  usdCents: price,
                  compareAtUsdCents: compareAt,
                  from: true,
                ),
              if (!product.inStock)
                const Text(
                  'Agotado',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: PetbfColors.danger,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class AnimalTile extends StatelessWidget {
  const AnimalTile(this.animal, {super.key});
  final Animal animal;

  @override
  Widget build(BuildContext context) {
    final price = animal.priceUsdCents;
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => context.push('/animales/${animal.slug}'),
        child: Padding(
          padding: const EdgeInsets.all(8),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: Stack(
                    fit: StackFit.expand,
                    children: [
                      NetImage(
                        image: animal.images.firstOrNull,
                        fallback: animal.species.label,
                      ),
                      if (animal.status == AnimalStatus.reserved)
                        const Positioned(
                          top: 6,
                          left: 6,
                          child: OfferBadge('Reservado'),
                        ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Text(
                animal.name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                ),
              ),
              Text(
                [
                  animal.species.singular,
                  animal.breed ?? 'Mestizo',
                ].join(' · '),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 13, color: PetbfColors.slate),
              ),
              const SizedBox(height: 4),
              if (animal.listingType == ListingType.sale && price != null)
                PriceView(usdCents: price)
              else
                const Text(
                  'En adopción',
                  style: TextStyle(
                    fontWeight: FontWeight.w800,
                    color: PetbfColors.petbf,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
