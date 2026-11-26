import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { NoAccess } from '@/components/admin';
import { Pagination } from '@/components/catalog';
import { Button } from '@/components/ui';
import { api, type InventoryRow } from '@/lib/api';
import { formatInt, formatUsd } from '@/lib/format';
import { requireRoles } from '@/lib/guards';
import { enumParam, pageParam, slugParam, textParam, withParams } from '@/lib/search-params';

export const metadata: Metadata = { title: 'Inventario' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const STATUS = ['all', 'out', 'low', 'in'] as const;
const SORT = ['stock_asc', 'stock_desc', 'name'] as const;

const statusLabel: Record<InventoryRow['status'], string> = {
  out: 'Agotado',
  low: 'Stock bajo',
  in: 'Con stock',
};
const statusClass: Record<InventoryRow['status'], string> = {
  out: 'bg-red-50 text-danger',
  low: 'bg-amber/25 text-ink',
  in: 'bg-petbf-soft text-petbf-dark',
};

async function Inventory({ searchParams }: { searchParams: SearchParams }) {
  const { allowed } = await requireRoles(['CATALOG_MANAGER', 'ORDERS_OPERATOR'], '/admin/inventario');
  if (!allowed) return <NoAccess />;

  const raw = await searchParams;
  const filters = {
    q: textParam(raw, 'q', 1),
    categoria: slugParam(raw, 'categoria'),
    estado: enumParam(raw, 'estado', STATUS),
    orden: enumParam(raw, 'orden', SORT),
    inactivos: enumParam(raw, 'inactivos', ['si'] as const),
    pagina: pageParam(raw),
  };

  const [categories, inventory] = await Promise.all([
    api.categories(),
    api.inventory({
      q: filters.q,
      category: filters.categoria,
      status: filters.estado,
      sort: filters.orden,
      includeInactive: filters.inactivos ? 'true' : undefined,
      page: filters.pagina,
    }),
  ]);
  const select =
    'min-h-11 rounded-[var(--radius-field)] border border-line bg-white px-3 outline-none focus:border-petbf';

  return (
    <>
      <h1 className="mb-6 text-3xl">Inventario</h1>

      <form action="/admin/inventario" className="mb-6 grid gap-3 rounded-[var(--radius-card)] border border-line bg-white p-4 md:grid-cols-[2fr_1fr_1fr_1fr_auto]">
        <div className="flex flex-col gap-1">
          <label htmlFor="q" className="text-sm font-bold">
            Producto o SKU
          </label>
          <input id="q" name="q" type="search" defaultValue={filters.q} maxLength={80} className={select} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="categoria" className="text-sm font-bold">
            Categoría
          </label>
          <select id="categoria" name="categoria" defaultValue={filters.categoria ?? ''} className={select}>
            <option value="">Todas</option>
            {categories.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.parentId ? `— ${c.name}` : c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="estado" className="text-sm font-bold">
            Estado
          </label>
          <select id="estado" name="estado" defaultValue={filters.estado ?? 'all'} className={select}>
            <option value="all">Todos</option>
            <option value="out">Agotados</option>
            <option value="low">Stock bajo</option>
            <option value="in">Con stock</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="orden" className="text-sm font-bold">
            Ordenar por
          </label>
          <select id="orden" name="orden" defaultValue={filters.orden ?? 'stock_asc'} className={select}>
            <option value="stock_asc">Menos stock primero</option>
            <option value="stock_desc">Más stock primero</option>
            <option value="name">Nombre</option>
          </select>
        </div>
        <div className="flex flex-col justify-end gap-2">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="inactivos" value="si" defaultChecked={Boolean(filters.inactivos)} className="size-5" />
            Incluir inactivos
          </label>
          <Button type="submit">Filtrar</Button>
        </div>
      </form>

      <p className="mb-3 text-slate" aria-live="polite">
        {inventory.total === 1 ? '1 presentación' : `${formatInt(inventory.total)} presentaciones`}
      </p>

      {inventory.items.length === 0 ? (
        <p className="rounded-[var(--radius-card)] border border-line bg-white p-8 text-center font-bold">
          No hay resultados con esos filtros.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-line bg-white">
          <table className="w-full min-w-[720px] text-left">
            <caption className="sr-only">Stock por presentación</caption>
            <thead className="border-b border-line bg-mist text-sm">
              <tr>
                <th scope="col" className="px-4 py-3">Producto</th>
                <th scope="col" className="px-4 py-3">SKU</th>
                <th scope="col" className="px-4 py-3">Categoría</th>
                <th scope="col" className="px-4 py-3 text-right">Precio</th>
                <th scope="col" className="px-4 py-3 text-right">Stock</th>
                <th scope="col" className="px-4 py-3">Estado</th>
              </tr>
            </thead>
            <tbody>
              {inventory.items.map((row) => (
                <tr key={row.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-3">
                    <Link href={`/productos/${row.product.slug}`} className="font-bold hover:underline">
                      {row.product.name}
                    </Link>
                    <span className="block text-sm text-slate">
                      {row.name}
                      {(!row.isActive || !row.product.isActive) && ' · inactivo'}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-sm">{row.sku}</td>
                  <td className="px-4 py-3">{row.product.category.name}</td>
                  <td className="px-4 py-3 text-right">{formatUsd(row.priceUsdCents)}</td>
                  <td className="px-4 py-3 text-right font-extrabold">{formatInt(row.stock)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-3 py-1 text-sm font-bold ${statusClass[row.status]}`}>
                      {statusLabel[row.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={inventory.page}
        pageSize={inventory.pageSize}
        total={inventory.total}
        href={(pagina) => withParams('/admin/inventario', filters, { pagina })}
      />
    </>
  );
}

export default function InventoryPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="text-slate">Cargando inventario…</p>}>
      <Inventory searchParams={searchParams} />
    </Suspense>
  );
}
