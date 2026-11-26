import 'package:material_ui/material_ui.dart';

import '../core/theme.dart';
import '../models/catalog.dart';

/// ★★★★☆ 4,5 (12). No muestra nada si el producto no tiene reseñas.
class RatingStars extends StatelessWidget {
  const RatingStars(this.rating, {super.key, this.size = 14});
  final Rating rating;
  final double size;

  @override
  Widget build(BuildContext context) {
    if (!rating.hasReviews) return const SizedBox.shrink();
    return Semantics(
      label: rating.semantics,
      excludeSemantics: true,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Stars(rating.average!.round(), size: size),
          const SizedBox(width: 4),
          Text(
            '${rating.averageText} (${rating.count})',
            style: TextStyle(fontSize: size - 1, color: PetbfColors.slate),
          ),
        ],
      ),
    );
  }
}

/// [filled] estrellas llenas de 5.
class Stars extends StatelessWidget {
  const Stars(this.filled, {super.key, this.size = 14});
  final int filled;
  final double size;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: [
      for (var i = 1; i <= 5; i++)
        Icon(
          i <= filled ? Icons.star_rounded : Icons.star_outline_rounded,
          size: size + 2,
          color: i <= filled ? PetbfColors.amber : PetbfColors.line,
        ),
    ],
  );
}
