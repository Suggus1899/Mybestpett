import 'json.dart';

/// Reseña pública: solo nombre e inicial del autor, siempre compra verificada.
class Review {
  const Review({
    required this.id,
    required this.rating,
    required this.title,
    required this.body,
    required this.author,
    required this.verifiedPurchase,
    required this.createdAt,
  });
  factory Review.fromJson(Json json) => Review(
    id: json.str('id'),
    rating: json.integer('rating'),
    title: json.strOrNull('title'),
    body: json.str('body'),
    author: json.str('author'),
    verifiedPurchase: json.boolean('verifiedPurchase'),
    createdAt: json.date('createdAt'),
  );
  final String id;
  final int rating;
  final String? title;
  final String body;
  final String author;
  final bool verifiedPurchase;
  final DateTime createdAt;
}

class ReviewSummary {
  const ReviewSummary({
    required this.count,
    required this.average,
    required this.distribution,
  });
  factory ReviewSummary.fromJson(Json json) {
    final distribution = json['distribution'];
    return ReviewSummary(
      count: json.integer('count'),
      average: switch (json['average']) {
        final num n => n.toDouble(),
        null => null,
        final other => throw FormatException('Promedio inválido: $other'),
      },
      distribution: switch (distribution) {
        final List<Object?> l when l.length == 5 && l.every((n) => n is int) =>
          l.cast<int>(),
        _ => throw FormatException('Distribución inválida: $distribution'),
      },
    );
  }
  final int count;
  final double? average;

  /// Cuántas reseñas de 1, 2, 3, 4 y 5 estrellas (en ese orden).
  final List<int> distribution;
}

/// Una página de reseñas con el resumen del producto.
class ReviewPage {
  const ReviewPage({
    required this.items,
    required this.total,
    required this.page,
    required this.pageSize,
    required this.summary,
  });
  factory ReviewPage.fromJson(Json json) => ReviewPage(
    items: asList(json['items'], Review.fromJson),
    total: json.integer('total'),
    page: json.integer('page'),
    pageSize: json.integer('pageSize'),
    summary: ReviewSummary.fromJson(json.obj('summary')),
  );
  final List<Review> items;
  final int total;
  final int page;
  final int pageSize;
  final ReviewSummary summary;

  bool get hasMore => page * pageSize < total;
}

enum ReviewSort { recent, best, worst }

extension ReviewSortLabel on ReviewSort {
  String get label => switch (this) {
    ReviewSort.recent => 'Más recientes',
    ReviewSort.best => 'Mejor valoradas',
    ReviewSort.worst => 'Peor valoradas',
  };
}

/// La reseña propia, incluida una que el equipo ocultó (con el motivo).
class OwnReview {
  const OwnReview({
    required this.rating,
    required this.title,
    required this.body,
    required this.hidden,
    required this.hiddenReason,
  });
  factory OwnReview.fromJson(Json json) => OwnReview(
    rating: json.integer('rating'),
    title: json.strOrNull('title'),
    body: json.str('body'),
    hidden: switch (json.str('status')) {
      'VISIBLE' => false,
      'HIDDEN' => true,
      final other => throw FormatException('Estado de reseña: $other'),
    },
    hiddenReason: json.strOrNull('hiddenReason'),
  );
  final int rating;
  final String? title;
  final String body;
  final bool hidden;
  final String? hiddenReason;
}

/// Si la persona puede reseñar (recibió el producto) y su reseña actual.
class MyReview {
  const MyReview({required this.canReview, required this.review});
  factory MyReview.fromJson(Json json) => MyReview(
    canReview: json.boolean('canReview'),
    review: switch (json.objOrNull('review')) {
      final Json r => OwnReview.fromJson(r),
      null => null,
    },
  );
  final bool canReview;
  final OwnReview? review;
}

class ReviewInput {
  const ReviewInput({required this.rating, this.title, required this.body});
  final int rating;
  final String? title;
  final String body;

  Json toJson() => {
    'rating': rating,
    if (title != null && title!.trim().isNotEmpty) 'title': title!.trim(),
    'body': body.trim(),
  };
}
