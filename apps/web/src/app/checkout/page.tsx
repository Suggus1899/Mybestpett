import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { AddressForm, CheckoutForm } from '@/components/shop-forms';
import { api } from '@/lib/api';
import { formatUsd } from '@/lib/format';
import { getCurrentUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Finalizar compra', robots: { index: false } };

async function Checkout() {
  const user = await getCurrentUser();
  if (!user) redirect('/entrar?next=/checkout');
  const [cart, addresses, zones, methods, rates] = await Promise.all([
    api.cart(),
    api.addresses(),
    api.shippingZones(),
    api.paymentMethods(),
    api.rates(),
  ]);
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
            subtotalUsdCents={cart.subtotalUsdCents}
            usdVes={rates.usdVes?.rate ?? null}
            eurVes={rates.eurVes?.rate ?? null}
          />
        )}
      </div>

      <aside className="flex h-fit flex-col gap-3 rounded-[var(--radius-card)] border border-line bg-white p-5">
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

export default function CheckoutPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="mb-6 text-3xl">Finalizar compra</h1>
      <Suspense fallback={<p className="text-slate">Cargando…</p>}>
        <Checkout />
      </Suspense>
    </div>
  );
}
