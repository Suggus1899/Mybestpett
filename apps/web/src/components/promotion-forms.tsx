'use client';

import { useActionState, useState } from 'react';
import type { ComboRow, Coupon } from '@/lib/api';
import { keepValues } from '@/lib/keep-values';
import {
  createComboAction,
  createCouponAction,
  toggleCouponAction,
  updateComboAction,
  type ActionState,
} from '@/lib/shop-actions';
import { Button, Field, inputClass, Notice } from './ui';

const MONEY = '\\d{1,6}([.,]\\d{1,2})?';
const COMBO_LINES = 5; // igual que createComboAction
const dollars = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');

export function CouponForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createCouponAction, {});
  const f = state.fields;
  const [type, setType] = useState(f?.type ?? 'PERCENT');
  return (
    <form
      key={state.ok ?? 'nuevo'}
      onSubmit={keepValues(action)}
      aria-label="Nuevo cupón"
      className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-white p-5"
    >
      <h2 className="text-xl">Nuevo cupón</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Código"
          id="coupon-code"
          name="code"
          required
          minLength={3}
          maxLength={30}
          pattern="[A-Za-z0-9][A-Za-z0-9\-]{2,29}"
          defaultValue={f?.code}
          hint="Letras, números y guiones. Se guarda en mayúsculas."
          className={`${inputClass} uppercase`}
        />
        <Field label="Descripción" id="coupon-description" name="description" required minLength={3} maxLength={160} defaultValue={f?.description} hint="La ve el cliente al aplicarlo." />
      </div>
      <fieldset className="flex flex-wrap gap-4">
        <legend className="mb-1 font-bold">Tipo de descuento</legend>
        <label className="flex min-h-11 items-center gap-2">
          <input type="radio" name="type" value="PERCENT" checked={type === 'PERCENT'} onChange={() => setType('PERCENT')} className="size-5" />
          Porcentaje
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="radio" name="type" value="FIXED" checked={type === 'FIXED'} onChange={() => setType('FIXED')} className="size-5" />
          Monto fijo en dólares
        </label>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-3">
        {type === 'PERCENT' ? (
          <Field label="Porcentaje (%)" id="coupon-value" name="value" type="number" required min={1} max={90} defaultValue={f?.value} />
        ) : (
          <Field label="Descuento ($)" id="coupon-value" name="value" inputMode="decimal" required pattern={MONEY} defaultValue={f?.value} />
        )}
        <Field label="Compra mínima ($, opcional)" id="coupon-min" name="minSubtotal" inputMode="decimal" pattern={MONEY} defaultValue={f?.minSubtotal} />
        {type === 'PERCENT' && (
          <Field label="Tope del descuento ($, opcional)" id="coupon-max" name="maxDiscount" inputMode="decimal" pattern={MONEY} defaultValue={f?.maxDiscount} />
        )}
        <Field label="Desde (opcional)" id="coupon-starts" name="startsAt" type="datetime-local" defaultValue={f?.startsAt} hint="Hora de Venezuela." />
        <Field label="Hasta (opcional)" id="coupon-ends" name="endsAt" type="datetime-local" defaultValue={f?.endsAt} />
        <Field label="Usos totales (opcional)" id="coupon-uses" name="maxRedemptions" type="number" min={1} max={1000000} defaultValue={f?.maxRedemptions} />
        <Field label="Usos por cliente" id="coupon-per-user" name="perUserLimit" type="number" required min={1} max={100} defaultValue={f?.perUserLimit ?? '1'} />
      </div>
      <Notice error={state.error} ok={state.ok} />
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Creando…' : 'Crear cupón'}
      </Button>
    </form>
  );
}

export function CouponToggle({ coupon }: { coupon: Coupon }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(toggleCouponAction, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={coupon.id} />
      <input type="hidden" name="isActive" value={String(!coupon.isActive)} />
      <Button type="submit" variant="secondary" disabled={pending} aria-label={`${coupon.isActive ? 'Desactivar' : 'Activar'} cupón ${coupon.code}`}>
        {coupon.isActive ? 'Desactivar' : 'Activar'}
      </Button>
      <Notice error={state.error} />
    </form>
  );
}

export function ComboForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createComboAction, {});
  const f = state.fields;
  return (
    <form
      key={state.ok ?? 'nuevo'}
      onSubmit={keepValues(action)}
      aria-label="Nuevo combo"
      className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-white p-5"
    >
      <h2 className="text-xl">Nuevo combo</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre" id="combo-name" name="name" required minLength={3} maxLength={80} defaultValue={f?.name} />
        <Field label="Precio del combo ($)" id="combo-price" name="price" inputMode="decimal" required pattern={MONEY} defaultValue={f?.price} hint="Menor que la suma de sus productos." />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="combo-description" className="font-bold">
          Descripción
        </label>
        <textarea id="combo-description" name="description" required minLength={10} maxLength={500} rows={2} defaultValue={f?.description} className={`${inputClass} py-3`} />
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-bold">Productos (SKU y cantidad)</legend>
        {Array.from({ length: COMBO_LINES }, (_, i) => (
          <div key={i} className="grid grid-cols-[1fr_6rem] gap-2">
            <label className="sr-only" htmlFor={`combo-sku${i}`}>
              SKU {i + 1}
            </label>
            <input id={`combo-sku${i}`} name={`sku${i}`} required={i < 1} maxLength={40} placeholder={`SKU ${i + 1}`} defaultValue={f?.[`sku${i}`]} className={`${inputClass} uppercase`} />
            <label className="sr-only" htmlFor={`combo-qty${i}`}>
              Cantidad {i + 1}
            </label>
            <input id={`combo-qty${i}`} name={`qty${i}`} type="number" min={1} max={20} defaultValue={f?.[`qty${i}`] || '1'} className={inputClass} />
          </div>
        ))}
      </fieldset>
      <Notice error={state.error} ok={state.ok} />
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Creando…' : 'Crear combo'}
      </Button>
    </form>
  );
}

export function ComboEditForm({ combo }: { combo: ComboRow }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateComboAction, {});
  return (
    <form onSubmit={keepValues(action)} aria-label={`Editar combo ${combo.name}`} className="flex flex-col gap-2">
      <input type="hidden" name="id" value={combo.id} />
      <Field label="Precio ($)" id={`combo-${combo.id}-price`} name="price" inputMode="decimal" required pattern={MONEY} defaultValue={dollars(combo.priceUsdCents)} />
      <label className="flex min-h-11 items-center gap-2">
        <input type="checkbox" name="isActive" defaultChecked={combo.isActive} className="size-5" />
        Activo
      </label>
      <Notice error={state.error} ok={state.ok} />
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        {pending ? 'Guardando…' : 'Guardar'}
      </Button>
    </form>
  );
}
