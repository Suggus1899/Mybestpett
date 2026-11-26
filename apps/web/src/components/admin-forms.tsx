'use client';

import { useActionState } from 'react';
import type { OrderStatus } from '@/lib/api';
import {
  advanceOrderAction,
  cancelOrderManageAction,
  rejectPaymentAction,
  verifyPaymentAction,
  type ActionState,
} from '@/lib/shop-actions';
import { Button, Field, Notice } from './ui';

// Verificar o rechazar un pago reportado. Rechazar exige un motivo que ve el cliente.
export function ReviewPaymentForms({ paymentId, label }: { paymentId: string; label: string }) {
  const [verified, verify, verifying] = useActionState<ActionState, FormData>(verifyPaymentAction, {});
  const [rejected, reject, rejecting] = useActionState<ActionState, FormData>(rejectPaymentAction, {});
  if (verified.ok || rejected.ok) return <Notice ok={verified.ok ?? rejected.ok} />;
  return (
    <div className="flex flex-col gap-3">
      <Notice error={verified.error ?? rejected.error} />
      <form action={verify}>
        <input type="hidden" name="paymentId" value={paymentId} />
        <Button type="submit" disabled={verifying || rejecting} aria-label={`Verificar pago ${label}`}>
          {verifying ? 'Verificando…' : 'Verificar: el dinero llegó'}
        </Button>
      </form>
      <form action={reject} className="flex flex-col gap-2">
        <input type="hidden" name="paymentId" value={paymentId} />
        <Field
          label="Motivo del rechazo"
          id={`reason-${paymentId}`}
          name="reason"
          required
          minLength={5}
          maxLength={300}
          defaultValue={rejected.fields?.reason}
          hint="El cliente lo verá y podrá reportar de nuevo."
        />
        <Button type="submit" variant="secondary" disabled={verifying || rejecting} className="self-start">
          {rejecting ? 'Rechazando…' : 'Rechazar'}
        </Button>
      </form>
    </div>
  );
}

const nextStep: Partial<Record<OrderStatus, { status: string; label: string }>> = {
  PAID: { status: 'PREPARING', label: 'Pasar a preparación' },
  PREPARING: { status: 'SHIPPED', label: 'Marcar como enviado' },
  SHIPPED: { status: 'DELIVERED', label: 'Marcar como entregado' },
};

export function AdvanceOrderForm({ orderId, status, carrier }: { orderId: string; status: OrderStatus; carrier: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(advanceOrderAction, {});
  const step = nextStep[status];
  if (!step) return null;
  return (
    <form action={action} className="flex flex-col gap-3">
      <Notice error={state.error} ok={state.ok} />
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="status" value={step.status} />
      {step.status === 'SHIPPED' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Agencia" id="carrier" name="carrier" maxLength={80} defaultValue={carrier} />
          <Field label="Número de guía" id="trackingCode" name="trackingCode" required minLength={3} maxLength={60} />
        </div>
      )}
      <Field label="Nota interna (opcional)" id="note" name="note" maxLength={300} />
      <Button type="submit" disabled={pending} className="self-start">
        {pending ? 'Guardando…' : step.label}
      </Button>
    </form>
  );
}

export function CancelOrderManageForm({ orderId }: { orderId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(cancelOrderManageAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <Notice error={state.error} ok={state.ok} />
      <input type="hidden" name="orderId" value={orderId} />
      <Field
        label="Motivo de la cancelación"
        id="cancel-reason"
        name="reason"
        required
        minLength={5}
        maxLength={300}
        defaultValue={state.fields?.reason}
      />
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        Cancelar pedido y devolver stock
      </Button>
    </form>
  );
}
