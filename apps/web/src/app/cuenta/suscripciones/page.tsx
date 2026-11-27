import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { Pagination } from '@/components/catalog';
import { SubscriptionActions, SubscriptionEditForm } from '@/components/subscription-forms';
import { api } from '@/lib/api';
import { formatDateTime, formatUsd } from '@/lib/format';
import { orderCode, orderStatusLabel } from '@/lib/orders';
import { pageParam } from '@/lib/search-params';
import { getCurrentUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Mis suscripciones', robots: { index: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const statusLabel = { ACTIVE: 'Activa', PAUSED: 'En pausa', CANCELLED: 'Cancelada' } as const;

async function Subscriptions({ searchParams }: { searchParams: SearchParams }) {
  const user = await getCurrentUser();
  if (!user) redirect('/entrar?next=/cuenta/suscripciones');
  const page = pageParam(await searchParams);
  const subs = await api.mySubscriptions({ page });
  return (
    <>
      <h1 className="mb-2 text-3xl">Mis suscripciones</h1>
      <p className="mb-6 text-slate">
        Recibe tu alimento y tu arena sin acordarte: en cada fecha creamos el pedido con el precio de ese día y te
        avisamos por correo. Tú lo pagas como cualquier otro.
      </p>
      {subs.items.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-line bg-white p-6">
          Todavía no tienes suscripciones. Busca el botón «Recibirlo cada cierto tiempo» en la ficha de un alimento.{' '}
          <Link href="/productos" className="font-bold text-petbf hover:underline">
            Ver productos
          </Link>
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {subs.items.map((s) => (
            <li
              key={s.id}
              aria-label={`Suscripción de ${s.variant.product.name}`}
              className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-white p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p>
                  <Link href={`/productos/${s.variant.product.slug}`} className="font-display text-xl hover:underline">
                    {s.variant.product.name}
                  </Link>{' '}
                  <span className="text-slate">({s.variant.name})</span>
                </p>
                <span className={s.status === 'ACTIVE' ? 'font-bold text-petbf' : 'font-bold text-slate'}>{statusLabel[s.status]}</span>
              </div>
              <p>
                {s.quantity} {s.quantity === 1 ? 'unidad' : 'unidades'} cada {s.intervalDays} días · precio de hoy{' '}
                {formatUsd(s.variant.priceUsdCents * s.quantity)}
              </p>
              {s.status === 'ACTIVE' && <p>Próximo pedido: {formatDateTime(s.nextRunAt)}</p>}
              {s.status === 'PAUSED' && s.lastError && (
                <p role="status" className="rounded-[var(--radius-field)] bg-red-50 px-4 py-3 text-danger">
                  La pausamos porque no pudimos crear el pedido: {s.lastError}
                </p>
              )}
              {s.address ? (
                <p className="text-sm text-slate">
                  Envío a {s.address.recipientName}, {s.address.line1}, {s.address.city} · {s.shippingZone.name} · paga con{' '}
                  {s.paymentMethod.name}
                </p>
              ) : (
                <p className="text-sm text-danger">Esta suscripción se quedó sin dirección de envío.</p>
              )}
              {s.orders.length > 0 && (
                <ul className="text-sm">
                  {s.orders.map((o) => (
                    <li key={o.id}>
                      <Link href={`/pedidos/${o.id}`} className="font-bold text-petbf hover:underline">
                        Pedido {orderCode(o.number)}
                      </Link>{' '}
                      · {orderStatusLabel[o.status]} · {formatUsd(o.totalUsdCents)}
                    </li>
                  ))}
                </ul>
              )}
              <SubscriptionEditForm subscription={s} />
              <SubscriptionActions subscription={s} />
            </li>
          ))}
        </ul>
      )}
      <Pagination
        page={subs.page}
        pageSize={subs.pageSize}
        total={subs.total}
        href={(pagina) => `/cuenta/suscripciones?pagina=${pagina}`}
      />
      <p className="mt-8">
        <Link href="/cuenta" className="font-bold text-petbf hover:underline">
          Volver a mi cuenta
        </Link>
      </p>
    </>
  );
}

export default function SubscriptionsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12">
      <div className="rounded-[var(--radius-card)] border border-line bg-white p-6 sm:p-8">
        <Suspense fallback={<p className="text-slate">Cargando…</p>}>
          <Subscriptions searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
