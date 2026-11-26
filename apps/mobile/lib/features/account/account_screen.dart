import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../widgets/common.dart';

class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key});

  Future<void> _logout(BuildContext context, WidgetRef ref) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('¿Cerrar sesión?'),
        content: const Text('Tendrás que volver a entrar para comprar.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Cerrar sesión'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    await ref.read(sessionProvider.notifier).logout();
    if (context.mounted) showMessage(context, 'Cerraste sesión.');
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Tu cuenta')),
      body: switch (session) {
        AsyncData(value: final user?) => ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Panel(
              color: PetbfColors.petbfSoft,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Hola, ${user.firstName}',
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                  const SizedBox(height: 4),
                  Text(user.email),
                  if (user.phone != null) Text(user.phone!),
                ],
              ),
            ),
            const SizedBox(height: 16),
            ListTile(
              leading: const Icon(Icons.receipt_long_outlined),
              title: const Text('Mis pedidos'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/pedidos'),
            ),
            const Divider(),
            ListTile(
              leading: const Icon(Icons.location_on_outlined),
              title: const Text('Mis direcciones'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/cuenta/direcciones'),
            ),
            const Divider(),
            ListTile(
              leading: const Icon(Icons.logout, color: PetbfColors.danger),
              title: const Text(
                'Cerrar sesión',
                style: TextStyle(color: PetbfColors.danger),
              ),
              onTap: () => _logout(context, ref),
            ),
          ],
        ),
        AsyncData() => const SignInPrompt(
          message:
              'Así puedes comprar, seguir tus pedidos y guardar direcciones.',
          from: '/cuenta',
        ),
        AsyncError(:final error) => ErrorView(
          error: error,
          onRetry: () => ref.invalidate(sessionProvider),
        ),
        _ => const LoadingView(),
      },
    );
  }
}
