import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Suspense } from 'react';
import { AddressForm } from '@/components/shop-forms';
import { NewSubscriptionForm } from '@/components/subscription-forms';
import { api } from '@/lib/api';
import { slugParam } from '@/lib/search-params';
import { getCurrentUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Nueva suscripción', robots: { index: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function NewSubscription({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const slug = slugParam(raw, 'producto');
  const variantId = typeof raw.presentacion === 'string' ? raw.presentacion : '';
  if (!slug) notFound();
  const user = await getCurrentUser();
  if (!user) redirect(`/entrar?next=${encodeURIComponent(`/cuenta/suscripciones/nueva?producto=${slug}&presentacion=${variantId}`)}`);
  const [product, addresses, zones, methods] = await Promise.all([
    api.product(slug),
    api.addresses(),
    api.shippingZones(),
    api.paymentMethods(),
  ]);
  const variant = product.variants.find((v) => v.id === variantId);
  if (!product.subscribable || !variant || !variant.inStock) notFound();
  const label = `${product.name} ${variant.name}`;
  return (
    <>
      <h1 className="mb-2 text-3xl">Recibir {label}</h1>
      <p className="mb-6 text-slate">
        <Link href={`/productos/${product.slug}`} className="font-bold text-petbf hover:underline">
          Volver al producto
        </Link>
      </p>
      {addresses.length === 0 ? (
        <section aria-labelledby="nueva-direccion">
          <h2 id="nueva-direccion" className="mb-4 text-xl">
            Primero, ¿a dónde te lo enviamos?
          </h2>
          <AddressForm />
        </section>
      ) : (
        <NewSubscriptionForm variantId={variant.id} label={label} addresses={addresses} zones={zones} methods={methods} />
      )}
    </>
  );
}

export default function NewSubscriptionPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12">
      <div className="rounded-[var(--radius-card)] border border-line bg-white p-6 sm:p-8">
        <Suspense fallback={<p className="text-slate">Cargando…</p>}>
          <NewSubscription searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
