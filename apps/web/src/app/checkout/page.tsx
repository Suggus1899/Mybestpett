import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Fragment, Suspense } from 'react';
import { AddressForm, CheckoutForm } from '@/components/shop-forms';
import { Button, inputClass } from '@/components/ui';
import { api } from '@/lib/api';
import { formatUsd } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Finalizar compra', robots: { index: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

async function Checkout({ searchParams }: { searchParams: SearchParams }) {
  const user = await getCurrentUser();
  if (!user) redirect('/entrar?next=/checkout');
  const raw = (await searchParams).cupon;
  const code = typeof raw === 'string' ? raw.trim().slice(0, 30) : '';
  // Con ?cupon= se prueba el cupón; si no aplica, se muestra el motivo y se
  // sigue con el carrito sin cupón.
  const [quoted, addresses, zones, methods, rates, points] = await Promise.all([
    code ? api.cartWithCoupon(code) : api.cart().then((cart) => ({ cart })),
    api.addresses(),
    api.shippingZones(),
    api.paymentMethods(),
    api.rates(),
    api.points({ pageSize: 1 }),
  ]);
  const couponError = 'error' in quoted ? quoted.error : null;
  const cart = 'cart' in quoted ? quoted.cart : await api.cart();
  if (!cart.canCheckout) redirect('/carrito');

  return (
    <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
      <div className="flex flex-col gap-8">
        {addresses.length === 0 ? (
          <section aria-labelledby="nueva-direccion" className="rounded-[var(--radius-card)] border border-line bg-white p-5">
            <h2 id="nueva-direccion" className="mb-4 text-xl">
              ¿A dónde te lo enviamos?
            </h2>
            <AddressForm />
          </section>
        ) : (
          <CheckoutForm
            addresses={addresses}
            zones={zones}
            methods={methods}
            itemsTotalUsdCents={cart.itemsTotalUsdCents}
            couponCode={cart.coupon?.code}
            pointsBalance={points.balance}
            usdVes={rates.usdVes?.rate ?? null}
            eurVes={rates.eurVes?.rate ?? null}
          />
        )}
      </div>

      <aside className="flex h-fit min-w-0 flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-white p-5">
        <h2 className="text-xl">Tu pedido</h2>
        <ul className="flex flex-col gap-2">
          {cart.items.map((item) => (
            <li key={item.variantId} className="flex justify-between gap-3 text-sm">
              <span>
                {item.quantity} × {item.product.name} ({item.name})
              </span>
              <span className="font-bold">{formatUsd(item.lineTotalUsdCents)}</span>
            </li>
          ))}
        </ul>
        <dl className="grid grid-cols-[1fr_auto] gap-y-1 border-t border-line pt-3 text-sm">
          <dt>Subtotal</dt>
          <dd className="text-right">{formatUsd(cart.subtotalUsdCents)}</dd>
          {cart.combos.map((c) => (
            <Fragment key={c.comboId}>
              <dt className="text-petbf">
                Combo {c.name}
                {c.count > 1 && ` × ${c.count}`}
              </dt>
              <dd className="text-right font-bold text-petbf">−{formatUsd(c.savingsUsdCents)}</dd>
            </Fragment>
          ))}
          {cart.coupon && (
            <>
              <dt className="text-petbf">Cupón {cart.coupon.code}</dt>
              <dd className="text-right font-bold text-petbf">−{formatUsd(cart.coupon.discountUsdCents)}</dd>
            </>
          )}
        </dl>
        <form action="/checkout" aria-label="Cupón de descuento" className="flex flex-col gap-2 border-t border-line pt-3">
          <label htmlFor="cupon" className="font-bold">
            Cupón de descuento
          </label>
          <div className="flex gap-2">
            <input
              id="cupon"
              name="cupon"
              defaultValue={code}
              maxLength={30}
              autoCapitalize="characters"
              aria-invalid={couponError ? true : undefined}
              aria-describedby={couponError ? 'cupon-error' : cart.coupon ? 'cupon-ok' : undefined}
              className={`${inputClass} w-full min-w-0 flex-1 uppercase`}
            />
            <Button type="submit" variant="secondary">
              Aplicar
            </Button>
          </div>
          {couponError && (
            <p id="cupon-error" role="alert" className="text-sm text-danger">
              {couponError}
            </p>
          )}
          {cart.coupon && (
            <p id="cupon-ok" className="text-sm text-petbf">
              {cart.coupon.description}.{' '}
              <Link href="/checkout" className="font-bold underline">
                Quitar cupón
              </Link>
            </p>
          )}
          <p className="text-xs text-slate">Un cupón por pedido. Se aplica sobre los productos, no sobre el envío.</p>
        </form>
        {addresses.length > 0 && (
          <details className="text-sm">
            <summary className="min-h-11 cursor-pointer content-center font-bold text-petbf">
              Añadir otra dirección
            </summary>
            <div className="mt-3">
              <AddressForm />
            </div>
          </details>
        )}
      </aside>
    </div>
  );
}

export default function CheckoutPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="mb-6 text-3xl">Finalizar compra</h1>
      <Suspense fallback={<p className="text-slate">Cargando…</p>}>
        <Checkout searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
