import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/format.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../models/catalog.dart';
import '../../widgets/common.dart';
import '../catalog/product_screen.dart';

class AnimalScreen extends ConsumerWidget {
  const AnimalScreen({super.key, required this.slug});
  final String slug;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final animal = ref.watch(animalProvider(slug));
    return Scaffold(
      appBar: AppBar(),
      body: switch (animal) {
        AsyncData(:final value) => _AnimalView(
          animal: value,
          now: ref.read(clockProvider)(),
        ),
        AsyncError(:final error) => ErrorView(
          error: error,
          onRetry: () => ref.invalidate(animalProvider(slug)),
        ),
        _ => const LoadingView(),
      },
    );
  }
}

class _AnimalView extends StatelessWidget {
  const _AnimalView({required this.animal, required this.now});
  final Animal animal;
  final DateTime now;

  @override
  Widget build(BuildContext context) {
    final a = animal;
    final text = Theme.of(context).textTheme;
    final facts = [
      ('Especie', a.species.singular),
      ('Raza', a.breed ?? 'Mestizo'),
      ('Sexo', a.sex.label),
      ('Edad', a.birthDate == null ? 'Sin dato' : formatAge(a.birthDate!, now)),
      ('Vacunado', a.isVaccinated ? 'Sí' : 'No'),
      ('Esterilizado', a.isSterilized ? 'Sí' : 'No'),
    ];
    final isAdoption = a.listingType == ListingType.adoption;

    return ListView(
      children: [
        Gallery(images: a.images, fallback: a.species.label),
        Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                isAdoption ? 'En adopción' : 'En venta',
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: PetbfColors.slate,
                ),
              ),
              Text(a.name, style: text.headlineMedium),
              if (a.status == AnimalStatus.reserved) ...[
                const SizedBox(height: 4),
                const Text(
                  'Reservado: ya hay alguien interesado.',
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                    color: PetbfColors.slate,
                  ),
                ),
              ],
              const SizedBox(height: 10),
              if (!isAdoption && a.priceUsdCents != null)
                PriceView(usdCents: a.priceUsdCents!, large: true)
              else
                const Text(
                  'En adopción',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                    color: PetbfColors.petbf,
                  ),
                ),
              const SizedBox(height: 16),
              Panel(
                child: GridView.count(
                  crossAxisCount: 2,
                  shrinkWrap: true,
                  physics: const NeverScrollableScrollPhysics(),
                  childAspectRatio: 3,
                  children: [
                    for (final (label, value) in facts)
                      MergeSemantics(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              label,
                              style: const TextStyle(
                                fontSize: 13,
                                color: PetbfColors.slate,
                              ),
                            ),
                            Text(
                              value,
                              style: const TextStyle(
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              Text(a.description),
              const SizedBox(height: 16),
              // Igual que en la web: las solicitudes y reservas llegan después.
              Panel(
                color: PetbfColors.petbfSoft,
                child: Text(
                  isAdoption
                      ? 'Las solicitudes de adopción se abren en la próxima versión.'
                      : 'La reserva y el pago se abren en la próxima versión.',
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
