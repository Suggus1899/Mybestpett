import Link from 'next/link';
import type { Image, ProductCard as Card, Rating } from '@/lib/api';
import { formatBs, formatUsd } from '@/lib/format';

// Precio principal en dólares y su equivalente en bolívares a tasa BCV.
export function Price({
  usdCents,
  compareAtUsdCents,
  rate,
  from = false,
  size = 'md',
}: {
  usdCents: number;
  compareAtUsdCents?: number | null;
  rate: string | null;
  from?: boolean;
  size?: 'md' | 'lg';
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className={`font-extrabold ${size === 'lg' ? 'text-3xl' : 'text-xl'}`}>
          {from && <span className="text-sm font-bold text-slate">Desde </span>}
          {formatUsd(usdCents)}
        </span>
        {compareAtUsdCents != null && (
          <s className="text-slate" aria-label={`Antes ${formatUsd(compareAtUsdCents)}`}>
            {formatUsd(compareAtUsdCents)}
          </s>
        )}
      </div>
      {rate && <span className="text-sm text-slate">{formatBs(usdCents, rate)}</span>}
    </div>
  );
}

export function Picture({ image, fallback }: { image: Image | null; fallback: string }) {
  if (!image) {
    return (
      <div className="flex aspect-square items-center justify-center bg-petbf-soft font-display text-xl text-petbf">
        {fallback}
      </div>
    );
  }
  // Las fotos vienen de un CDN externo aún por definir; por eso <img> y no next/image.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={image.url} alt={image.alt} className="aspect-square w-full object-cover" />;
}

export function OfferBadge() {
  return (
    <span className="rounded-full bg-amber px-3 py-1 text-sm font-bold text-ink">Oferta</span>
  );
}

const decimal = new Intl.NumberFormat('es-VE', { maximumFractionDigits: 1 });

// Valoración media con su número de reseñas. Sin reseñas no muestra nada.
export function Stars({ rating, size = 'sm' }: { rating: Rating; size?: 'sm' | 'lg' }) {
  if (rating.average === null || rating.count === 0) return null;
  const label = `${decimal.format(rating.average)} de 5 estrellas, ${rating.count} ${rating.count === 1 ? 'reseña' : 'reseñas'}`;
  return (
    <p className={size === 'lg' ? 'text-base' : 'text-sm'} aria-label={label} title={label}>
      <span aria-hidden="true" className="text-amber">
        {'★'.repeat(Math.round(rating.average))}
        <span className="text-line">{'★'.repeat(5 - Math.round(rating.average))}</span>
      </span>{' '}
      <span aria-hidden="true" className="text-slate">
        {decimal.format(rating.average)} ({rating.count})
      </span>
    </p>
  );
}

export function ProductCard({ product, rate }: { product: Card; rate: string | null }) {
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-white">
      <Link href={`/productos/${product.slug}`} className="relative block">
        <Picture image={product.image} fallback={product.category.name} />
        {product.compareAtUsdCents != null && (
          <span className="absolute top-3 left-3">
            <OfferBadge />
          </span>
        )}
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <p className="text-sm text-slate">{product.brand?.name ?? product.category.name}</p>
        <h3 className="font-sans text-base font-bold">
          <Link href={`/productos/${product.slug}`} className="hover:underline">
            {product.name}
          </Link>
        </h3>
        <Stars rating={product.rating} />
        <div className="mt-auto">
          {product.priceFromUsdCents != null && (
            <Price
              usdCents={product.priceFromUsdCents}
              compareAtUsdCents={product.compareAtUsdCents}
              rate={rate}
            />
          )}
          {!product.inStock && <p className="mt-1 text-sm font-bold text-danger">Agotado</p>}
        </div>
      </div>
    </article>
  );
}

// Paginación con enlaces normales: funciona sin JavaScript y se puede compartir.
export function Pagination({
  page,
  pageSize,
  total,
  href,
}: {
  page: number;
  pageSize: number;
  total: number;
  href: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const link = 'inline-flex min-h-11 items-center rounded-full border border-line bg-white px-5 font-bold';
  return (
    <nav aria-label="Paginación" className="mt-8 flex items-center justify-center gap-3">
      {page > 1 ? (
        <Link href={href(page - 1)} className={link}>
          Anterior
        </Link>
      ) : null}
      <span className="text-slate">
        Página {page} de {pages}
      </span>
      {page < pages ? (
        <Link href={href(page + 1)} className={link}>
          Siguiente
        </Link>
      ) : null}
    </nav>
  );
}
