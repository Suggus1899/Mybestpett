import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Pagination, Picture, Price } from '@/components/catalog';
import { api, speciesLabel } from '@/lib/api';
import { enumParam, pageParam, SPECIES, withParams } from '@/lib/search-params';

export const metadata: Metadata = { title: 'Animales y adopción' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const tabs = [
  { value: 'venta', label: 'En venta', listingType: 'SALE' },
  { value: 'adopcion', label: 'En adopción', listingType: 'ADOPTION' },
] as const;

async function Animals({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const filters = {
    tipo: enumParam(raw, 'tipo', ['venta', 'adopcion'] as const),
    especie: enumParam(raw, 'especie', SPECIES),
    pagina: pageParam(raw),
  };
  const tab = tabs.find((t) => t.value === filters.tipo);
  const [animals, rates] = await Promise.all([
    api.animals({
      listingType: tab?.listingType,
      species: filters.especie,
      page: filters.pagina,
    }),
    api.rates(),
  ]);
  const rate = rates.usdVes?.rate ?? null;
  const chip = (active: boolean) =>
    `inline-flex min-h-11 items-center rounded-full border px-4 font-bold ${
      active ? 'border-petbf bg-petbf text-white' : 'border-line bg-white hover:border-petbf'
    }`;

  return (
    <>
      <nav aria-label="Tipo" className="mb-3 flex flex-wrap gap-2">
        <Link href={withParams('/animales', filters, { tipo: undefined, pagina: 1 })} className={chip(!tab)}>
          Todos
        </Link>
        {tabs.map((t) => (
          <Link
            key={t.value}
            href={withParams('/animales', filters, { tipo: t.value, pagina: 1 })}
            className={chip(tab?.value === t.value)}
            aria-current={tab?.value === t.value ? 'page' : undefined}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      <div className="mb-8 flex flex-wrap gap-2">
        {SPECIES.map((s) => (
          <Link
            key={s}
            href={withParams('/animales', filters, {
              especie: filters.especie === s ? undefined : s,
              pagina: 1,
            })}
            className={chip(filters.especie === s)}
          >
            {speciesLabel[s]}
          </Link>
        ))}
      </div>

      {animals.items.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-line bg-white p-8 text-center font-bold">
          Ahora mismo no hay animales con esos filtros. Vuelve pronto.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {animals.items.map((animal) => (
            <li key={animal.id}>
              <article className="flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-white">
                <Link href={`/animales/${animal.slug}`} className="relative block">
                  <Picture image={animal.images[0] ?? null} fallback={speciesLabel[animal.species]} />
                  {animal.status === 'RESERVED' && (
                    <span className="absolute top-3 left-3 rounded-full bg-ink px-3 py-1 text-sm font-bold text-white">
                      Reservado
                    </span>
                  )}
                </Link>
                <div className="flex flex-1 flex-col gap-1 p-4">
                  <h2 className="font-sans text-lg font-bold">
                    <Link href={`/animales/${animal.slug}`} className="hover:underline">
                      {animal.name}
                    </Link>
                  </h2>
                  <p className="text-sm text-slate">
                    {animal.breed ?? speciesLabel[animal.species]}
                  </p>
                  <div className="mt-auto pt-2">
                    {animal.listingType === 'ADOPTION' ? (
                      <span className="font-bold text-petbf">En adopción</span>
                    ) : (
                      animal.priceUsdCents != null && <Price usdCents={animal.priceUsdCents} rate={rate} />
                    )}
                  </div>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
      <Pagination
        page={animals.page}
        pageSize={animals.pageSize}
        total={animals.total}
        href={(pagina) => withParams('/animales', filters, { pagina })}
      />
    </>
  );
}

export default function AnimalsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="mb-2 text-4xl">Animales</h1>
      <p className="mb-6 max-w-2xl text-slate">
        Mascotas en venta con su ficha de salud y peludos que buscan un hogar.
      </p>
      <Suspense fallback={<p className="text-slate">Cargando…</p>}>
        <Animals searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
