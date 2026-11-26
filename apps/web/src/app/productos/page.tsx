import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Pagination, ProductCard } from '@/components/catalog';
import { Button } from '@/components/ui';
import { api, speciesLabel } from '@/lib/api';
import {
  enumParam,
  pageParam,
  SPECIES,
  slugParam,
  textParam,
  withParams,
} from '@/lib/search-params';

export const metadata: Metadata = { title: 'Productos' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function Catalog({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const filters = {
    categoria: slugParam(raw, 'categoria'),
    especie: enumParam(raw, 'especie', SPECIES),
    q: textParam(raw, 'q'),
    ofertas: enumParam(raw, 'ofertas', ['si'] as const),
    pagina: pageParam(raw),
  };

  const [categories, products, rates] = await Promise.all([
    api.categories(),
    api.products({
      category: filters.categoria,
      species: filters.especie,
      q: filters.q,
      onSale: filters.ofertas ? 'true' : undefined,
      page: filters.pagina,
    }),
    api.rates(),
  ]);
  const rate = rates.usdVes?.rate ?? null;
  const topCategories = categories.filter((c) => !c.parentId);
  const href = (changes: Record<string, string | number | undefined>) =>
    withParams('/productos', filters, { pagina: undefined, ...changes });
  const chip = (active: boolean) =>
    `inline-flex min-h-11 items-center rounded-full border px-4 font-bold ${
      active ? 'border-petbf bg-petbf text-white' : 'border-line bg-white hover:border-petbf'
    }`;

  return (
    <>
      <form action="/productos" className="mb-6 flex flex-wrap gap-3" role="search">
        <label htmlFor="q" className="sr-only">
          Buscar productos
        </label>
        <input
          id="q"
          name="q"
          type="search"
          defaultValue={filters.q}
          minLength={2}
          maxLength={80}
          placeholder="Busca alimento, juguetes, arena…"
          className="min-h-11 flex-1 rounded-full border border-line bg-white px-5 outline-none focus:border-petbf"
        />
        {filters.categoria && <input type="hidden" name="categoria" value={filters.categoria} />}
        {filters.especie && <input type="hidden" name="especie" value={filters.especie} />}
        <Button type="submit">Buscar</Button>
      </form>

      <nav aria-label="Categorías" className="mb-3 flex flex-wrap gap-2">
        <Link href={href({ categoria: undefined })} className={chip(!filters.categoria)}>
          Todo
        </Link>
        {topCategories.map((c) => (
          <Link
            key={c.id}
            href={href({ categoria: c.slug })}
            className={chip(filters.categoria === c.slug)}
            aria-current={filters.categoria === c.slug ? 'page' : undefined}
          >
            {c.name}
          </Link>
        ))}
      </nav>
      <div className="mb-8 flex flex-wrap gap-2">
        {SPECIES.map((s) => (
          <Link
            key={s}
            href={href({ especie: filters.especie === s ? undefined : s })}
            className={chip(filters.especie === s)}
          >
            {speciesLabel[s]}
          </Link>
        ))}
        <Link
          href={href({ ofertas: filters.ofertas ? undefined : 'si' })}
          className={chip(Boolean(filters.ofertas))}
        >
          Ofertas
        </Link>
      </div>

      <p className="mb-4 text-slate" aria-live="polite">
        {products.total === 1 ? '1 producto' : `${products.total} productos`}
        {filters.q && ` para “${filters.q}”`}
      </p>

      {products.items.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-line bg-white p-8 text-center">
          <p className="mb-4 font-bold">No encontramos productos con esos filtros.</p>
          <Link href="/productos" className="font-bold text-petbf hover:underline">
            Ver todo el catálogo
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {products.items.map((product) => (
            <li key={product.id}>
              <ProductCard product={product} rate={rate} />
            </li>
          ))}
        </ul>
      )}

      <Pagination
        page={products.page}
        pageSize={products.pageSize}
        total={products.total}
        href={(pagina) => withParams('/productos', filters, { pagina })}
      />
      {!rate && (
        <p className="mt-6 text-sm text-slate">
          Los precios en bolívares aparecerán cuando se cargue la tasa del día.
        </p>
      )}
    </>
  );
}

export default function ProductsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="mb-6 text-4xl">Productos</h1>
      <Suspense fallback={<p className="text-slate">Cargando productos…</p>}>
        <Catalog searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
