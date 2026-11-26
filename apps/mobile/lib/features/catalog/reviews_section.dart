import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/format.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/validators.dart';
import '../../models/catalog.dart';
import '../../models/reviews.dart';
import '../../widgets/cards.dart';
import '../../widgets/common.dart';
import '../../widgets/rating.dart';
import '../account/auth_screens.dart';

/// Reseñas del producto: resumen, la reseña propia y la lista.
class ProductReviews extends ConsumerStatefulWidget {
  const ProductReviews({super.key, required this.slug});
  final String slug;

  @override
  ConsumerState<ProductReviews> createState() => _ProductReviewsState();
}

class _ProductReviewsState extends ConsumerState<ProductReviews> {
  ReviewSort _sort = ReviewSort.recent;
  bool _loadingMore = false;

  (String, ReviewSort) get _key => (widget.slug, _sort);

  Future<void> _more() async {
    setState(() => _loadingMore = true);
    try {
      await ref.read(reviewsProvider(_key).notifier).loadMore();
    } catch (e) {
      if (mounted) showMessage(context, messageOf(e));
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final reviews = ref.watch(reviewsProvider(_key));
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Reseñas', style: text.titleMedium),
        const SizedBox(height: 8),
        switch (reviews) {
          AsyncData(:final value) => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _Summary(value.summary),
              const SizedBox(height: 12),
              _Mine(slug: widget.slug),
              if (value.summary.count > 1) ...[
                const SizedBox(height: 12),
                Wrap(
                  spacing: 8,
                  children: [
                    for (final s in ReviewSort.values)
                      ChoiceChip(
                        label: Text(s.label),
                        selected: s == _sort,
                        onSelected: (_) => setState(() => _sort = s),
                      ),
                  ],
                ),
              ],
              const SizedBox(height: 8),
              for (final r in value.items) _ReviewTile(r),
              if (value.hasMore)
                Align(
                  child: TextButton(
                    onPressed: _loadingMore ? null : _more,
                    child: Text(_loadingMore ? 'Cargando…' : 'Ver más reseñas'),
                  ),
                ),
            ],
          ),
          AsyncError(:final error) => Row(
            children: [
              Expanded(child: Text(messageOf(error))),
              TextButton(
                onPressed: () => ref.invalidate(reviewsProvider(_key)),
                child: const Text('Reintentar'),
              ),
            ],
          ),
          _ => const Padding(
            padding: EdgeInsets.all(16),
            child: Center(child: CircularProgressIndicator()),
          ),
        },
      ],
    );
  }
}

class _Summary extends StatelessWidget {
  const _Summary(this.summary);
  final ReviewSummary summary;

