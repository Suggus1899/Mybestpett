'use client';

import { startTransition, useActionState, type FormEvent } from 'react';
import type { PaymentMethod, ShippingZone } from '@/lib/api';
import { saveZoneAction, updatePaymentMethodAction, type ActionState } from '@/lib/shop-actions';
import { VE_STATES } from '@/lib/venezuela';
import { Button, Field, inputClass, Notice } from './ui';

// Envía el formulario sin que React lo vacíe al terminar: así, si la API
// devuelve un error, lo escrito (incluidas las casillas) sigue ahí.
function keepValues(action: (data: FormData) => void) {
  return (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => action(data));
  };
}

const currencyLabel = { USD: 'dólares', VES: 'bolívares', EUR: 'euros', USDT: 'USDT' } as const;

function ActiveAndOrder({ prefix, isActive, sortOrder }: { prefix: string; isActive: boolean; sortOrder: number }) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <label className="flex min-h-11 items-center gap-2">
        <input type="checkbox" name="isActive" defaultChecked={isActive} className="size-5" />
        Activo
      </label>
      <Field
        label="Orden"
        id={`${prefix}-sortOrder`}
        name="sortOrder"
        type="number"
        min={0}
        max={10000}
        defaultValue={sortOrder}
        className={`${inputClass} w-24`}
      />
    </div>
  );
}

// Datos que ve el cliente para pagar (cuenta, teléfono, correo de Zelle…).
export function PaymentMethodForm({ method }: { method: PaymentMethod }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updatePaymentMethodAction, {});
  const p = `pm-${method.code}`;
  return (
    <form
      onSubmit={keepValues(action)}
      aria-label={`Método ${method.name}`}
      className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-white p-5"
    >
      <p className="text-sm text-slate">
        {method.code} · se cobra en {currencyLabel[method.currency]}
      </p>
      <input type="hidden" name="id" value={method.id} />
      <Field label="Nombre" id={`${p}-name`} name="name" required maxLength={80} defaultValue={method.name} />
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${p}-instructions`} className="font-bold">
          Datos para pagar
        </label>
        <textarea
          id={`${p}-instructions`}
          name="instructions"
          required
          maxLength={1000}
          rows={4}
          defaultValue={method.instructions}
          className={`${inputClass} py-3`}
        />
      </div>
      <ActiveAndOrder prefix={p} isActive={method.isActive ?? true} sortOrder={method.sortOrder ?? 0} />
      <Notice error={state.error} ok={state.ok} />
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Guardando…' : `Guardar ${method.name}`}
      </Button>
    </form>
  );
}

const dollars = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

// Crear (sin zona) o editar una zona de envío.
export function ZoneForm({ zone }: { zone?: ShippingZone }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveZoneAction, {});
  const p = zone ? `zone-${zone.id}` : 'zone-new';
  const label = zone ? zone.name : 'Nueva zona';
  return (
    <form
      onSubmit={keepValues(action)}
      aria-label={zone ? `Zona ${zone.name}` : 'Nueva zona'}
      className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-white p-5"
    >
      {zone && <input type="hidden" name="id" value={zone.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre" id={`${p}-name`} name="name" required maxLength={80} defaultValue={zone?.name} />
        <Field label="Agencia o reparto" id={`${p}-carrier`} name="carrier" required maxLength={80} defaultValue={zone?.carrier} />
        <Field
          label="Tarifa ($)"
          id={`${p}-price`}
          name="price"
          inputMode="decimal"
          required
          pattern="\d{1,6}([.,]\d{1,2})?"
          defaultValue={zone ? dollars(zone.priceUsdCents) : ''}
        />
        <Field
          label="Gratis desde ($)"
          id={`${p}-freeOver`}
          name="freeOver"
          inputMode="decimal"
          required
          pattern="\d{1,6}([.,]\d{1,2})?"
          defaultValue={dollars(zone?.freeOverUsdCents ?? 2500)}
        />
      </div>
      <fieldset>
        <legend className="mb-2 font-bold">Estados que cubre</legend>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
          {VE_STATES.map((s) => (
            <label key={s} className="flex min-h-9 items-center gap-2 text-sm">
              <input type="checkbox" name="states" value={s} defaultChecked={zone?.states.includes(s)} className="size-4" />
              {s}
            </label>
          ))}
        </div>
      </fieldset>
      <ActiveAndOrder prefix={p} isActive={zone?.isActive ?? true} sortOrder={zone?.sortOrder ?? 0} />
      <Notice error={state.error} ok={state.ok} />
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Guardando…' : zone ? `Guardar ${label}` : 'Crear zona'}
      </Button>
    </form>
  );
}
