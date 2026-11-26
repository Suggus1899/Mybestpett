'use client';

import { useActionState } from 'react';
import type { Order } from '@/lib/api';
import { keepValues } from '@/lib/keep-values';
import { returnableLeft } from '@/lib/orders';
import {
  approveReturnAction,
  refundReturnAction,
  rejectReturnAction,
  requestReturnAction,
  type ActionState,
} from '@/lib/shop-actions';
import { Button, Field, inputClass, Notice } from './ui';

// El cliente elige cuántas unidades de cada producto devuelve y explica por qué.
export function ReturnRequestForm({ order }: { order: Order }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(requestReturnAction, {});
  if (state.ok) return <Notice ok={state.ok} />;
  const lines = returnableLeft(order);
  return (
    <form onSubmit={keepValues(action)} aria-label="Pedir devolución" className="flex flex-col gap-4">
      <Notice error={state.error} />
      <input type="hidden" name="orderId" value={order.id} />
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 font-bold">¿Qué quieres devolver?</legend>
        {lines.map(({ item, left }) => (
          <div key={item.id} className="flex items-center justify-between gap-3">
            <label htmlFor={`qty-${item.id}`}>
              {item.productName} <span className="text-slate">({item.variantName})</span>
            </label>
            <input
              id={`qty-${item.id}`}
              name={`qty-${item.id}`}
              type="number"
              inputMode="numeric"
              min={0}
              max={left}
              defaultValue={0}
              aria-describedby={`left-${item.id}`}
              className={`${inputClass} w-20 px-3`}
            />
            <span id={`left-${item.id}`} className="sr-only">
              Máximo {left}
            </span>
          </div>
        ))}
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="return-reason" className="font-bold">
          Motivo
        </label>
        <textarea
          id="return-reason"
          name="reason"
          required
          minLength={10}
          maxLength={500}
          rows={3}
          defaultValue={state.fields?.reason}
          className={`${inputClass} py-3`}
        />
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Enviando…' : 'Pedir devolución'}
      </Button>
    </form>
  );
}

// El operador aprueba (con indicaciones para el cliente) o rechaza con motivo.
export function ReviewReturnForms({ returnId, label }: { returnId: string; label: string }) {
  const [approved, approve, approving] = useActionState<ActionState, FormData>(approveReturnAction, {});
  const [rejected, reject, rejecting] = useActionState<ActionState, FormData>(rejectReturnAction, {});
  if (approved.ok || rejected.ok) return <Notice ok={approved.ok ?? rejected.ok} />;
  const busy = approving || rejecting;
  return (
    <div className="flex flex-col gap-4">
      <Notice error={approved.error ?? rejected.error} />
      <form onSubmit={keepValues(approve)} className="flex flex-col gap-2">
        <input type="hidden" name="returnId" value={returnId} />
        <Field
          label="Indicaciones para el cliente (opcional)"
          id={`note-${returnId}`}
          name="note"
          maxLength={300}
          defaultValue={approved.fields?.note}
          hint="Por ejemplo, dónde y cuándo entregar el producto."
        />
        <Button type="submit" disabled={busy} className="self-start" aria-label={`Aprobar devolución ${label}`}>
          {approving ? 'Aprobando…' : 'Aprobar'}
        </Button>
      </form>
      <form onSubmit={keepValues(reject)} className="flex flex-col gap-2">
        <input type="hidden" name="returnId" value={returnId} />
        <Field
          label="Motivo del rechazo"
          id={`reject-${returnId}`}
          name="reason"
          required
          minLength={5}
          maxLength={300}
          defaultValue={rejected.fields?.reason}
          hint="El cliente lo verá."
        />
        <Button type="submit" variant="secondary" disabled={busy} className="self-start" aria-label={`Rechazar devolución ${label}`}>
          {rejecting ? 'Rechazando…' : 'Rechazar'}
        </Button>
      </form>
    </div>
  );
}

// Solo el administrador: registra el reembolso ya enviado por el mismo método.
export function RefundReturnForm({ returnId, label }: { returnId: string; label: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(refundReturnAction, {});
  if (state.ok) return <Notice ok={state.ok} />;
  return (
    <form onSubmit={keepValues(action)} aria-label={`Reembolso ${label}`} className="flex flex-col gap-3">
      <Notice error={state.error} />
      <input type="hidden" name="returnId" value={returnId} />
      <Field
        label="Referencia del reembolso"
        id={`refund-ref-${returnId}`}
        name="reference"
        required
        minLength={4}
        maxLength={40}
        defaultValue={state.fields?.reference}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="font-bold">¿El producto vuelve al inventario?</legend>
        <label className="flex min-h-11 items-center gap-2">
          <input type="radio" name="restock" value="yes" required defaultChecked={state.fields?.restock === 'yes'} />
          Sí, llegó en buen estado
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input type="radio" name="restock" value="no" defaultChecked={state.fields?.restock === 'no'} />
          No, está dañado o usado
        </label>
      </fieldset>
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Guardando…' : 'Registrar reembolso'}
      </Button>
    </form>
  );
}
