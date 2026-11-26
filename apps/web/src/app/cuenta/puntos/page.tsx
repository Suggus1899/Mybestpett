import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { Pagination } from '@/components/catalog';
import { api, type PointsReason } from '@/lib/api';
import { formatDateTime, formatUsd } from '@/lib/format';
import { orderCode } from '@/lib/orders';
import { pageParam } from '@/lib/search-params';
import { getCurrentUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Mis puntos', robots: { index: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const reasonLabel: Record<PointsReason, string> = {
  EARNED: 'Ganados por tu pedido',
  REDEEMED: 'Usados en tu pedido',
  RESTORED: 'Devueltos',
  REVERSED: 'Descontados por un reembolso',
  ADJUSTED: 'Ajuste de la tienda',
};

async function Points({ searchParams }: { searchParams: SearchParams }) {
  const user = await getCurrentUser();
  if (!user) redirect('/entrar?next=/cuenta/puntos');
  const page = pageParam(await searchParams);
  const points = await api.points({ page });
  return (
    <>
      <h1 className="mb-2 text-3xl">Mis puntos</h1>
      <p className="mb-6 text-slate">
        Ganas 1 punto por cada dólar que pagas en productos cuando recibes tu pedido. Cada 100 puntos valen 1 $ de
        descuento: los usas al finalizar la compra.
      </p>
      <p role="status" className="mb-8 rounded-[var(--radius-card)] bg-petbf-soft p-5">
        <span className="block font-display text-4xl">{points.balance} puntos</span>
        <span className="font-bold">Equivalen a {formatUsd(points.valueUsdCents)}</span>
      </p>
      <h2 className="mb-3 text-xl">Movimientos</h2>
      {points.items.length === 0 ? (
        <p className="text-slate">Todavía no tienes movimientos.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {points.items.map((e) => (
            <li key={e.id} className="flex justify-between gap-4 py-3">
              <span>
                <span className="block font-bold">{reasonLabel[e.reason]}</span>
                <span className="block text-sm text-slate">
                  {formatDateTime(e.createdAt)}
                  {e.order && (
                    <>
                      {' · '}
                      <Link href={`/pedidos/${e.order.id}`} className="text-petbf hover:underline">
                        Pedido {orderCode(e.order.number)}
                      </Link>
                    </>
                  )}
                  {e.note && ` · ${e.note}`}
                </span>
              </span>
              <span className={`font-extrabold ${e.delta > 0 ? 'text-petbf' : 'text-danger'}`}>
                {e.delta > 0 ? `+${e.delta}` : `−${-e.delta}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Pagination
        page={points.page}
        pageSize={points.pageSize}
        total={points.total}
        href={(pagina) => `/cuenta/puntos?pagina=${pagina}`}
      />
      <p className="mt-8">
        <Link href="/cuenta" className="font-bold text-petbf hover:underline">
          Volver a mi cuenta
        </Link>
      </p>
    </>
  );
}

export default function PointsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12">
      <div className="rounded-[var(--radius-card)] border border-line bg-white p-6 sm:p-8">
        <Suspense fallback={<p className="text-slate">Cargando…</p>}>
          <Points searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
