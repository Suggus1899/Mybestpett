import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/api_client.dart';
import '../../core/format.dart';
import '../../core/money.dart';
import '../../core/providers.dart';
import '../../core/theme.dart';
import '../../core/validators.dart';
import '../../models/catalog.dart';
import '../../models/shop.dart';
import '../../widgets/common.dart';
import '../account/address_form.dart';
import '../account/addresses_screen.dart';
import '../account/auth_screens.dart';

class CheckoutScreen extends ConsumerWidget {
  const CheckoutScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final cart = ref.watch(cartProvider);
    final addresses = ref.watch(addressesProvider);
    final zones = ref.watch(shippingZonesProvider);
    final methods = ref.watch(paymentMethodsProvider);
    final rates = ref.watch(ratesProvider);

    Widget body;
    final error = [
      cart,
      addresses,
      zones,
      methods,
    ].where((a) => a.hasError && !a.hasValue).firstOrNull?.error;
    if (error != null) {
      body = ErrorView(
        error: error,
        onRetry: () {
          ref.invalidate(cartProvider);
          ref.invalidate(addressesProvider);
          ref.invalidate(shippingZonesProvider);
          ref.invalidate(paymentMethodsProvider);
        },
      );
    } else if (!cart.hasValue ||
        !addresses.hasValue ||
        !zones.hasValue ||
        !methods.hasValue) {
      body = const LoadingView();
    } else if (!cart.requireValue.canCheckout) {
      body = EmptyView(
        icon: Icons.shopping_bag_outlined,
        title: cart.requireValue.items.isEmpty
            ? 'Tu carrito está vacío'
            : 'Revisa tu carrito',
        message: cart.requireValue.items.isEmpty
            ? 'Añade productos para hacer un pedido.'
            : 'Algún producto ya no tiene stock suficiente.',
        action: FilledButton(
          onPressed: () => context.go('/carrito'),
          child: const Text('Ir al carrito'),
        ),
      );
    } else if (addresses.requireValue.isEmpty) {
      body = ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text(
            '¿A dónde te lo enviamos?',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 16),
          const AddressForm(submitLabel: 'Guardar y continuar'),
        ],
      );
    } else {
      body = CheckoutForm(
        cart: cart.requireValue,
        addresses: addresses.requireValue,
        zones: zones.requireValue,
        methods: methods.requireValue,
        rates: rates.value ?? const Rates(),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('Finalizar compra')),
      body: body,
    );
  }
}

class CheckoutForm extends ConsumerStatefulWidget {
  const CheckoutForm({
    super.key,
    required this.cart,
    required this.addresses,
    required this.zones,
    required this.methods,
    required this.rates,
  });
  final Cart cart;
  final List<Address> addresses;
  final List<ShippingZone> zones;
  final List<PaymentMethod> methods;
  final Rates rates;

  @override
  ConsumerState<CheckoutForm> createState() => _CheckoutFormState();
}

class _CheckoutFormState extends ConsumerState<CheckoutForm> {
  String? _addressId;
  String? _zoneId;
  String? _methodId;
  bool _terms = false;
  bool _termsError = false;
  bool _sending = false;
  String? _error;

  // Cupón: el carrito "probado" por la API con el código, o el error.
  final _coupon = TextEditingController();
  Cart? _quoted;
  String? _couponError;
  bool _checkingCoupon = false;

  /// El carrito con el cupón aplicado, si lo hay.
  Cart get _cart => _quoted ?? widget.cart;

