import type { MyReview, ReviewPage } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { Stars } from './catalog';
import { ReviewForm } from './review-forms';

// Reseñas de un producto: resumen, lista y, si corresponde, el formulario.
export function ProductReviews({
  slug,
  reviews,
  mine,
  loggedIn,
}: {
  slug: string;
  reviews: ReviewPage;
  mine: MyReview | null;
  loggedIn: boolean;
}) {
  const { summary } = reviews;
  return (
    <section aria-labelledby="resenas" className="mt-12 grid gap-8 md:grid-cols-[1fr_2fr]">
      <div className="flex flex-col gap-4">
        <h2 id="resenas" className="text-2xl">
          Reseñas
        </h2>
        {summary.count === 0 ? (
          <p className="text-slate">Todavía no hay reseñas.</p>
        ) : (
          <>
            <Stars rating={{ average: summary.average, count: summary.count }} size="lg" />
            <ul aria-label="Reseñas por estrellas" className="flex flex-col gap-1 text-sm">
              {[5, 4, 3, 2, 1].map((stars) => (
                <li key={stars}>
                  {stars} ★: {summary.distribution[stars - 1]}
                </li>
              ))}
            </ul>
          </>
        )}
        {mine?.canReview || mine?.review ? (
          <ReviewForm slug={slug} mine={mine.review} />
        ) : (
          <p className="text-sm text-slate">
            {loggedIn
              ? 'Podrás dejar una reseña cuando recibas este producto.'
              : 'Entra a tu cuenta para reseñar los productos que compraste.'}
          </p>
        )}
      </div>
      <ul className="flex flex-col gap-4">
        {reviews.items.map((r) => (
          <li key={r.id} className="rounded-[var(--radius-card)] border border-line bg-white p-5">
            <Stars rating={{ average: r.rating, count: 1 }} />
            {r.title && <p className="mt-1 font-bold">{r.title}</p>}
            <p className="mt-1 whitespace-pre-line">{r.body}</p>
            <p className="mt-2 text-sm text-slate">
              {r.author} · Compra verificada · {formatDateTime(r.createdAt)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
