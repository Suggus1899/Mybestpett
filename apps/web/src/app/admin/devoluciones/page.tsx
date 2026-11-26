import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { NoAccess } from '@/components/admin';
import { Pagination } from '@/components/catalog';
import { RefundReturnForm, ReviewReturnForms } from '@/components/returns-forms';
import { api, type ReturnStatus } from '@/lib/api';
import { formatDateTime, formatMoney, formatUsd } from '@/lib/format';
import { requireRoles } from '@/lib/guards';
import { returnStatusLabel } from '@/lib/orders';
import { enumParam, pageParam } from '@/lib/search-params';

export const metadata: Metadata = { title: 'Devoluciones' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const STATUSES = ['REQUESTED', 'APPROVED', 'REFUNDED', 'REJECTED'] as const;

const tabLabel: Record<ReturnStatus, string> = {
  REQUESTED: 'Por revisar',
  APPROVED: 'Por reembolsar',
  REFUNDED: 'Reembolsadas',
  REJECTED: 'Rechazadas',
};

const person = (p: { firstName: string; lastName: string } | null) => (p ? `${p.firstName} ${p.lastName}` : '—');

async function Returns({ searchParams }: { searchParams: SearchParams }) {
  const { user, allowed } = await requireRoles(['ORDERS_OPERATOR'], '/admin/devoluciones');
  if (!allowed) return <NoAccess />;
  const isAdmin = user.roles.includes('ADMIN');
  const raw = await searchParams;
  const status: ReturnStatus = enumParam(raw, 'estado', STATUSES) ?? 'REQUESTED';
  const page = pageParam(raw);
  const returns = await api.manageReturns({ status, page });

  return (
    <>
      <h1 className="mb-2 text-3xl">Devoluciones</h1>
      <p className="mb-6 text-slate">
        El cliente tiene 3 días desde la entrega. El operador aprueba o rechaza; el administrador reembolsa por el mismo
        método y en la misma moneda del pedido, y decide si el producto vuelve al inventario.
      </p>
      <nav aria-label="Estado de la devolución" className="mb-6 flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/devoluciones?estado=${s}`}
            aria-current={s === status ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 font-bold ${
              s === status ? 'border-petbf bg-petbf text-white' : 'border-line bg-white'
            }`}
          >
            {tabLabel[s]}
          </Link>
        ))}
      </nav>

      {returns.items.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-line bg-white p-8 text-center font-bold">
          No hay devoluciones en este estado.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {returns.items.map((r) => (
            <li
              key={r.id}
              aria-label={`Devolución del pedido ${r.order.code}`}
              className="grid gap-4 rounded-[var(--radius-card)] border border-line bg-white p-5 md:grid-cols-2"
            >
              <div className="flex flex-col gap-1">
                <p>
                  <Link href={`/admin/pedidos/${r.order.id}`} className="font-bold text-petbf hover:underline">
                    Pedido {r.order.code}
                  </Link>{' '}
                  · {r.order.user.firstName} {r.order.user.lastName}
                </p>
                <p className="text-sm text-slate">{r.order.user.email}</p>
                <ul className="mt-2">
                  {r.items.map((l) => (
                    <li key={l.orderItemId}>
                      {l.quantity} × {l.orderItem.productName}{' '}
                      <span className="text-slate">
                        ({l.orderItem.variantName} · {l.orderItem.sku})
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-2">Motivo: {r.reason}</p>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                  <dt className="font-bold">A reembolsar</dt>
                  <dd>
                    {formatMoney(r.refundAmount, r.currency)} ({formatUsd(r.refundUsdCents)})
                  </dd>
                  <dt className="font-bold">Método</dt>
                  <dd>{r.order.paymentMethod.name}</dd>
                  <dt className="font-bold">Pedida</dt>
                  <dd>{formatDateTime(r.createdAt)}</dd>
                  {r.order.deliveredAt && (
                    <>
                      <dt className="font-bold">Entregado</dt>
                      <dd>{formatDateTime(r.order.deliveredAt)}</dd>
                    </>
                  )}
                  {r.decidedAt && (
                    <>
                      <dt className="font-bold">Revisó</dt>
                      <dd>{person(r.decidedBy)}</dd>
                    </>
                  )}
                  {r.refundedAt && (
                    <>
                      <dt className="font-bold">Reembolsó</dt>
                      <dd>
                        {person(r.refundedBy)} · Ref. {r.refundReference} ·{' '}
                        {r.restocked ? 'volvió al inventario' : 'no volvió al inventario'}
                      </dd>
                    </>
                  )}
                </dl>
                {r.decisionNote && (
                  <p className={r.status === 'REJECTED' ? 'mt-2 text-danger' : 'mt-2 text-slate'}>{r.decisionNote}</p>
                )}
              </div>
              {r.status === 'REQUESTED' && <ReviewReturnForms returnId={r.id} label={r.order.code} />}
              {r.status === 'APPROVED' &&
                (isAdmin ? (
                  <RefundReturnForm returnId={r.id} label={r.order.code} />
                ) : (
                  <p className="font-bold">Esperando el reembolso del administrador.</p>
                ))}
              {(r.status === 'REFUNDED' || r.status === 'REJECTED') && (
                <p className="font-bold">{returnStatusLabel[r.status]}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      <Pagination
        page={returns.page}
        pageSize={returns.pageSize}
        total={returns.total}
        href={(pagina) => `/admin/devoluciones?estado=${status}&pagina=${pagina}`}
      />
    </>
  );
}

export default function ReturnsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="text-slate">Cargando devoluciones…</p>}>
      <Returns searchParams={searchParams} />
    </Suspense>
  );
}
