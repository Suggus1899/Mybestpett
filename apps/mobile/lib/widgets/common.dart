import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../core/api_client.dart';
import '../core/format.dart';
import '../core/providers.dart';
import '../core/theme.dart';
import '../core/validators.dart';
import '../models/catalog.dart';
import '../models/shop.dart';

/// Mensaje para la persona a partir de cualquier error.
String messageOf(Object error) =>
    error is ApiException ? error.message : genericErrorMessage;

void showMessage(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(content: Text(message)));
}

class LoadingView extends StatelessWidget {
  const LoadingView({super.key});
  @override
  Widget build(BuildContext context) => const Center(
    child: Padding(
      padding: EdgeInsets.all(32),
      child: CircularProgressIndicator(semanticsLabel: 'Cargando'),
    ),
  );
}

class ErrorView extends StatelessWidget {
  const ErrorView({super.key, required this.error, this.onRetry});
  final Object error;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final notFound =
        error is ApiException && (error as ApiException).isNotFound;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              notFound ? Icons.search_off : Icons.wifi_off,
              size: 48,
              color: PetbfColors.slate,
            ),
            const SizedBox(height: 12),
            Text(
              notFound ? 'No lo encontramos' : 'No se pudo cargar',
              style: Theme.of(context).textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 6),
            Text(
              messageOf(error),
              textAlign: TextAlign.center,
              style: const TextStyle(color: PetbfColors.slate),
            ),
            if (onRetry != null && !notFound) ...[
              const SizedBox(height: 16),
              OutlinedButton(
                onPressed: onRetry,
                child: const Text('Reintentar'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class EmptyView extends StatelessWidget {
  const EmptyView({
    super.key,
    required this.icon,
    required this.title,
    required this.message,
    this.action,
  });
  final IconData icon;
  final String title;
  final String message;
  final Widget? action;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          CircleAvatar(
            radius: 44,
            backgroundColor: PetbfColors.mist,
            child: Icon(icon, size: 40, color: PetbfColors.petbf),
          ),
          const SizedBox(height: 14),
          Text(
            title,
            style: Theme.of(context).textTheme.titleLarge,
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 6),
          Text(
            message,
            textAlign: TextAlign.center,
            style: const TextStyle(color: PetbfColors.slate),
          ),
          if (action != null) ...[const SizedBox(height: 16), action!],
        ],
      ),
    ),
  );
}

/// Precio en dólares con su equivalente en bolívares a la tasa BCV.
class PriceView extends ConsumerWidget {
  const PriceView({
    super.key,
    required this.usdCents,
    this.compareAtUsdCents,
    this.from = false,
    this.large = false,
  });
  final int usdCents;
  final int? compareAtUsdCents;
  final bool from;
  final bool large;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rate = ref.watch(usdVesProvider);
    final style = TextStyle(
      fontSize: large ? 26 : 17,
      fontWeight: FontWeight.w800,
      color: PetbfColors.ink,
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Wrap(
          crossAxisAlignment: WrapCrossAlignment.end,
          spacing: 8,
          children: [
            Text.rich(
              TextSpan(
                children: [
                  if (from)
                    const TextSpan(
                      text: 'Desde ',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        color: PetbfColors.slate,
                      ),
                    ),
                  TextSpan(text: formatUsd(usdCents), style: style),
                ],
              ),
            ),
            if (compareAtUsdCents != null)
              Semantics(
                label: 'Antes ${formatUsd(compareAtUsdCents!)}',
                child: ExcludeSemantics(
                  child: Text(
                    formatUsd(compareAtUsdCents!),
                    style: const TextStyle(
                      color: PetbfColors.slate,
                      decoration: TextDecoration.lineThrough,
                    ),
                  ),
                ),
              ),
          ],
        ),
        if (rate != null)
          Text(
            formatBs(usdCents, rate),
            style: const TextStyle(fontSize: 13, color: PetbfColors.slate),
          ),
      ],
    );
  }
}

/// Etiqueta ámbar de oferta: "−17 %".
class OfferBadge extends StatelessWidget {
  const OfferBadge(this.text, {super.key});
  final String text;
  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
    decoration: BoxDecoration(
      color: PetbfColors.amber,
      borderRadius: BorderRadius.circular(6),
    ),
    child: Text(
      text,
      style: const TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.w800,
        color: PetbfColors.ink,
      ),
    ),
  );
}

/// Foto remota con un recuadro de respaldo si no hay o no carga.
class NetImage extends StatelessWidget {
  const NetImage({
    super.key,
    required this.image,
    required this.fallback,
    this.fit = BoxFit.cover,
  });
  final ImageRef? image;
  final String fallback;
  final BoxFit fit;

