import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { OrderHistory, OrderItems, OrderPayments, OrderShipping, StatusBadge } from '@/components/orders';
import { CancelOrderForm, ReportPaymentForm } from '@/components/shop-forms';
import { api } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Pedido', robots: { index: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function OrderView({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(`/entrar?next=${encodeURIComponent(`/pedidos/${id}`)}`);
  if (!UUID.test(id)) notFound();
  const order = await api.myOrder(id);
  const amount = formatMoney(order.totalCharged, order.chargedCurrency);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-3xl">Pedido {order.code}</h1>
        <StatusBadge status={order.status} />
      </div>

      {order.status === 'PENDING_PAYMENT' && (
        <section
          aria-labelledby="como-pagar"
          className="mb-6 flex flex-col gap-4 rounded-[var(--radius-card)] border-2 border-petbf bg-white p-5"
        >
          <h2 id="como-pagar" className="text-2xl">
            Paga {amount} con {order.paymentMethod.name}
          </h2>
          <p className="whitespace-pre-line rounded-[var(--radius-field)] bg-mist p-4">
            {order.paymentMethod.instructions}
          </p>
          <p className="font-bold">
            Tienes hasta el {formatDateTime(order.paymentDueAt)} para reportar el pago. Después el pedido se
            cancela y liberamos los productos.
          </p>
          <ReportPaymentForm orderId={order.id} amount={order.totalCharged} />
          <CancelOrderForm orderId={order.id} />
        </section>
      )}
      {order.status === 'PAYMENT_REPORTED' && (
        <p role="status" className="mb-6 rounded-[var(--radius-card)] bg-petbf-soft p-5">
          Estamos verificando tu pago con el banco. Te avisaremos apenas esté confirmado.
        </p>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <OrderItems order={order} />
        <div className="flex flex-col gap-6">
          <OrderShipping order={order} />
          <OrderPayments order={order} />
          <OrderHistory order={order} />
        </div>
      </div>
    </>
  );
}

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <Suspense fallback={<p className="text-slate">Cargando pedido…</p>}>
        <OrderView params={params} />
      </Suspense>
    </div>
  );
}