  @override
  Widget build(BuildContext context) {
    if (summary.count == 0 || summary.average == null) {
      return const Text(
        'Todavía no hay reseñas.',
        style: TextStyle(color: PetbfColors.slate),
      );
    }
    final rating = Rating(average: summary.average, count: summary.count);
    final top = summary.distribution.fold(0, (a, b) => a > b ? a : b);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Column(
          children: [
            Text(
              rating.averageText,
              style: const TextStyle(fontSize: 34, fontWeight: FontWeight.w800),
            ),
            RatingStars(rating, size: 12),
          ],
        ),
        const SizedBox(width: 20),
        Expanded(
          child: Column(
            children: [
              for (var stars = 5; stars >= 1; stars--)
                Semantics(
                  label:
                      '$stars ${stars == 1 ? 'estrella' : 'estrellas'}: '
                      '${summary.distribution[stars - 1]}',
                  excludeSemantics: true,
                  child: Row(
                    children: [
                      SizedBox(width: 14, child: Text('$stars')),
                      const Icon(
                        Icons.star_rounded,
                        size: 14,
                        color: PetbfColors.amber,
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: LinearProgressIndicator(
                          value: top == 0
                              ? 0
                              : summary.distribution[stars - 1] / top,
                          minHeight: 6,
                          borderRadius: BorderRadius.circular(3),
                          color: PetbfColors.amber,
                          backgroundColor: PetbfColors.mist,
                        ),
                      ),
                      SizedBox(
                        width: 32,
                        child: Text(
                          '${summary.distribution[stars - 1]}',
                          textAlign: TextAlign.end,
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

class _ReviewTile extends StatelessWidget {
  const _ReviewTile(this.review);
  final Review review;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Semantics(
            label:
                '${review.rating} de 5 '
                '${review.rating == 1 ? 'estrella' : 'estrellas'}',
            excludeSemantics: true,
            child: Stars(review.rating),
          ),
          if (review.title != null) ...[
            const SizedBox(height: 4),
            Text(
              review.title!,
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
          ],
          const SizedBox(height: 2),
          Text(review.body),
          const SizedBox(height: 4),
          Text(
            [
              review.author,
              if (review.verifiedPurchase) 'Compra verificada',
              formatDate(review.createdAt),
            ].join(' · '),
            style: const TextStyle(fontSize: 13, color: PetbfColors.slate),
          ),
        ],
      ),
    );
  }
}

/// Invita a reseñar, explica por qué no se puede o muestra la reseña propia.
class _Mine extends ConsumerWidget {
  const _Mine({required this.slug});
  final String slug;

  Future<void> _delete(BuildContext context, WidgetRef ref) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (dialog) => AlertDialog(
        title: const Text('¿Borrar tu reseña?'),
        content: const Text('Dejará de verse en el producto.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialog, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: PetbfColors.danger),
            onPressed: () => Navigator.pop(dialog, true),
            child: const Text('Borrar'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(apiProvider).deleteReview(slug);
      refreshReviews(ref, slug);
      if (context.mounted) showMessage(context, 'Borraste tu reseña.');
    } catch (e) {
      if (context.mounted) showMessage(context, messageOf(e));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!ref.watch(isSignedInProvider)) {
      return Row(
        children: [
          const Expanded(
            child: Text(
              'Entra a tu cuenta para reseñar los productos que compraste.',
              style: TextStyle(color: PetbfColors.slate),
            ),
          ),
          TextButton(
            onPressed: () => context.push(
              '/entrar?next=${Uri.encodeComponent('/productos/$slug')}',
            ),
            child: const Text('Entrar'),
          ),
        ],
      );
    }
    final mine = ref.watch(myReviewProvider(slug)).value;
    if (mine == null) return const SizedBox.shrink();
    final own = mine.review;
    if (own == null) {
      if (!mine.canReview) {
        return const Text(
          'Podrás dejar una reseña cuando recibas este producto.',
          style: TextStyle(color: PetbfColors.slate),
        );
      }
      return OutlinedButton.icon(
        onPressed: () => showReviewSheet(context, slug: slug),
        icon: const Icon(Icons.rate_review_outlined),
        label: const Text('Escribir una reseña'),
      );
    }
    return Panel(
      color: PetbfColors.mist,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Tu reseña',
            style: TextStyle(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 4),
          if (own.hidden)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Text(
                'El equipo ocultó tu reseña: ${own.hiddenReason ?? ''}',
                style: const TextStyle(
                  color: PetbfColors.danger,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          Stars(own.rating),
          if (own.title != null)
            Text(
              own.title!,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
          Text(own.body),
          Row(
            children: [
              TextButton(
                onPressed: () =>
                    showReviewSheet(context, slug: slug, initial: own),
                child: const Text('Editar'),
              ),
              TextButton(
                style: TextButton.styleFrom(
                  foregroundColor: PetbfColors.danger,
                ),
                onPressed: () => _delete(context, ref),
                child: const Text('Borrar mi reseña'),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Tras guardar o borrar: la reseña propia, la lista y el promedio cambian.
void refreshReviews(WidgetRef ref, String slug) {
  ref.invalidate(myReviewProvider(slug));
  ref.invalidate(reviewsProvider);
  ref.invalidate(productProvider(slug));
}

Future<void> showReviewSheet(
  BuildContext context, {
  required String slug,
  OwnReview? initial,
}) async {
  final saved = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    builder: (sheet) => Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(sheet).bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              initial == null ? 'Escribir una reseña' : 'Editar mi reseña',
              style: Theme.of(sheet).textTheme.titleLarge,
            ),
            const SizedBox(height: 12),
            ReviewForm(
              slug: slug,
              initial: initial,
              onSaved: () => Navigator.pop(sheet, true),
            ),
          ],
        ),
      ),
    ),
  );
  if (saved == true && context.mounted) {
    showMessage(context, '¡Gracias! Tu reseña quedó guardada.');
  }
}

class ReviewForm extends ConsumerStatefulWidget {
  const ReviewForm({
    super.key,
    required this.slug,
    required this.onSaved,
    this.initial,
  });
  final String slug;
  final OwnReview? initial;
  final VoidCallback onSaved;

  @override
  ConsumerState<ReviewForm> createState() => _ReviewFormState();
}

class _ReviewFormState extends ConsumerState<ReviewForm> {
  final _form = GlobalKey<FormState>();
  late final _title = TextEditingController(text: widget.initial?.title);
  late final _body = TextEditingController(text: widget.initial?.body);
  late int? _rating = widget.initial?.rating;
  String? _ratingError;
  String? _error;
  bool _sending = false;

  @override
  void dispose() {
    _title.dispose();
    _body.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_sending) return;
    setState(() {
      _error = null;
      _ratingError = _rating == null ? 'Elige de 1 a 5 estrellas' : null;
    });
    final valid = _form.currentState!.validate();
    if (!valid || _rating == null) return;
    setState(() => _sending = true);
    try {
      await ref
          .read(apiProvider)
          .saveReview(
            widget.slug,
            ReviewInput(rating: _rating!, title: _title.text, body: _body.text),
          );
      refreshReviews(ref, widget.slug);
      widget.onSaved();
    } catch (e) {
      if (mounted) setState(() => _error = messageOf(e));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final rating = _rating;
    return Form(
      key: _form,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_error != null) ...[
            FormErrorBanner(_error!),
            const SizedBox(height: 14),
          ],
          Text('Tu valoración', style: Theme.of(context).textTheme.titleSmall),
          Row(
            children: [
              for (var n = 1; n <= 5; n++)
                IconButton(
                  tooltip: n == 1 ? '1 estrella' : '$n estrellas',
                  isSelected: rating == n,
                  onPressed: () => setState(() {
                    _rating = n;
                    _ratingError = null;
                  }),
                  icon: Icon(
                    rating != null && n <= rating
                        ? Icons.star_rounded
                        : Icons.star_outline_rounded,
                    size: 32,
                    color: rating != null && n <= rating
                        ? PetbfColors.amber
                        : PetbfColors.slate,
                  ),
                ),
            ],
          ),
          if (_ratingError != null)
            Text(
              _ratingError!,
              style: const TextStyle(color: PetbfColors.danger),
            ),
          const SizedBox(height: 12),
          TextFormField(
            controller: _title,
            maxLength: 80,
            validator: validateReviewTitle,
            decoration: const InputDecoration(labelText: 'Título (opcional)'),
          ),
          const SizedBox(height: 8),
          TextFormField(
            controller: _body,
            maxLines: 4,
            maxLength: 1000,
            validator: validateReviewBody,
            decoration: const InputDecoration(labelText: 'Tu experiencia'),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _sending ? null : _submit,
            child: Text(
              _sending
                  ? 'Guardando…'
                  : widget.initial == null
                  ? 'Publicar reseña'
                  : 'Guardar cambios',
            ),
          ),
        ],
      ),
    );
  }
}

/// "También te puede gustar": hasta 4 productos.
class Recommendations extends ConsumerWidget {
  const Recommendations({super.key, required this.slug});
  final String slug;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final items = ref.watch(recommendationsProvider(slug)).value ?? const [];
    if (items.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'También te puede gustar',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 10),
        SizedBox(
          height: 300,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: items.length,
            separatorBuilder: (_, _) => const SizedBox(width: 12),
            itemBuilder: (_, i) =>
                SizedBox(width: 170, child: ProductTile(items[i])),
          ),
        ),
      ],
    );
  }
}
