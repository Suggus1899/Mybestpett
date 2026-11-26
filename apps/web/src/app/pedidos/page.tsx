import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { Pagination } from '@/components/catalog';
import { StatusBadge } from '@/components/orders';
import { ButtonLink } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import { pageParam } from '@/lib/search-params';
import { getCurrentUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Mis pedidos', robots: { index: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function Orders({ searchParams }: { searchParams: SearchParams }) {
  const user = await getCurrentUser();
  if (!user) redirect('/entrar?next=/pedidos');
  const page = pageParam(await searchParams);
  const orders = await api.myOrders({ page, pageSize: 20 });

  if (orders.total === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-line bg-white p-8 text-center">
        <p className="mb-4 font-bold">Todavía no tienes pedidos.</p>
        <ButtonLink href="/productos">Ver productos</ButtonLink>
      </div>
    );
  }

  return (
    <>
      <ul className="flex flex-col gap-3">
        {orders.items.map((order) => (
          <li key={order.id}>
            <Link
              href={`/pedidos/${order.id}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-line bg-white p-4 hover:border-petbf"
            >
              <span>
                <span className="block font-bold">Pedido {order.code}</span>
                <span className="block text-sm text-slate">
                  {formatDateTime(order.createdAt)} · {order._count.items}{' '}
                  {order._count.items === 1 ? 'producto' : 'productos'}
                </span>
              </span>
              <span className="flex items-center gap-3">
                <span className="font-extrabold">{formatMoney(order.totalCharged, order.chargedCurrency)}</span>
                <StatusBadge status={order.status} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Pagination
        page={orders.page}
        pageSize={orders.pageSize}
        total={orders.total}
        href={(p) => `/pedidos?pagina=${p}`}
      />
    </>
  );
}

export default function OrdersPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-6 text-3xl">Mis pedidos</h1>
      <Suspense fallback={<p className="text-slate">Cargando pedidos…</p>}>
        <Orders searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
