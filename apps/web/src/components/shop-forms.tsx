'use client';

import { useActionState, useMemo, useState } from 'react';
import type { Address, PaymentMethod, ShippingZone } from '@/lib/api';
import { formatMoney, formatUsd } from '@/lib/format';
import { estimateCharge } from '@/lib/orders';
import {
  addToCartAction,
  attachProofAction,
  cancelMyOrderAction,
  checkoutAction,
  createAddressAction,
  reportPaymentAction,
  setCartQuantityAction,
  type ActionState,
} from '@/lib/shop-actions';
import { VE_STATES } from '@/lib/venezuela';
import { Button, Field, inputClass, Notice } from './ui';

const MAX_QUANTITY = 20; // igual que la API

export function AddToCartForm({ variantId, back, label }: { variantId: string; back: string; label: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addToCartAction, {});
  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <input type="hidden" name="variantId" value={variantId} />
      <input type="hidden" name="back" value={back} />
      <div className="flex items-center gap-2">
        <label htmlFor={`qty-${variantId}`} className="sr-only">
          Cantidad de {label}
        </label>
        <input
          id={`qty-${variantId}`}
          name="quantity"
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_QUANTITY}
          defaultValue={1}
          required
          className={`${inputClass} w-20 px-3`}
        />
        <Button type="submit" disabled={pending} aria-label={`Añadir ${label} al carrito`}>
          {pending ? 'Añadiendo…' : 'Añadir'}
        </Button>
      </div>
      <div aria-live="polite">
        <Notice error={state.error} ok={state.ok} />
      </div>
    </form>
  );
}

export function CartQuantityForm({
  variantId,
  quantity,
  max,
  label,
}: {
  variantId: string;
  quantity: number;
  max: number;
  label: string;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(setCartQuantityAction, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="variantId" value={variantId} />
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`cart-${variantId}`} className="text-sm font-bold">
          Cantidad
        </label>
        <input
          id={`cart-${variantId}`}
          name="quantity"
          type="number"
          inputMode="numeric"
          min={1}
          max={Math.max(1, Math.min(max, MAX_QUANTITY))}
          defaultValue={quantity}
          required
          aria-label={`Cantidad de ${label}`}
          className={`${inputClass} w-20 px-3`}
        />
        <Button type="submit" variant="secondary" disabled={pending}>
          Actualizar
        </Button>
      </div>
      <Notice error={state.error} />
    </form>
  );
}

export function AddressForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createAddressAction, {});
  const f = state.fields;
  return (
    <form action={action} className="flex flex-col gap-4">
      <Notice error={state.error} ok={state.ok} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Quién recibe" id="recipientName" name="recipientName" autoComplete="name" required maxLength={120} defaultValue={f?.recipientName} />
        <Field label="Teléfono de contacto" id="addr-phone" name="phone" type="tel" autoComplete="tel" required placeholder="0412 1234567" defaultValue={f?.phone} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="state" className="font-bold">
            Estado
          </label>
          {/* La key vuelve a montar el select para que conserve el estado elegido tras un error. */}
          <select key={f?.state ?? ''} id="state" name="state" required defaultValue={f?.state ?? ''} className={inputClass}>
            <option value="" disabled>
              Elige un estado
            </option>
            {VE_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <Field label="Ciudad" id="city" name="city" autoComplete="address-level2" required maxLength={80} defaultValue={f?.city} />
        <Field label="Municipio (opcional)" id="municipality" name="municipality" maxLength={80} defaultValue={f?.municipality} />
        <Field label="Dirección" id="line1" name="line1" autoComplete="street-address" required maxLength={200} defaultValue={f?.line1} />
      </div>
      <Field label="Punto de referencia (opcional)" id="referencePoint" name="referencePoint" maxLength={200} defaultValue={f?.referencePoint} />
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Guardando…' : 'Guardar dirección'}
      </Button>
    </form>
  );
}