  @override
  Widget build(BuildContext context) {
    final placeholder = ColoredBox(
      color: PetbfColors.petbfSoft,
      child: Center(
        child: Text(
          fallback,
          textAlign: TextAlign.center,
          style: const TextStyle(
            fontFamily: 'Fredoka',
            fontWeight: FontWeight.w600,
            fontSize: 18,
            color: PetbfColors.petbf,
          ),
        ),
      ),
    );
    final img = image;
    if (img == null) return ExcludeSemantics(child: placeholder);
    return Image.network(
      img.url,
      fit: fit,
      semanticLabel: img.alt,
      errorBuilder: (_, _, _) => ExcludeSemantics(child: placeholder),
      loadingBuilder: (_, child, progress) =>
          progress == null ? child : const ColoredBox(color: PetbfColors.mist),
    );
  }
}

class StatusChip extends StatelessWidget {
  const StatusChip(this.status, {super.key});
  final OrderStatus status;

  @override
  Widget build(BuildContext context) {
    final (background, foreground) = switch (status) {
      OrderStatus.pendingPayment ||
      OrderStatus.paymentReported => (const Color(0xFFFDE7CC), PetbfColors.ink),
      OrderStatus.paid ||
      OrderStatus.preparing ||
      OrderStatus.shipped => (PetbfColors.petbfSoft, PetbfColors.petbfDark),
      OrderStatus.delivered => (PetbfColors.petbf, Colors.white),
      OrderStatus.cancelled => (PetbfColors.dangerSoft, PetbfColors.danger),
      OrderStatus.refunded => (PetbfColors.mist, PetbfColors.slate),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        status.label,
        style: TextStyle(
          fontSize: 13,
          fontWeight: FontWeight.w800,
          color: foreground,
        ),
      ),
    );
  }
}

/// Selector de cantidad con botones de 44 px.
class QuantityStepper extends StatelessWidget {
  const QuantityStepper({
    super.key,
    required this.value,
    required this.onChanged,
    this.min = 1,
    this.max = maxQuantity,
    this.enabled = true,
    this.label = 'Cantidad',
  });
  final int value;
  final int min;
  final int max;
  final bool enabled;
  final String label;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    Widget button(IconData icon, String tooltip, int? next) => IconButton(
      icon: Icon(icon, size: 18),
      tooltip: tooltip,
      constraints: const BoxConstraints.tightFor(width: 44, height: 44),
      style: IconButton.styleFrom(backgroundColor: PetbfColors.mist),
      onPressed: enabled && next != null ? () => onChanged(next) : null,
    );
    return Semantics(
      label: label,
      value: '$value',
      child: Container(
        padding: const EdgeInsets.all(2),
        decoration: BoxDecoration(
          border: Border.all(color: PetbfColors.line),
          borderRadius: BorderRadius.circular(999),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            button(Icons.remove, 'Quitar uno', value > min ? value - 1 : null),
            SizedBox(
              width: 36,
              child: Text(
                '$value',
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ),
            button(Icons.add, 'Añadir uno', value < max ? value + 1 : null),
          ],
        ),
      ),
    );
  }
}

/// Para pantallas que exigen cuenta: invita a entrar y vuelve aquí después.
class SignInPrompt extends StatelessWidget {
  const SignInPrompt({super.key, required this.message, required this.from});
  final String message;
  final String from;

  @override
  Widget build(BuildContext context) => EmptyView(
    icon: Icons.person_outline,
    title: 'Entra a tu cuenta',
    message: message,
    action: Column(
      children: [
        FilledButton(
          onPressed: () => context.push(
            Uri(path: '/entrar', queryParameters: {'next': from}).toString(),
          ),
          child: const Text('Entrar'),
        ),
        const SizedBox(height: 8),
        TextButton(
          onPressed: () => context.push(
            Uri(path: '/registro', queryParameters: {'next': from}).toString(),
          ),
          child: const Text('Crear una cuenta'),
        ),
      ],
    ),
  );
}

class SectionTitle extends StatelessWidget {
  const SectionTitle(this.text, {super.key, this.trailing});
  final String text;
  final Widget? trailing;
  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(
        child: Semantics(
          header: true,
          child: Text(text, style: Theme.of(context).textTheme.titleMedium),
        ),
      ),
      ?trailing,
    ],
  );
}

/// Tarjeta con borde suave para agrupar contenido.
class Panel extends StatelessWidget {
  const Panel({super.key, required this.child, this.color});
  final Widget child;
  final Color? color;
  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: color ?? Colors.white,
      borderRadius: BorderRadius.circular(16),
      border: color == null ? Border.all(color: PetbfColors.line) : null,
    ),
    child: child,
  );
}
