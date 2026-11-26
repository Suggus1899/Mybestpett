import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { NoAccess } from '@/components/admin';
import { Pagination, Stars } from '@/components/catalog';
import { ModerateReviewForm } from '@/components/review-forms';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { requireRoles } from '@/lib/guards';
import { enumParam, pageParam } from '@/lib/search-params';

export const metadata: Metadata = { title: 'Reseñas' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const STATUSES = ['VISIBLE', 'HIDDEN'] as const;
const RATINGS = ['1', '2', '3', '4', '5'] as const;
const tabLabel = { VISIBLE: 'Visibles', HIDDEN: 'Ocultas' } as const;

async function Reviews({ searchParams }: { searchParams: SearchParams }) {
  const { allowed } = await requireRoles(['CATALOG_MANAGER'], '/admin/resenas');
  if (!allowed) return <NoAccess />;
  const raw = await searchParams;
  const status = enumParam(raw, 'estado', STATUSES) ?? 'VISIBLE';
  const rating = enumParam(raw, 'estrellas', RATINGS);
  const page = pageParam(raw);
  const reviews = await api.manageReviews({ status, rating, page });
  const href = (s: string, r?: string, pagina?: number) =>
    `/admin/resenas?estado=${s}${r ? `&estrellas=${r}` : ''}${pagina ? `&pagina=${pagina}` : ''}`;

  return (
    <>
      <h1 className="mb-2 text-3xl">Reseñas</h1>
      <p className="mb-6 text-slate">
        Solo pueden reseñar quienes compraron y recibieron el producto. Oculta las que tengan datos personales, insultos
        o publicidad; el autor ve el motivo y puede corregirla.
      </p>
      <nav aria-label="Estado de la reseña" className="mb-4 flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={href(s, rating)}
            aria-current={s === status ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 font-bold ${
              s === status ? 'border-petbf bg-petbf text-white' : 'border-line bg-white'
            }`}
          >
            {tabLabel[s]}
          </Link>
        ))}
      </nav>
      <nav aria-label="Estrellas" className="mb-6 flex flex-wrap gap-2">
        {[undefined, ...RATINGS].map((r) => (
          <Link
            key={r ?? 'all'}
            href={href(status, r)}
            aria-current={r === rating ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 font-bold ${
              r === rating ? 'border-petbf bg-petbf-soft' : 'border-line bg-white'
            }`}
          >
            {r ? `${r} ★` : 'Todas'}
          </Link>
        ))}
      </nav>

      {reviews.items.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-line bg-white p-8 text-center font-bold">
          No hay reseñas con estos filtros.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {reviews.items.map((r) => (
            <li
              key={r.id}
              aria-label={`Reseña de ${r.user.firstName} ${r.user.lastName} sobre ${r.product.name}`}
              className="grid gap-4 rounded-[var(--radius-card)] border border-line bg-white p-5 md:grid-cols-[2fr_1fr]"
            >
              <div className="flex flex-col gap-1">
                <p>
                  <Link href={`/productos/${r.product.slug}`} className="font-bold text-petbf hover:underline">
                    {r.product.name}
                  </Link>
                </p>
                <Stars rating={{ average: r.rating, count: 1 }} />
                {r.title && <p className="font-bold">{r.title}</p>}
                <p className="whitespace-pre-line">{r.body}</p>
                <p className="mt-2 text-sm text-slate">
                  {r.user.firstName} {r.user.lastName} · {r.user.email} · {formatDateTime(r.createdAt)}
                </p>
                {r.status === 'HIDDEN' && (
                  <p className="text-danger">
                    Oculta{r.moderatedBy ? ` por ${r.moderatedBy.firstName} ${r.moderatedBy.lastName}` : ''}
                    {r.moderatedAt ? ` el ${formatDateTime(r.moderatedAt)}` : ''}: {r.hiddenReason}
                  </p>
                )}
              </div>
              <ModerateReviewForm id={r.id} status={r.status} />
            </li>
          ))}
        </ul>
      )}
      <Pagination
        page={reviews.page}
        pageSize={reviews.pageSize}
        total={reviews.total}
        href={(pagina) => href(status, rating, pagina)}
      />
    </>
  );
}

export default function ReviewsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="text-slate">Cargando reseñas…</p>}>
      <Reviews searchParams={searchParams} />
    </Suspense>
  );
}
