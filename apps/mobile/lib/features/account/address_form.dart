import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/providers.dart';
import '../../core/validators.dart';
import '../../models/shop.dart';
import '../../widgets/common.dart';
import 'auth_screens.dart';

/// Formulario de dirección de envío (crear o editar). Devuelve la dirección
/// guardada con [onSaved].
class AddressForm extends ConsumerStatefulWidget {
  const AddressForm({super.key, this.initial, this.onSaved, this.submitLabel});
  final Address? initial;
  final ValueChanged<Address?>? onSaved;
  final String? submitLabel;

  @override
  ConsumerState<AddressForm> createState() => _AddressFormState();
}

class _AddressFormState extends ConsumerState<AddressForm> {
  final _form = GlobalKey<FormState>();
  late final _recipient = TextEditingController(
    text: widget.initial?.recipientName,
  );
  late final _phone = TextEditingController(text: widget.initial?.phone);
  late final _city = TextEditingController(text: widget.initial?.city);
  late final _municipality = TextEditingController(
    text: widget.initial?.municipality,
  );
  late final _line1 = TextEditingController(text: widget.initial?.line1);
  late final _reference = TextEditingController(
    text: widget.initial?.referencePoint,
  );
  late String? _state = widget.initial?.state;
  late bool _isDefault = widget.initial?.isDefault ?? false;
  bool _sending = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    // Se proponen el nombre y teléfono de la cuenta en una dirección nueva.
    if (widget.initial == null) {
      final user = ref.read(sessionProvider).value;
      if (user != null) {
        _recipient.text = user.fullName;
        _phone.text = user.phone ?? '';
      }
    }
  }

  @override
  void dispose() {
    for (final c in [
      _recipient,
      _phone,
      _city,
      _municipality,
      _line1,
      _reference,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    if (_sending) return;
    setState(() => _error = null);
    if (!_form.currentState!.validate()) return;
    final input = AddressInput(
      recipientName: _recipient.text,
      phone: _phone.text,
      state: _state!,
      city: _city.text,
      municipality: _municipality.text,
      line1: _line1.text,
      referencePoint: _reference.text,
      isDefault: _isDefault,
    );
    setState(() => _sending = true);
    try {
      final controller = ref.read(addressesProvider.notifier);
      final initial = widget.initial;
      if (initial == null) {
        // Ojo: `onSaved?.call(await …)` no evaluaría el argumento si
        // onSaved es null, y la dirección nunca se crearía.
        final created = await controller.create(input);
        widget.onSaved?.call(created);
      } else {
        await controller.edit(initial.id, input);
        widget.onSaved?.call(null);
      }
    } catch (e) {
      if (mounted) setState(() => _error = messageOf(e));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  InputDecoration _decoration(String label, {String? hint}) =>
      InputDecoration(labelText: label, hintText: hint, counterText: '');

  @override
  Widget build(BuildContext context) {
    const gap = SizedBox(height: 14);
    return Form(
      key: _form,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_error != null) ...[FormErrorBanner(_error!), gap],
          TextFormField(
            controller: _recipient,
            textCapitalization: TextCapitalization.words,
            maxLength: 120,
            validator: requiredText('quién recibe', 120),
            decoration: _decoration('Quién recibe'),
          ),
          gap,
          TextFormField(
            controller: _phone,
            keyboardType: TextInputType.phone,
            validator: validatePhone,
            decoration: _decoration('Teléfono', hint: '0412-1234567'),
          ),
          gap,
          DropdownButtonFormField<String>(
            initialValue: _state,
            isExpanded: true,
            validator: validateState,
            decoration: _decoration('Estado'),
            items: [
              for (final s in veStates)
                DropdownMenuItem(value: s, child: Text(s)),
            ],
            onChanged: (value) => setState(() => _state = value),
          ),
          gap,
          TextFormField(
            controller: _city,
            textCapitalization: TextCapitalization.words,
            maxLength: 80,
            validator: requiredText('la ciudad', 80),
            decoration: _decoration('Ciudad'),
          ),
          gap,
          TextFormField(
            controller: _municipality,
            textCapitalization: TextCapitalization.words,
            maxLength: 80,
            validator: optionalText(80),
            decoration: _decoration('Municipio (opcional)'),
          ),
          gap,
          TextFormField(
            controller: _line1,
            maxLength: 200,
            minLines: 1,
            maxLines: 3,
            validator: requiredText('la dirección', 200),
            decoration: _decoration(
              'Dirección',
              hint: 'Calle, edificio o casa, piso y apartamento',
            ),
          ),
          gap,
          TextFormField(
            controller: _reference,
            maxLength: 200,
            minLines: 1,
            maxLines: 3,
            validator: optionalText(200),
            decoration: _decoration(
              'Punto de referencia (opcional)',
              hint: 'Frente a la panadería…',
            ),
          ),
          // No se puede quitar la predeterminada sin elegir otra (regla de la API).
          if (widget.initial?.isDefault != true)
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              value: _isDefault,
              onChanged: (value) => setState(() => _isDefault = value ?? false),
              title: const Text('Usar como dirección predeterminada'),
              controlAffinity: ListTileControlAffinity.leading,
            ),
          gap,
          FilledButton(
            onPressed: _sending ? null : _submit,
            child: Text(
              _sending
                  ? 'Guardando…'
                  : widget.submitLabel ?? 'Guardar dirección',
            ),
          ),
        ],
      ),
    );
  }
}
