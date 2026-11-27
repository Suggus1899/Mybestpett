import Link from 'next/link';
import { Suspense } from 'react';
import { OfferBadge, Picture, Price, ProductCard, Stars } from '@/components/catalog';
import { ProductReviews } from '@/components/reviews';
import { AddToCartForm } from '@/components/shop-forms';
import { api, speciesLabel } from '@/lib/api';
import { getCurrentUser } from '@/lib/session';

async function Product({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [product, rates, reviews, recommended, user] = await Promise.all([
    api.product(slug),
    api.rates(),
    api.productReviews(slug, {}),
    api.recommendations(slug),
    getCurrentUser(),
  ]);
  const mine = user ? await api.myReview(slug) : null;
  const rate = rates.usdVes?.rate ?? null;
  const [cover, ...rest] = product.images;

  return (
    <>
      <nav aria-label="Migas de pan" className="mb-6 text-sm text-slate">
        <Link href="/productos" className="hover:underline">
          Productos
        </Link>
        {' / '}
        <Link href={`/productos?categoria=${product.category.slug}`} className="hover:underline">
          {product.category.name}
        </Link>
      </nav>

      <div className="grid gap-8 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-white">
            <Picture image={cover ?? null} fallback={product.category.name} />
          </div>
          {rest.length > 0 && (
            <ul className="grid grid-cols-4 gap-2">
              {rest.map((image) => (
                <li key={image.url} className="overflow-hidden rounded-[var(--radius-field)] border border-line">
                  <Picture image={image} fallback="" />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-5">
          <div>
            {product.brand && <p className="text-slate">{product.brand.name}</p>}
            <h1 className="text-3xl sm:text-4xl">{product.name}</h1>
            <Stars rating={product.rating} size="lg" />
            {product.species.length > 0 && (
              <p className="mt-2 text-sm text-slate">
                Para: {product.species.map((s) => speciesLabel[s].toLowerCase()).join(', ')}
              </p>
            )}
          </div>

          <section aria-labelledby="presentaciones">
            <h2 id="presentaciones" className="mb-3 text-xl">
              Presentaciones
            </h2>
            <ul className="flex flex-col gap-3">
              {product.variants.map((variant) => (
                <li
                  key={variant.id}
                  className="flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-field)] border border-line bg-white p-4"
                >
                  <div>
                    <p className="font-bold">{variant.name}</p>
                    <p className="text-sm text-slate">SKU {variant.sku}</p>
                    {variant.inStock ? (
                      <p className="text-sm font-bold text-petbf">Disponible</p>
                    ) : (
                      <p className="text-sm font-bold text-danger">Agotado</p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-2 text-right">
                    {variant.compareAtUsdCents != null && <OfferBadge />}
                    <Price
                      usdCents={variant.priceUsdCents}
                      compareAtUsdCents={variant.compareAtUsdCents}
                      rate={rate}
                    />
                    {variant.inStock && product.subscribable && (
                      <Link
                        href={`/cuenta/suscripciones/nueva?producto=${product.slug}&presentacion=${variant.id}`}
                        className="text-sm font-bold text-petbf hover:underline"
                        aria-label={`Recibir ${product.name} ${variant.name} cada cierto tiempo`}
                      >
                        Recibirlo cada cierto tiempo
                      </Link>
                    )}
                    {variant.inStock && (
                      <AddToCartForm
                        variantId={variant.id}
                        back={`/productos/${product.slug}`}
                        label={`${product.name} ${variant.name}`}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-slate">
              Para comprar necesitas una cuenta. Si no has entrado, te lo pediremos al añadir.
            </p>
          </section>

          <section aria-labelledby="descripcion">
            <h2 id="descripcion" className="mb-2 text-xl">
              Descripción
            </h2>
            <p className="whitespace-pre-line">{product.description}</p>
          </section>

          <p className="rounded-[var(--radius-field)] bg-petbf-soft p-4 text-sm">
            {product.isReturnable
              ? 'Puedes devolverlo hasta 3 días después de recibirlo.'
              : 'Por ser alimento o higiene, no admite devolución una vez abierto.'}{' '}
            Envío gratis desde $25.
          </p>
        </div>
      </div>

      <ProductReviews slug={product.slug} reviews={reviews} mine={mine} loggedIn={Boolean(user)} />

      {recommended.length > 0 && (
        <section aria-labelledby="recomendados" className="mt-12">
          <h2 id="recomendados" className="mb-4 text-2xl">
            También te puede gustar
          </h2>
          <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {recommended.map((p) => (
              <li key={p.id}>
                <ProductCard product={p} rate={rate} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

export default function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <Suspense fallback={<p className="text-slate">Cargando producto…</p>}>
        <Product params={params} />
      </Suspense>
    </div>
  );
}
