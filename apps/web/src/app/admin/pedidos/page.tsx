import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { NoAccess } from '@/components/admin';
import { Pagination } from '@/components/catalog';
import { StatusBadge } from '@/components/orders';
import { Button, inputClass } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import { requireRoles } from '@/lib/guards';
import { ORDER_STATUSES, orderStatusLabel } from '@/lib/orders';
import { enumParam, pageParam, textParam, withParams } from '@/lib/search-params';

export const metadata: Metadata = { title: 'Pedidos' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function Orders({ searchParams }: { searchParams: SearchParams }) {
  const { allowed } = await requireRoles(['ORDERS_OPERATOR'], '/admin/pedidos');
  if (!allowed) return <NoAccess />;
  const raw = await searchParams;
  const filters = {
    estado: enumParam(raw, 'estado', ORDER_STATUSES),
    q: textParam(raw, 'q', 1),
    pagina: pageParam(raw),
  };
  const orders = await api.manageOrders({ status: filters.estado, q: filters.q, page: filters.pagina });

  return (
    <>
      <h1 className="mb-6 text-3xl">Pedidos</h1>
      <form
        action="/admin/pedidos"
        className="mb-6 grid gap-3 rounded-[var(--radius-card)] border border-line bg-white p-4 md:grid-cols-[2fr_1fr_auto]"
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="q" className="text-sm font-bold">
            Código o correo
          </label>
          <input id="q" name="q" type="search" defaultValue={filters.q} maxLength={80} className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="estado" className="text-sm font-bold">
            Estado
          </label>
          <select id="estado" name="estado" defaultValue={filters.estado ?? ''} className={inputClass}>
            <option value="">Todos</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {orderStatusLabel[s]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <Button type="submit">Filtrar</Button>
        </div>
      </form>

      <p className="mb-3 text-slate" aria-live="polite">
        {orders.total === 1 ? '1 pedido' : `${orders.total} pedidos`}
        {filters.estado && ' · del más antiguo al más nuevo'}
      </p>

      {orders.items.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-line bg-white p-8 text-center font-bold">
          No hay pedidos con esos filtros.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-white">
          <table className="w-full min-w-[720px] text-left">
            <caption className="sr-only">Pedidos</caption>
            <thead className="border-b border-line bg-mist text-sm">
              <tr>
                <th scope="col" className="px-4 py-3">Pedido</th>
                <th scope="col" className="px-4 py-3">Cliente</th>
                <th scope="col" className="px-4 py-3">Destino</th>
                <th scope="col" className="px-4 py-3 text-right">Total</th>
                <th scope="col" className="px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              {orders.items.map((o) => (
                <tr key={o.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/admin/pedidos/${o.id}`} className="font-bold text-petbf hover:underline">
                      {o.code}
                    </Link>
                    <span className="block text-sm text-slate">{formatDateTime(o.createdAt)}</span>
                  </td>
                  <td className="px-4 py-3">
                    {o.user?.firstName} {o.user?.lastName}
                    <span className="block text-sm text-slate">{o.user?.email}</span>
                  </td>
                  <td className="px-4 py-3">
                    {o.city}, {o.state}
                  </td>
                  <td className="px-4 py-3 text-right font-bold">{formatMoney(o.totalCharged, o.chargedCurrency)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={o.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination
        page={orders.page}
        pageSize={orders.pageSize}
        total={orders.total}
        href={(pagina) => withParams('/admin/pedidos', filters, { pagina })}
      />
    </>
  );
}

export default function OrdersPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="text-slate">Cargando pedidos…</p>}>
      <Orders searchParams={searchParams} />
    </Suspense>
  );
}
