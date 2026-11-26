import Link from 'next/link';
import { Suspense } from 'react';
import { api } from '@/lib/api';
import { isStaff } from '@/lib/guards';
import { getCurrentUser } from '@/lib/session';

const nav = [
  { href: '/productos', label: 'Productos' },
  { href: '/combos', label: 'Combos' },
  { href: '/animales?tipo=venta', label: 'Animales' },
  { href: '/animales?tipo=adopcion', label: 'Adopción' },
];

async function AccountLink() {
  const user = await getCurrentUser();
  // Si el carrito no responde, la cabecera sigue funcionando sin el contador.
  const count = user ? await api.cart().then((c) => c.itemCount, () => 0) : 0;
  return user ? (
    <span className="flex gap-4">
      <Link href="/carrito" className="font-bold hover:underline">
        Carrito{count > 0 && <span aria-label={`${count} productos`}> ({count})</span>}
      </Link>
      {isStaff(user) && (
        <Link href="/admin" className="font-bold hover:underline">
          Panel
        </Link>
      )}
      <Link href="/cuenta" className="font-bold hover:underline">
        Hola, {user.firstName}
      </Link>
    </span>
  ) : (
    <Link href="/entrar" className="font-bold hover:underline">
      Entrar
    </Link>
  );
}

export function Header() {
  return (
    <header className="bg-petbf text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="font-display text-2xl font-semibold">
          Petbf
        </Link>
        <nav
          aria-label="Principal"
          className="order-last flex w-full gap-5 sm:order-none sm:w-auto"
        >
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="inline-flex min-h-11 items-center hover:underline"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        {/* La parte que depende de la sesión se transmite aparte. */}
        <Suspense fallback={<span className="opacity-70">…</span>}>
          <AccountLink />
        </Suspense>
      </div>
    </header>
  );
}