  @override
  void dispose() {
    _coupon.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(CheckoutForm old) {
    super.didUpdateWidget(old);
    // El carrito cambió (stock, precios): el cupón probado ya no vale.
    if (!identical(old.cart, widget.cart)) _quoted = null;
  }

  Future<void> _applyCoupon() async {
    final problem = validateCouponCode(_coupon.text);
    if (problem != null) {
      setState(() => _couponError = problem);
      return;
    }
    if (_checkingCoupon) return;
    setState(() {
      _couponError = null;
      _checkingCoupon = true;
    });
    try {
      final quoted = await ref
          .read(apiProvider)
          .cart(coupon: normalizeCouponCode(_coupon.text));
      if (mounted) setState(() => _quoted = quoted);
    } on ApiException catch (e) {
      // Sin cupón se sigue con el carrito normal.
      if (mounted) {
        setState(() {
          _quoted = null;
          _couponError = e.message;
        });
      }
    } finally {
      if (mounted) setState(() => _checkingCoupon = false);
    }
  }

  void _removeCoupon() => setState(() {
    _quoted = null;
    _couponError = null;
    _coupon.clear();
  });

  Address get _address =>
      widget.addresses.where((a) => a.id == _addressId).firstOrNull ??
      widget.addresses.firstWhere(
        (a) => a.isDefault,
        orElse: () => widget.addresses.first,
      );

  List<ShippingZone> get _zones =>
      widget.zones.where((z) => z.states.contains(_address.state)).toList();

  ShippingZone? get _zone =>
      _zones.where((z) => z.id == _zoneId).firstOrNull ?? _zones.firstOrNull;

  int? _estimate(PaymentMethod method, int totalCents) => chargeCents(
    totalCents,
    method.currency,
    usdVes: widget.rates.usdVes,
    eurVes: widget.rates.eurVes,
  );

  PaymentMethod? get _method {
    final selected = widget.methods.where((m) => m.id == _methodId).firstOrNull;
    return selected ?? widget.methods.firstOrNull;
  }

  Future<void> _submit() async {
    final zone = _zone;
    final method = _method;
    setState(() {
      _error = null;
      _termsError = !_terms;
    });
    if (zone == null || method == null || !_terms || _sending) return;
    setState(() => _sending = true);
    try {
      final order = await ref
          .read(apiProvider)
          .checkout(
            addressId: _address.id,
            shippingZoneId: zone.id,
            paymentMethodId: method.id,
            couponCode: _cart.coupon?.code,
          );
      ref.read(cartProvider.notifier).markEmpty();
      ref.invalidate(ordersProvider);
      if (mounted) context.pushReplacement('/pedidos/${order.id}');
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        // Si el cupón dejó de valer (se agotó, venció), se quita para que
        // se vea el total real y se pueda reintentar sin él.
        if (e.status == 400 && _quoted != null) _quoted = null;
      });
      // Stock o precios cambiaron: se recarga el carrito para mostrar lo real.
      if (e.status == 409 || e.status == 400) ref.invalidate(cartProvider);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final address = _address;
    final zone = _zone;
    final method = _method;
    final cart = _cart;
    // El envío gratis se mide con lo que se paga por los productos.
    final items = cart.itemsTotalUsdCents;
    final shipping = zone?.costFor(items) ?? 0;
    final total = items + shipping;
    final estimate = method == null ? null : _estimate(method, total);

    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        if (_error != null) ...[
          FormErrorBanner(_error!),
          const SizedBox(height: 16),
        ],
        Text('Dirección de envío', style: text.titleMedium),
        const SizedBox(height: 8),
        RadioGroup<String>(
          groupValue: address.id,
          onChanged: (id) => setState(() {
            _addressId = id;
            _zoneId = null; // la zona depende del estado de la dirección
          }),
          child: Column(
            children: [
              for (final a in widget.addresses)
                RadioListTile<String>(
                  value: a.id,
                  contentPadding: EdgeInsets.zero,
                  title: Text(
                    a.recipientName,
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                  subtitle: Text('${a.summary}\n${a.phone}'),
                  isThreeLine: true,
                ),
            ],
          ),
        ),
        Align(
          alignment: Alignment.centerLeft,
          child: TextButton.icon(
            onPressed: widget.addresses.length >= 10
                ? null
                : () async {
                    final saved = await showAddressSheet(context);
                    if (saved != null && mounted) {
                      setState(() {
                        _addressId = saved.id;
                        _zoneId = null;
                      });
                    }
                  },
            icon: const Icon(Icons.add),
            label: const Text('Añadir otra dirección'),
          ),
        ),
        const SizedBox(height: 16),
        Text('Envío', style: text.titleMedium),
        const SizedBox(height: 8),
        if (_zones.isEmpty)
          Panel(
            color: PetbfColors.dangerSoft,
            child: Text(
              'Todavía no enviamos a ${address.state}. Elige otra dirección o escríbenos.',
              style: const TextStyle(color: PetbfColors.danger),
            ),
          )
        else
          RadioGroup<String>(
            groupValue: zone?.id,
            onChanged: (id) => setState(() => _zoneId = id),
            child: Column(
              children: [
                for (final z in _zones)
                  RadioListTile<String>(
                    value: z.id,
                    contentPadding: EdgeInsets.zero,
                    title: Text(
                      z.name,
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                    subtitle: Text(
                      '${z.carrier} · ${z.costFor(items) == 0 ? 'Gratis' : formatUsd(z.priceUsdCents)}',
                    ),
                  ),
              ],
            ),
          ),
        const SizedBox(height: 16),
        Text('Método de pago', style: text.titleMedium),
        const SizedBox(height: 4),
        const Text(
          'Pagas por tu cuenta y luego reportas la referencia; el equipo la verifica.',
          style: TextStyle(fontSize: 13, color: PetbfColors.slate),
        ),
        const SizedBox(height: 8),
        if (widget.methods.isEmpty)
          const Text('No hay métodos de pago disponibles ahora mismo.')
        else
          RadioGroup<String>(
            groupValue: method?.id,
            onChanged: (id) => setState(() => _methodId = id),
            child: Column(
              children: [
                for (final m in widget.methods)
                  RadioListTile<String>(
                    value: m.id,
                    contentPadding: EdgeInsets.zero,
                    title: Text(
                      m.name,
                      style: const TextStyle(fontWeight: FontWeight.w700),
                    ),
                    subtitle: Text(switch (_estimate(m, total)) {
                      null => 'Sin tasa del BCV cargada hoy para esta moneda',
                      final cents => formatMoneyCents(cents, m.currency),
                    }),
                  ),
              ],
            ),
          ),
        const SizedBox(height: 16),
        Text('Cupón de descuento', style: text.titleMedium),
        const SizedBox(height: 8),
        if (cart.coupon case final coupon?)
          Panel(
            color: PetbfColors.petbfSoft,
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    '${coupon.code}: ${coupon.description}',
                    style: const TextStyle(fontWeight: FontWeight.w700),
                  ),
                ),
                TextButton(
                  onPressed: _removeCoupon,
                  child: const Text('Quitar cupón'),
                ),
              ],
            ),
          )
        else
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: TextField(
                  controller: _coupon,
                  maxLength: 30,
                  textCapitalization: TextCapitalization.characters,
                  autocorrect: false,
                  onSubmitted: (_) => _applyCoupon(),
                  decoration: InputDecoration(
                    labelText: 'Código del cupón',
                    counterText: '',
                    errorText: _couponError,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Padding(
                padding: const EdgeInsets.only(top: 6),
                child: OutlinedButton(
                  onPressed: _checkingCoupon ? null : _applyCoupon,
                  child: Text(_checkingCoupon ? 'Probando…' : 'Aplicar'),
                ),
              ),
            ],
          ),
        const SizedBox(height: 4),
        const Text(
          'Un cupón por pedido. Se aplica sobre los productos, no sobre el envío.',
          style: TextStyle(fontSize: 13, color: PetbfColors.slate),
        ),
        const SizedBox(height: 16),
        Panel(
          color: PetbfColors.mist,
          child: Column(
            children: [
              _Row(
                cart.hasDiscounts ? 'Productos (precio de lista)' : 'Subtotal',
                formatUsd(cart.subtotalUsdCents),
              ),
              for (final c in cart.combos)
                _Row(c.label, '−${formatUsd(c.savingsUsdCents)}', accent: true),
              if (cart.coupon case final coupon?)
                _Row(
                  'Cupón ${coupon.code}',
                  '−${formatUsd(coupon.discountUsdCents)}',
                  accent: true,
                ),
              if (cart.hasDiscounts)
                _Row('Productos', formatUsd(cart.itemsTotalUsdCents)),
              _Row(
                'Envío',
                zone == null
                    ? '—'
                    : (shipping == 0 ? 'Gratis' : formatUsd(shipping)),
              ),
              const Divider(height: 20),
              _Row('Total', formatUsd(total), bold: true),
              if (method != null && method.currency != Currency.usd) ...[
                const SizedBox(height: 6),
                _Row(
                  'A pagar en ${method.name}',
                  estimate == null
                      ? 'Sin tasa'
                      : formatMoneyCents(estimate, method.currency),
                  bold: true,
                ),
              ],
              const SizedBox(height: 6),
              const Text(
                'El monto exacto se fija con la tasa del BCV al confirmar el pedido. Tendrás 2 horas para reportar el pago.',
                style: TextStyle(fontSize: 13, color: PetbfColors.slate),
              ),
            ],
          ),
        ),
        const SizedBox(height: 12),
        CheckboxListTile(
          contentPadding: EdgeInsets.zero,
          controlAffinity: ListTileControlAffinity.leading,
          value: _terms,
          isError: _termsError,
          onChanged: (v) => setState(() {
            _terms = v ?? false;
            if (_terms) _termsError = false;
          }),
          title: const Text(
            'Acepto los términos y condiciones y la política de devoluciones '
            '(3 días; no aplica a alimento ni higiene abiertos).',
          ),
          subtitle: _termsError
              ? const Text(
                  'Debes aceptar los términos y condiciones',
                  style: TextStyle(color: PetbfColors.danger),
                )
              : null,
        ),
        const SizedBox(height: 12),
        FilledButton(
          onPressed:
              _sending || zone == null || method == null || estimate == null
              ? null
              : _submit,
          child: Text(_sending ? 'Creando pedido…' : 'Confirmar pedido'),
        ),
      ],
    );
  }
}

class _Row extends StatelessWidget {
  const _Row(this.label, this.value, {this.bold = false, this.accent = false});
  final String label;
  final String value;
  final bool bold;
  final bool accent;
  @override
  Widget build(BuildContext context) {
    final style = TextStyle(
      fontWeight: bold
          ? FontWeight.w800
          : accent
          ? FontWeight.w700
          : FontWeight.w400,
      fontSize: bold ? 16 : 15,
      color: accent ? PetbfColors.petbf : null,
    );
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          Expanded(child: Text(label, style: style)),
          Text(value, style: style),
        ],
      ),
    );
  }
}
