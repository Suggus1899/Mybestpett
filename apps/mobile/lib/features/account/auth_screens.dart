import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/validators.dart';
import '../../widgets/common.dart';

/// Campo de contraseña con botón para mostrarla.
class PasswordField extends StatefulWidget {
  const PasswordField({
    super.key,
    required this.controller,
    required this.validator,
    required this.label,
    this.helper,
    this.autofill,
    this.onSubmitted,
  });
  final TextEditingController controller;
  final FormFieldValidator<String> validator;
  final String label;
  final String? helper;
  final String? autofill;
  final VoidCallback? onSubmitted;

  @override
  State<PasswordField> createState() => _PasswordFieldState();
}

class _PasswordFieldState extends State<PasswordField> {
  bool _visible = false;

  @override
  Widget build(BuildContext context) => TextFormField(
    controller: widget.controller,
    obscureText: !_visible,
    enableSuggestions: false,
    autocorrect: false,
    maxLength: 128,
    maxLengthEnforcement: MaxLengthEnforcement.enforced,
    autofillHints: widget.autofill == null ? null : [widget.autofill!],
    validator: widget.validator,
    textInputAction: TextInputAction.done,
    onFieldSubmitted: (_) => widget.onSubmitted?.call(),
    decoration: InputDecoration(
      labelText: widget.label,
      helperText: widget.helper,
      counterText: '',
      suffixIcon: IconButton(
        tooltip: _visible ? 'Ocultar contraseña' : 'Mostrar contraseña',
        icon: Icon(_visible ? Icons.visibility_off : Icons.visibility),
        onPressed: () => setState(() => _visible = !_visible),
      ),
    ),
  );
}

