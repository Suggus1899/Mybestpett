import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Fragment, Suspense } from 'react';
import { Picture } from '@/components/catalog';
import { CartQuantityForm } from '@/components/shop-forms';
import { Button, ButtonLink } from '@/components/ui';
import { api } from '@/lib/api';
import { formatBs, formatUsd } from '@/lib/format';
import { removeFromCartAction } from '@/lib/shop-actions';
import { getCurrentUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Carrito', robots: { index: false } };

const issueText = {
  unavailable: 'Ya no está disponible. Quítalo para continuar.',
  insufficient_stock: 'No queda tanto stock. Baja la cantidad para continuar.',
};

async function CartView() {
  const user = await getCurrentUser();
  if (!user) redirect('/entrar?next=/carrito');
  const [cart, rates] = await Promise.all([api.cart(), api.rates()]);
  const rate = rates.usdVes?.rate ?? null;

  if (cart.items.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-line bg-white p-8 text-center">
        <p className="mb-4 font-bold">Tu carrito está vacío.</p>
        <ButtonLink href="/productos">Ver productos</ButtonLink>
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
      <ul className="flex flex-col gap-4" aria-label="Productos en el carrito">
        {cart.items.map((item) => {
          const label = `${item.product.name} ${item.name}`;
          return (
            <li
              key={item.variantId}
              className="grid grid-cols-[80px_1fr] gap-4 rounded-[var(--radius-card)] border border-line bg-white p-4"
            >
              <div className="overflow-hidden rounded-[var(--radius-field)]">
                <Picture image={item.product.image} fallback="" />
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap justify-between gap-2">
                  <div>
                    <Link href={`/productos/${item.product.slug}`} className="font-bold hover:underline">
                      {item.product.name}
                    </Link>
                    <p className="text-sm text-slate">
                      {item.name} · {formatUsd(item.unitPriceUsdCents)} c/u
                    </p>
                  </div>
                  <p className="font-extrabold">{formatUsd(item.lineTotalUsdCents)}</p>
                </div>
                {item.issue && (
                  <p role="alert" className="text-sm font-bold text-danger">
                    {issueText[item.issue]}
                  </p>
                )}
                <div className="flex flex-wrap items-start gap-3">
                  {item.issue !== 'unavailable' && (
                    <CartQuantityForm
                      variantId={item.variantId}
                      quantity={item.quantity}
                      max={item.available}
                      label={label}
                    />
                  )}
                  <form action={removeFromCartAction}>
                    <input type="hidden" name="variantId" value={item.variantId} />
                    <button
                      type="submit"
                      className="inline-flex min-h-11 items-center font-bold text-danger hover:underline"
                      aria-label={`Quitar ${label}`}
                    >
                      Quitar
                    </button>
                  </form>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <aside className="flex h-fit flex-col gap-4 rounded-[var(--radius-card)] border border-line bg-white p-5">
        <h2 className="text-xl">Resumen</h2>
        <dl className="grid grid-cols-[1fr_auto] gap-y-1">
          <dt>Subtotal ({cart.itemCount} {cart.itemCount === 1 ? 'producto' : 'productos'})</dt>
          <dd className="text-right font-extrabold">{formatUsd(cart.subtotalUsdCents)}</dd>
          {cart.combos.map((c) => (
            <Fragment key={c.comboId}>
              <dt className="text-petbf">
                Combo {c.name}
                {c.count > 1 && ` × ${c.count}`}
              </dt>
              <dd className="text-right font-bold text-petbf">−{formatUsd(c.savingsUsdCents)}</dd>
            </Fragment>
          ))}
          {cart.comboDiscountUsdCents > 0 && (
            <>
              <dt className="font-extrabold">Total de productos</dt>
              <dd className="text-right font-extrabold">{formatUsd(cart.itemsTotalUsdCents)}</dd>
            </>
          )}
          {rate && (
            <>
              <dt className="text-sm text-slate">En bolívares</dt>
              <dd className="text-right text-sm text-slate">{formatBs(cart.itemsTotalUsdCents, rate)}</dd>
            </>
          )}
        </dl>
        <p className="text-sm text-slate">
          {cart.itemsTotalUsdCents >= 2500
            ? 'Tu envío es gratis.'
            : `Te faltan ${formatUsd(2500 - cart.itemsTotalUsdCents)} para el envío gratis.`}
        </p>
        <p className="text-sm text-slate">¿Tienes un cupón? Lo aplicas al finalizar la compra.</p>
        {cart.canCheckout ? (
          <ButtonLink href="/checkout">Continuar con la compra</ButtonLink>
        ) : (
          <Button disabled>Continuar con la compra</Button>
        )}
      </aside>
    </div>
  );
}

export default function CartPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="mb-6 text-3xl">Carrito</h1>
      <Suspense fallback={<p className="text-slate">Cargando carrito…</p>}>
        <CartView />
      </Suspense>
    </div>
  );
}
