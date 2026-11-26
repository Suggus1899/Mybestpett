import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { NoAccess } from '@/components/admin';
import { Pagination } from '@/components/catalog';
import { ComboEditForm, ComboForm, CouponForm, CouponToggle } from '@/components/promotion-forms';
import { api, type Coupon } from '@/lib/api';
import { formatDateTime, formatUsd } from '@/lib/format';
import { requireRoles } from '@/lib/guards';
import { enumParam, pageParam } from '@/lib/search-params';

export const metadata: Metadata = { title: 'Promociones' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const VIEWS = ['cupones', 'combos'] as const;

function couponValue(c: Coupon) {
  if (c.type === 'FIXED') return `${formatUsd(c.value)} de descuento`;
  return `${c.value} %${c.maxDiscountUsdCents ? ` (tope ${formatUsd(c.maxDiscountUsdCents)})` : ''}`;
}

function couponRules(c: Coupon) {
  const rules = [];
  if (c.minSubtotalUsdCents > 0) rules.push(`desde ${formatUsd(c.minSubtotalUsdCents)}`);
  if (c.startsAt) rules.push(`desde el ${formatDateTime(c.startsAt)}`);
  if (c.endsAt) rules.push(`hasta el ${formatDateTime(c.endsAt)}`);
  rules.push(c.perUserLimit === 1 ? '1 uso por cliente' : `${c.perUserLimit} usos por cliente`);
  return rules.join(' · ');
}

async function Coupons({ page }: { page: number }) {
  const coupons = await api.manageCoupons({ page });
  return (
    <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
      <section aria-labelledby="lista-cupones">
        <h2 id="lista-cupones" className="mb-3 text-xl">
          Cupones
        </h2>
        {coupons.items.length === 0 ? (
          <p className="rounded-[var(--radius-card)] border border-line bg-white p-8 text-center font-bold">
            Todavía no hay cupones.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {coupons.items.map((c) => (
              <li
                key={c.id}
                aria-label={`Cupón ${c.code}`}
                className="flex flex-wrap justify-between gap-4 rounded-[var(--radius-card)] border border-line bg-white p-4"
              >
                <div className="flex flex-col gap-1">
                  <p>
                    <span className="font-display text-lg">{c.code}</span>{' '}
                    <span className={c.isActive ? 'font-bold text-petbf' : 'font-bold text-slate'}>
                      {c.isActive ? 'Activo' : 'Inactivo'}
                    </span>
                  </p>
                  <p>{c.description}</p>
                  <p className="text-sm">{couponValue(c)}</p>
                  <p className="text-sm text-slate">{couponRules(c)}</p>
                  <p className="text-sm text-slate">
                    Usado {c.uses}
                    {c.maxRedemptions ? ` de ${c.maxRedemptions}` : ''} {c.uses === 1 ? 'vez' : 'veces'} · descontado{' '}
                    {formatUsd(c.discountedUsdCents)}
                  </p>
                </div>
                <CouponToggle coupon={c} />
              </li>
            ))}
          </ul>
        )}
        <Pagination
          page={coupons.page}
          pageSize={coupons.pageSize}
          total={coupons.total}
          href={(pagina) => `/admin/promociones?ver=cupones&pagina=${pagina}`}
        />
      </section>
      <CouponForm />
    </div>
  );
}

async function Combos({ page }: { page: number }) {
  const combos = await api.manageCombos({ page });
  return (
    <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
      <section aria-labelledby="lista-combos">
        <h2 id="lista-combos" className="mb-3 text-xl">
          Combos
        </h2>
        {combos.items.length === 0 ? (
          <p className="rounded-[var(--radius-card)] border border-line bg-white p-8 text-center font-bold">
            Todavía no hay combos.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {combos.items.map((c) => (
              <li
                key={c.id}
                aria-label={`Combo ${c.name}`}
                className="grid gap-4 rounded-[var(--radius-card)] border border-line bg-white p-4 sm:grid-cols-[2fr_1fr]"
              >
                <div className="flex flex-col gap-1">
                  <p className="font-display text-lg">{c.name}</p>
                  <ul className="text-sm">
                    {c.items.map((i) => (
                      <li key={i.variantId}>
                        {i.quantity} × {i.product.name} ({i.variantName} · {i.sku}) · {formatUsd(i.unitPriceUsdCents)}
                      </li>
                    ))}
                  </ul>
                  <p className="text-sm">
                    {formatUsd(c.priceUsdCents)} en vez de {formatUsd(c.regularUsdCents)}
                  </p>
                  {!c.isActive && <p className="font-bold text-slate">Inactivo</p>}
                  {c.isActive && !c.sellable && (
                    <p className="font-bold text-danger">Oculto: algún producto ya no está a la venta.</p>
                  )}
                  {c.isActive && c.sellable && c.savingsUsdCents <= 0 && (
                    <p className="font-bold text-danger">Oculto: con los precios de hoy ya no ahorra. Baja su precio.</p>
                  )}
                  {c.isActive && c.sellable && c.savingsUsdCents > 0 && (
                    <p className="font-bold text-petbf">
                      En la tienda · ahorra {formatUsd(c.savingsUsdCents)} · alcanza para {c.available}
                    </p>
                  )}
                </div>
                <ComboEditForm combo={c} />
              </li>
            ))}
          </ul>
        )}
        <Pagination
          page={combos.page}
          pageSize={combos.pageSize}
          total={combos.total}
          href={(pagina) => `/admin/promociones?ver=combos&pagina=${pagina}`}
        />
      </section>
      <ComboForm />
    </div>
  );
}

async function Promotions({ searchParams }: { searchParams: SearchParams }) {
  const { allowed } = await requireRoles(['CATALOG_MANAGER'], '/admin/promociones');
  if (!allowed) return <NoAccess />;
  const raw = await searchParams;
  const view = enumParam(raw, 'ver', VIEWS) ?? 'cupones';
  const page = pageParam(raw);
  return (
    <>
      <h1 className="mb-2 text-3xl">Promociones</h1>
      <p className="mb-6 text-slate">
        Los combos se descuentan solos en el carrito por cada combo completo. Un pedido lleva como máximo un cupón, que
        se aplica sobre los productos después de los combos y nunca sobre el envío.
      </p>
      <nav aria-label="Tipo de promoción" className="mb-6 flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <Link
            key={v}
            href={`/admin/promociones?ver=${v}`}
            aria-current={v === view ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center rounded-full border px-4 font-bold ${
              v === view ? 'border-petbf bg-petbf text-white' : 'border-line bg-white'
            }`}
          >
            {v === 'cupones' ? 'Cupones' : 'Combos'}
          </Link>
        ))}
      </nav>
      {view === 'cupones' ? <Coupons page={page} /> : <Combos page={page} />}
    </>
  );
}

export default function PromotionsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<p className="text-slate">Cargando promociones…</p>}>
      <Promotions searchParams={searchParams} />
    </Suspense>
  );
}
