import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { NoAccess } from '@/components/admin';
import { ReviewPaymentForms } from '@/components/admin-forms';
import { Pagination } from '@/components/catalog';
import { api, type PaymentStatus } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import { requireRoles } from '@/lib/guards';
import { paymentStatusLabel } from '@/lib/orders';
import { enumParam, pageParam } from '@/lib/search-params';

export const metadata: Metadata = { title: 'Pagos por verificar' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const STATUSES = ['REPORTED', 'VERIFIED', 'REJECTED'] as const;

async function Payments({ searchParams }: { searchParams: SearchParams }) {
  const { allowed } = await requireRoles(['ORDERS_OPERATOR'], '/admin/pagos');
  if (!allowed) return <NoAccess />;
  const raw = await searchParams;
  const status: PaymentStatus = enumParam(raw, 'estado', STATUSES) ?? 'REPORTED';
  const page = pageParam(raw);
  const payments = await api.managePayments({ status, page });

  return (
    <>
      <h1 className="mb-2 text-3xl">Pagos</h1>
      <p className="mb-6 text-slate">
        Compara cada reporte con el movimiento real en el banco, Zelle o la billetera antes de verificarlo. El
        comprobante del cliente es una pista, no una prueba.
      </p>
      <nav aria-label="Estado del pago" className="mb-6 flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/pagos?estado=${s}`}
            aria-current={s === status ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 font-bold ${
              s === status ? 'border-petbf bg-petbf text-white' : 'border-line bg-white'
            }`}
          >
            {paymentStatusLabel[s]}
          </Link>
        ))}
      </nav>

      {payments.items.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-line bg-white p-8 text-center font-bold">
          {status === 'REPORTED' ? 'No hay pagos por verificar.' : 'No hay pagos en este estado.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {payments.items.map((p) => {
            const matches = Number(p.amount) === Number(p.order.totalCharged) && p.currency === p.order.chargedCurrency;
            return (
              <li key={p.id} className="grid gap-4 rounded-[var(--radius-card)] border border-line bg-white p-5 md:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <p>
                    <Link href={`/admin/pedidos/${p.order.id}`} className="font-bold text-petbf hover:underline">
                      Pedido {p.order.code}
                    </Link>{' '}
                    · {p.order.user.firstName} {p.order.user.lastName}
                  </p>
                  <p className="text-sm text-slate">{p.order.user.email}</p>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                    <dt className="font-bold">Método</dt>
                    <dd>{p.method.name}</dd>
                    <dt className="font-bold">Referencia</dt>
                    <dd className="font-mono">{p.reference}</dd>
                    <dt className="font-bold">Banco</dt>
                    <dd>{p.originBank ?? 'Sin indicar'}</dd>
                    <dt className="font-bold">Fecha</dt>
                    <dd>{formatDateTime(p.paidAt)}</dd>
                    <dt className="font-bold">Reportado</dt>
                    <dd>{formatMoney(p.amount, p.currency)}</dd>
                    <dt className="font-bold">Esperado</dt>
                    <dd>{formatMoney(p.order.totalCharged, p.order.chargedCurrency)}</dd>
                  </dl>
                  {!matches && (
                    <p role="alert" className="mt-2 font-bold text-danger">
                      El monto reportado no coincide con el del pedido.
                    </p>
                  )}
                  {p.proof ? (
                    <a
                      href={`/admin/pagos/${p.id}/comprobante`}
                      target="_blank"
                      rel="noopener"
                      className="mt-2 font-bold text-petbf hover:underline"
                    >
                      Ver comprobante
                    </a>
                  ) : (
                    <p className="mt-2 text-slate">El cliente no adjuntó comprobante.</p>
                  )}
                  {p.rejectionReason && <p className="mt-2 text-danger">Motivo: {p.rejectionReason}</p>}
                </div>
                {p.status === 'REPORTED' ? (
                  <ReviewPaymentForms paymentId={p.id} label={p.reference} />
                ) : (
                  <p className="font-bold">{paymentStatusLabel[p.status]}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Pagination
        page={payments.page}
        pageSize={payments.pageSize}
        total={payments.total}
        href={(pagina) => `/admin/pagos?estado=${status}&pagina=${pagina}`}
      />
    </>
  );
}

export default function PaymentsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="text-slate">Cargando pagos…</p>}>
      <Payments searchParams={searchParams} />
    </Suspense>
  );
}
