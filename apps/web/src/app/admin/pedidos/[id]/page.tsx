import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { NoAccess } from '@/components/admin';
import { AdvanceOrderForm, CancelOrderManageForm, ReviewPaymentForms } from '@/components/admin-forms';
import { OrderHistory, OrderItems, OrderPayments, OrderShipping, StatusBadge } from '@/components/orders';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { requireRoles } from '@/lib/guards';

export const metadata: Metadata = { title: 'Pedido' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function OrderAdmin({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { allowed } = await requireRoles(['ORDERS_OPERATOR'], `/admin/pedidos/${id}`);
  if (!allowed) return <NoAccess />;
  if (!UUID.test(id)) notFound();
  const order = await api.manageOrder(id);
  const reported = order.payments.find((p) => p.status === 'REPORTED');
  const canCancel = order.status === 'PENDING_PAYMENT' || order.status === 'PAYMENT_REPORTED';

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/admin/pedidos" className="text-petbf hover:underline">
          ← Pedidos
        </Link>
      </p>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl">Pedido {order.code}</h1>
        <StatusBadge status={order.status} />
      </div>
      <p className="mb-6 text-slate">
        {order.user?.firstName} {order.user?.lastName} · {order.user?.email} · creado el{' '}
        {formatDateTime(order.createdAt)}
        {order.status === 'PENDING_PAYMENT' && ` · vence el ${formatDateTime(order.paymentDueAt)}`}
      </p>

      <div className="mb-6 grid gap-6 md:grid-cols-2">
        {reported && (
          <section aria-labelledby="revisar" className="rounded-[var(--radius-card)] border-2 border-petbf bg-white p-5">
            <h2 id="revisar" className="mb-3 text-xl">
              Revisar pago · Ref. {reported.reference}
            </h2>
            <ReviewPaymentForms paymentId={reported.id} label={reported.reference} />
          </section>
        )}
        {['PAID', 'PREPARING', 'SHIPPED'].includes(order.status) && (
          <section aria-labelledby="avanzar" className="rounded-[var(--radius-card)] border-2 border-petbf bg-white p-5">
            <h2 id="avanzar" className="mb-3 text-xl">
              Siguiente paso
            </h2>
            <AdvanceOrderForm orderId={order.id} status={order.status} carrier={order.carrier} />
          </section>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <OrderItems order={order} />
        <div className="flex flex-col gap-6">
          <OrderShipping order={order} />
          <OrderPayments order={order} />
          <OrderHistory order={order} />
          {canCancel && (
            <section aria-labelledby="cancelar" className="rounded-[var(--radius-card)] border border-line bg-white p-5">
              <h2 id="cancelar" className="mb-3 text-xl">
                Cancelar
              </h2>
              <CancelOrderManageForm orderId={order.id} />
            </section>
          )}
        </div>
      </div>
    </>
  );
}

export default function OrderAdminPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="text-slate">Cargando pedido…</p>}>
      <OrderAdmin params={params} />
    </Suspense>
  );
}