/// Aviso de error dentro de un formulario.
class FormErrorBanner extends StatelessWidget {
  const FormErrorBanner(this.message, {super.key});
  final String message;
  @override
  Widget build(BuildContext context) => Semantics(
    liveRegion: true,
    child: Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: PetbfColors.dangerSoft,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        message,
        style: const TextStyle(
          color: PetbfColors.danger,
          fontWeight: FontWeight.w700,
        ),
      ),
    ),
  );
}

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key, required this.next});
  final String next;

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _sending = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_sending) return;
    setState(() => _error = null);
    if (!_form.currentState!.validate()) return;
    setState(() => _sending = true);
    try {
      await ref
          .read(sessionProvider.notifier)
          .login(_email.text, _password.text);
      if (mounted) context.go(widget.next);
    } catch (e) {
      if (mounted) setState(() => _error = messageOf(e));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Entrar')),
      body: SafeArea(
        child: Form(
          key: _form,
          child: AutofillGroup(
            child: ListView(
              padding: const EdgeInsets.all(20),
              children: [
                Text(
                  'Hola de nuevo',
                  style: Theme.of(context).textTheme.headlineMedium,
                ),
                const SizedBox(height: 6),
                const Text(
                  'Entra para comprar y ver tus pedidos.',
                  style: TextStyle(color: PetbfColors.slate),
                ),
                const SizedBox(height: 20),
                if (_error != null) ...[
                  FormErrorBanner(_error!),
                  const SizedBox(height: 16),
                ],
                TextFormField(
                  controller: _email,
                  keyboardType: TextInputType.emailAddress,
                  autocorrect: false,
                  autofillHints: const [AutofillHints.email],
                  textInputAction: TextInputAction.next,
                  validator: validateEmail,
                  decoration: const InputDecoration(labelText: 'Correo'),
                ),
                const SizedBox(height: 16),
                PasswordField(
                  controller: _password,
                  label: 'Contraseña',
                  validator: validateLoginPassword,
                  autofill: AutofillHints.password,
                  onSubmitted: _submit,
                ),
                const SizedBox(height: 24),
                FilledButton(
                  onPressed: _sending ? null : _submit,
                  child: Text(_sending ? 'Entrando…' : 'Entrar'),
                ),
                const SizedBox(height: 12),
                TextButton(
                  onPressed: _sending
                      ? null
                      : () => context.pushReplacement(
                          Uri(
                            path: '/registro',
                            queryParameters: {'next': widget.next},
                          ).toString(),
                        ),
                  child: const Text('¿No tienes cuenta? Regístrate'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key, required this.next});
  final String next;

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _form = GlobalKey<FormState>();
  final _firstName = TextEditingController();
  final _lastName = TextEditingController();
  final _email = TextEditingController();
  final _phone = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  bool _sending = false;
  String? _error;

  @override
  void dispose() {
    for (final c in [
      _firstName,
      _lastName,
      _email,
      _phone,
      _password,
      _confirm,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    if (_sending) return;
    setState(() => _error = null);
    if (!_form.currentState!.validate()) return;
    setState(() => _sending = true);
    try {
      await ref
          .read(sessionProvider.notifier)
          .register(
            email: _email.text,
            password: _password.text,
            firstName: _firstName.text,
            lastName: _lastName.text,
            phone: _phone.text,
          );
      if (mounted) context.go(widget.next);
    } catch (e) {
      if (mounted) setState(() => _error = messageOf(e));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Crear cuenta')),
      body: SafeArea(
        child: Form(
          key: _form,
          child: AutofillGroup(
            child: ListView(
              padding: const EdgeInsets.all(20),
              children: [
                const Text(
                  'Necesitas una cuenta para comprar. Tus datos solo se usan para tus pedidos.',
                  style: TextStyle(color: PetbfColors.slate),
                ),
                const SizedBox(height: 20),
                if (_error != null) ...[
                  FormErrorBanner(_error!),
                  const SizedBox(height: 16),
                ],
                TextFormField(
                  controller: _firstName,
                  textCapitalization: TextCapitalization.words,
                  autofillHints: const [AutofillHints.givenName],
                  textInputAction: TextInputAction.next,
                  maxLength: 80,
                  validator: requiredText('tu nombre', 80),
                  decoration: const InputDecoration(
                    labelText: 'Nombre',
                    counterText: '',
                  ),
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _lastName,
                  textCapitalization: TextCapitalization.words,
                  autofillHints: const [AutofillHints.familyName],
                  textInputAction: TextInputAction.next,
                  maxLength: 80,
                  validator: requiredText('tu apellido', 80),
                  decoration: const InputDecoration(
                    labelText: 'Apellido',
                    counterText: '',
                  ),
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _email,
                  keyboardType: TextInputType.emailAddress,
                  autocorrect: false,
                  autofillHints: const [AutofillHints.email],
                  textInputAction: TextInputAction.next,
                  validator: validateEmail,
                  decoration: const InputDecoration(labelText: 'Correo'),
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _phone,
                  keyboardType: TextInputType.phone,
                  autofillHints: const [AutofillHints.telephoneNumber],
                  textInputAction: TextInputAction.next,
                  validator: validateOptionalPhone,
                  decoration: const InputDecoration(
                    labelText: 'Teléfono (opcional)',
                    hintText: '0412-1234567',
                  ),
                ),
                const SizedBox(height: 16),
                PasswordField(
                  controller: _password,
                  label: 'Contraseña',
                  helper: 'Al menos 8 caracteres',
                  validator: validateNewPassword,
                  autofill: AutofillHints.newPassword,
                ),
                const SizedBox(height: 16),
                PasswordField(
                  controller: _confirm,
                  label: 'Repite la contraseña',
                  validator: (value) => value != _password.text
                      ? 'Las contraseñas no coinciden'
                      : null,
                  autofill: AutofillHints.newPassword,
                  onSubmitted: _submit,
                ),
                const SizedBox(height: 24),
                FilledButton(
                  onPressed: _sending ? null : _submit,
                  child: Text(_sending ? 'Creando cuenta…' : 'Crear cuenta'),
                ),
                const SizedBox(height: 12),
                TextButton(
                  onPressed: _sending
                      ? null
                      : () => context.pushReplacement(
                          Uri(
                            path: '/entrar',
                            queryParameters: {'next': widget.next},
                          ).toString(),
                        ),
                  child: const Text('¿Ya tienes cuenta? Entra'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
