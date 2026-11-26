import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../models/shop.dart';
import '../../widgets/common.dart';
import 'address_form.dart';

/// Abre el formulario de dirección en una hoja inferior.
Future<Address?> showAddressSheet(BuildContext context, {Address? initial}) {
  return showModalBottomSheet<Address?>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    showDragHandle: true,
    builder: (context) => Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(20, 0, 20, 20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              initial == null ? 'Nueva dirección' : 'Editar dirección',
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 16),
            AddressForm(
              initial: initial,
              onSaved: (address) => Navigator.pop(context, address),
            ),
          ],
        ),
      ),
    ),
  );
}

class AddressesScreen extends ConsumerWidget {
  const AddressesScreen({super.key});

  Future<void> _delete(
    BuildContext context,
    WidgetRef ref,
    Address address,
  ) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('¿Eliminar esta dirección?'),
        content: Text(address.summary),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(backgroundColor: PetbfColors.danger),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Eliminar'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(addressesProvider.notifier).remove(address.id);
      if (context.mounted) showMessage(context, 'Dirección eliminada.');
    } catch (e) {
      if (context.mounted) showMessage(context, messageOf(e));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final addresses = ref.watch(addressesProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Mis direcciones')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          final saved = await showAddressSheet(context);
          if (saved != null && context.mounted) {
            showMessage(context, 'Dirección guardada.');
          }
        },
        icon: const Icon(Icons.add),
        label: const Text('Añadir'),
      ),
      body: switch (addresses) {
        AsyncData(:final value) when value.isEmpty => const EmptyView(
          icon: Icons.location_on_outlined,
          title: 'Sin direcciones',
          message: 'Añade a dónde te enviamos tus pedidos.',
        ),
        AsyncData(:final value) => ListView.separated(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 96),
          itemCount: value.length,
          separatorBuilder: (_, _) => const SizedBox(height: 12),
          itemBuilder: (context, i) {
            final a = value[i];
            return Panel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          a.recipientName,
                          style: const TextStyle(fontWeight: FontWeight.w800),
                        ),
                      ),
                      if (a.isDefault) const OfferBadge('Predeterminada'),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(a.summary),
                  if (a.referencePoint != null)
                    Text(
                      a.referencePoint!,
                      style: const TextStyle(color: PetbfColors.slate),
                    ),
                  Text(
                    a.phone,
                    style: const TextStyle(color: PetbfColors.slate),
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      TextButton.icon(
                        onPressed: () async {
                          await showAddressSheet(context, initial: a);
                        },
                        icon: const Icon(Icons.edit_outlined),
                        label: const Text('Editar'),
                      ),
                      TextButton.icon(
                        style: TextButton.styleFrom(
                          foregroundColor: PetbfColors.danger,
                        ),
                        onPressed: () => _delete(context, ref, a),
                        icon: const Icon(Icons.delete_outline),
                        label: const Text('Eliminar'),
                      ),
                    ],
                  ),
                ],
              ),
            );
          },
        ),
        AsyncError(:final error) => ErrorView(
          error: error,
          onRetry: () => ref.invalidate(addressesProvider),
        ),
        _ => const LoadingView(),
      },
    );
  }
}