// Elige dirección, zona y método; muestra el total en la moneda del método.
// El total exacto lo calcula la API al crear el pedido.
export function CheckoutForm({
  addresses,
  zones,
  methods,
  subtotalUsdCents,
  usdVes,
  eurVes,
}: {
  addresses: Address[];
  zones: ShippingZone[];
  methods: PaymentMethod[];
  subtotalUsdCents: number;
  usdVes: string | null;
  eurVes: string | null;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(checkoutAction, {});
  const [addressId, setAddressId] = useState(addresses.find((a) => a.isDefault)?.id ?? addresses[0]?.id);
  const address = addresses.find((a) => a.id === addressId);
  const available = useMemo(
    () => zones.filter((z) => address && z.states.includes(address.state)),
    [zones, address],
  );
  const [zoneId, setZoneId] = useState<string | undefined>(available[0]?.id);
  const zone = available.find((z) => z.id === zoneId) ?? available[0];
  const [methodId, setMethodId] = useState(methods[0]?.id);
  const method = methods.find((m) => m.id === methodId);

  const shipping = zone ? (subtotalUsdCents >= zone.freeOverUsdCents ? 0 : zone.priceUsdCents) : 0;
  const total = subtotalUsdCents + shipping;
  const charge = method ? estimateCharge(total, method.currency, usdVes, eurVes) : null;

  return (
    <form action={action} className="flex flex-col gap-6">
      <Notice error={state.error} />

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-xl font-display">Dirección de envío</legend>
        {addresses.map((a) => (
          <label key={a.id} className="flex gap-3 rounded-[var(--radius-field)] border border-line bg-white p-4 has-checked:border-petbf">
            <input
              type="radio"
              name="addressId"
              value={a.id}
              checked={a.id === addressId}
              onChange={() => setAddressId(a.id)}
              className="mt-1 size-5"
            />
            <span>
              <span className="block font-bold">{a.recipientName}</span>
              <span className="block text-sm text-slate">
                {a.line1}, {a.city}, {a.state}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-xl font-display">Envío</legend>
        {available.length === 0 ? (
          <p role="alert" className="text-danger">
            Aún no enviamos a {address?.state}. Escríbenos y buscamos una opción.
          </p>
        ) : (
          available.map((z) => (
            <label key={z.id} className="flex justify-between gap-3 rounded-[var(--radius-field)] border border-line bg-white p-4 has-checked:border-petbf">
              <span className="flex gap-3">
                <input
                  type="radio"
                  name="shippingZoneId"
                  value={z.id}
                  checked={z.id === zone?.id}
                  onChange={() => setZoneId(z.id)}
                  className="mt-1 size-5"
                />
                <span>
                  <span className="block font-bold">{z.name}</span>
                  <span className="block text-sm text-slate">{z.carrier}</span>
                </span>
              </span>
              <span className="font-bold">
                {subtotalUsdCents >= z.freeOverUsdCents ? 'Gratis' : formatUsd(z.priceUsdCents)}
              </span>
            </label>
          ))
        )}
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-xl font-display">Método de pago</legend>
        {methods.map((m) => (
          <label key={m.id} className="flex gap-3 rounded-[var(--radius-field)] border border-line bg-white p-4 has-checked:border-petbf">
            <input
              type="radio"
              name="paymentMethodId"
              value={m.id}
              checked={m.id === methodId}
              onChange={() => setMethodId(m.id)}
              className="mt-1 size-5"
            />
            <span className="font-bold">{m.name}</span>
          </label>
        ))}
      </fieldset>

      <dl className="grid grid-cols-[1fr_auto] gap-y-1 rounded-[var(--radius-card)] border border-line bg-white p-5">
        <dt>Subtotal</dt>
        <dd className="text-right">{formatUsd(subtotalUsdCents)}</dd>
        <dt>Envío</dt>
        <dd className="text-right">{shipping === 0 ? 'Gratis' : formatUsd(shipping)}</dd>
        <dt className="font-extrabold">Total</dt>
        <dd className="text-right font-extrabold">{formatUsd(total)}</dd>
        {method && method.currency !== 'USD' && (
          <>
            <dt>A pagar en {method.name}</dt>
            <dd className="text-right font-bold" data-testid="checkout-charge">
              {charge ? formatMoney(charge, method.currency) : 'Sin tasa del día'}
            </dd>
          </>
        )}
      </dl>
      {subtotalUsdCents < 2500 && (
        <p className="text-sm text-slate">
          Te faltan {formatUsd(2500 - subtotalUsdCents)} para el envío gratis.
        </p>
      )}

      <label className="flex items-start gap-3">
        <input type="checkbox" name="acceptTerms" required className="mt-1 size-5" />
        <span>Acepto los términos y condiciones de venta y la política de devoluciones.</span>
      </label>

      <Button type="submit" disabled={pending || !zone || !method}>
        {pending ? 'Creando pedido…' : 'Confirmar pedido'}
      </Button>
      <p className="text-sm text-slate">
        Tendrás 2 horas para pagar y reportar el pago. Te mostraremos los datos en el siguiente paso.
      </p>
    </form>
  );
}

export function ReportPaymentForm({ orderId, amount }: { orderId: string; amount: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(reportPaymentAction, {});
  const f = state.fields;
  if (state.ok) return <Notice ok={state.ok} />;
  return (
    <form action={action} className="flex flex-col gap-4">
      <Notice error={state.error} />
      <input type="hidden" name="orderId" value={orderId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Número de referencia" id="reference" name="reference" required minLength={4} maxLength={40} defaultValue={f?.reference} />
        <Field label="Banco de origen (opcional)" id="originBank" name="originBank" maxLength={80} defaultValue={f?.originBank} />
        <Field
          label="Monto pagado"
          id="amount"
          name="amount"
          inputMode="decimal"
          required
          pattern="\d{1,12}([.,]\d{1,2})?"
          defaultValue={f?.amount ?? amount}
          hint="Con punto o coma y hasta 2 decimales."
        />
        <Field label="Fecha y hora del pago" id="paidAt" name="paidAt" type="datetime-local" required defaultValue={f?.paidAt} />
        <ProofInput id="proof" />
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Enviando…' : 'Reportar pago'}
      </Button>
    </form>
  );
}

const PROOF_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

function ProofInput({ id, required }: { id: string; required?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5 sm:col-span-2">
      <label htmlFor={id} className="font-bold">
        Comprobante{required ? '' : ' (opcional)'}
      </label>
      <input id={id} name="proof" type="file" accept={PROOF_ACCEPT} required={required} aria-describedby={`${id}-hint`} />
      <p id={`${id}-hint`} className="text-sm text-slate">
        Captura o PDF del pago, hasta 5 MB. Ayuda a verificarlo más rápido.
      </p>
    </div>
  );
}

// Adjunta o reemplaza el comprobante de un pago que el equipo aún no revisó.
export function AttachProofForm({ orderId, paymentId, hasProof }: { orderId: string; paymentId: string; hasProof: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(attachProofAction, {});
  return (
    <form action={action} aria-label="Adjuntar comprobante" className="mt-2 flex flex-col gap-2">
      <Notice error={state.error} ok={state.ok} />
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="paymentId" value={paymentId} />
      <ProofInput id={`proof-${paymentId}`} required />
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        {pending ? 'Subiendo…' : hasProof ? 'Reemplazar comprobante' : 'Adjuntar comprobante'}
      </Button>
    </form>
  );
}

export function CancelOrderForm({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(cancelMyOrderAction, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="orderId" value={orderId} />
      <Notice error={state.error} />
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        Cancelar pedido
      </Button>
    </form>
  );
}
