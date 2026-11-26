import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { AddComboForm } from '@/components/shop-forms';
import { api } from '@/lib/api';
import { formatUsd } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Combos',
  description: 'Productos que se usan juntos, a un precio menor que por separado.',
};

async function Combos() {
  const combos = await api.combos();
  if (combos.length === 0) {
    return (
      <p className="rounded-[var(--radius-card)] border border-line bg-white p-8 text-center font-bold">
        Por ahora no hay combos. Vuelve pronto.
      </p>
    );
  }
  return (
    <ul className="grid gap-6 md:grid-cols-2">
      {combos.map((c) => (
        <li key={c.id}>
          <article
            aria-labelledby={`combo-${c.id}`}
            className="flex h-full flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-white p-5"
          >
            <h2 id={`combo-${c.id}`} className="text-2xl">
              {c.name}
            </h2>
            <p className="text-slate">{c.description}</p>
            <ul className="flex flex-col gap-1">
              {c.items.map((i) => (
                <li key={i.variantId}>
                  {i.quantity} ×{' '}
                  <Link href={`/productos/${i.product.slug}`} className="font-bold hover:underline">
                    {i.product.name}
                  </Link>{' '}
                  <span className="text-slate">({i.variantName})</span>
                </li>
              ))}
            </ul>
            <p className="mt-auto flex flex-wrap items-baseline gap-x-3">
              <span className="text-2xl font-extrabold">{formatUsd(c.priceUsdCents)}</span>
              <s className="text-slate">{formatUsd(c.regularUsdCents)}</s>
              <span className="font-bold text-petbf">Ahorras {formatUsd(c.savingsUsdCents)}</span>
            </p>
            {c.available > 0 ? (
              <AddComboForm slug={c.slug} name={c.name} max={c.available} />
            ) : (
              <p className="font-bold text-danger">Agotado por ahora</p>
            )}
          </article>
        </li>
      ))}
    </ul>
  );
}

export default function CombosPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="mb-2 text-3xl">Combos</h1>
      <p className="mb-8 text-slate">
        Al añadir un combo entran todos sus productos al carrito. El descuento se aplica solo por cada combo completo.
      </p>
      <Suspense fallback={<p className="text-slate">Cargando combos…</p>}>
        <Combos />
      </Suspense>
    </div>
  );
}
