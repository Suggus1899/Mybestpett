'use client';

import { useActionState, useMemo, useState } from 'react';
import type { Address, PaymentMethod, ShippingZone, Subscription } from '@/lib/api';
import { keepValues } from '@/lib/keep-values';
import {
  changeSubscriptionAction,
  createSubscriptionAction,
  updateSubscriptionAction,
  type ActionState,
} from '@/lib/shop-actions';
import { Button, Field, inputClass, Notice } from './ui';

const INTERVALS = [
  { days: 14, label: 'Cada 2 semanas' },
  { days: 30, label: 'Cada mes' },
  { days: 45, label: 'Cada mes y medio' },
  { days: 60, label: 'Cada 2 meses' },
];

// Elegir cada cuánto llega, a dónde y cómo se paga. El primer pedido se crea
// al confirmar y se paga como cualquier otro.
export function NewSubscriptionForm({
  variantId,
  label,
  addresses,
  zones,
  methods,
}: {
  variantId: string;
  label: string;
  addresses: Address[];
  zones: ShippingZone[];
  methods: PaymentMethod[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createSubscriptionAction, {});
  const f = state.fields;
  const [addressId, setAddressId] = useState(f?.addressId ?? addresses.find((a) => a.isDefault)?.id ?? addresses[0]?.id);
  const address = addresses.find((a) => a.id === addressId);
  const available = useMemo(() => zones.filter((z) => address && z.states.includes(address.state)), [zones, address]);
  return (
    <form onSubmit={keepValues(action)} aria-label={`Suscribirme a ${label}`} className="flex flex-col gap-5">
      <Notice error={state.error} />
      <input type="hidden" name="variantId" value={variantId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Unidades por entrega"
          id="sub-quantity"
          name="quantity"
          type="number"
          required
          min={1}
          max={10}
          defaultValue={f?.quantity ?? '1'}
        />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="sub-interval" className="font-bold">
            Frecuencia
          </label>
          <select id="sub-interval" name="intervalDays" defaultValue={f?.intervalDays ?? '30'} className={inputClass}>
            {INTERVALS.map((i) => (
              <option key={i.days} value={i.days}>
                {i.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-xl font-display">Dirección de envío</legend>
        {addresses.map((a) => (
          <label key={a.id} className="flex gap-3 rounded-[var(--radius-field)] border border-line bg-white p-4 has-checked:border-petbf">
            <input type="radio" name="addressId" value={a.id} checked={a.id === addressId} onChange={() => setAddressId(a.id)} className="mt-1 size-5" />
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
            Aún no enviamos a {address?.state}.
          </p>
        ) : (
          available.map((z, i) => (
            <label key={z.id} className="flex gap-3 rounded-[var(--radius-field)] border border-line bg-white p-4 has-checked:border-petbf">
              <input type="radio" name="shippingZoneId" value={z.id} defaultChecked={f?.shippingZoneId ? f.shippingZoneId === z.id : i === 0} className="mt-1 size-5" />
              <span>
                <span className="block font-bold">{z.name}</span>
                <span className="block text-sm text-slate">{z.carrier}</span>
              </span>
            </label>
          ))
        )}
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-xl font-display">Método de pago</legend>
        {methods.map((m, i) => (
          <label key={m.id} className="flex gap-3 rounded-[var(--radius-field)] border border-line bg-white p-4 has-checked:border-petbf">
            <input type="radio" name="paymentMethodId" value={m.id} defaultChecked={f?.paymentMethodId ? f.paymentMethodId === m.id : i === 0} className="mt-1 size-5" />
            <span className="font-bold">{m.name}</span>
          </label>
        ))}
      </fieldset>
      <p className="text-sm text-slate">
        Creamos tu primer pedido ahora y los siguientes en cada fecha, con el precio de ese día. Cada pedido se paga
        como cualquier otro y lo puedes pagar hasta 24 horas después. Puedes pausar o cancelar cuando quieras.
      </p>
      <Button type="submit" disabled={pending || available.length === 0} className="self-start">
        {pending ? 'Creando…' : 'Confirmar suscripción'}
      </Button>
    </form>
  );
}

export function SubscriptionActions({ subscription }: { subscription: Subscription }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(changeSubscriptionAction, {});
  const name = subscription.variant.product.name;
  return (
    <div className="flex flex-col gap-2">
      <Notice error={state.error} ok={state.ok} />
      <div className="flex flex-wrap gap-2">
        {subscription.status === 'ACTIVE' && (
          <form action={action}>
            <input type="hidden" name="id" value={subscription.id} />
            <input type="hidden" name="action" value="pause" />
            <Button type="submit" variant="secondary" disabled={pending} aria-label={`Pausar suscripción de ${name}`}>
              Pausar
            </Button>
          </form>
        )}
        {subscription.status === 'PAUSED' && (
          <form action={action}>
            <input type="hidden" name="id" value={subscription.id} />
            <input type="hidden" name="action" value="resume" />
            <Button type="submit" disabled={pending} aria-label={`Reanudar suscripción de ${name}`}>
              Reanudar
            </Button>
          </form>
        )}
        <form action={action}>
          <input type="hidden" name="id" value={subscription.id} />
          <input type="hidden" name="action" value="cancel" />
          <Button type="submit" variant="secondary" disabled={pending} aria-label={`Cancelar suscripción de ${name}`}>
            Cancelar suscripción
          </Button>
        </form>
      </div>
    </div>
  );
}

export function SubscriptionEditForm({ subscription }: { subscription: Subscription }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateSubscriptionAction, {});
  const name = subscription.variant.product.name;
  const known = INTERVALS.some((i) => i.days === subscription.intervalDays);
  return (
    <form onSubmit={keepValues(action)} aria-label={`Cambiar suscripción de ${name}`} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="id" value={subscription.id} />
      <Field label="Unidades" id={`sub-${subscription.id}-q`} name="quantity" type="number" required min={1} max={10} defaultValue={subscription.quantity} className={`${inputClass} w-24`} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`sub-${subscription.id}-d`} className="font-bold">
          Frecuencia
        </label>
        <select id={`sub-${subscription.id}-d`} name="intervalDays" defaultValue={subscription.intervalDays} className={inputClass}>
          {!known && <option value={subscription.intervalDays}>Cada {subscription.intervalDays} días</option>}
          {INTERVALS.map((i) => (
            <option key={i.days} value={i.days}>
              {i.label}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? 'Guardando…' : 'Guardar cambios'}
      </Button>
      <div className="basis-full">
        <Notice error={state.error} ok={state.ok} />
      </div>
    </form>
  );
}
