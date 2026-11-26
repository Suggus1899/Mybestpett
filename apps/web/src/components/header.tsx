import Link from 'next/link';
import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/session';

const nav = [
  { href: '/#productos', label: 'Productos' },
  { href: '/#animales', label: 'Animales' },
  { href: '/#adopcion', label: 'Adopción' },
];

async function AccountLink() {
  const user = await getCurrentUser();
  return user ? (
    <Link href="/cuenta" className="font-bold hover:underline">
      Hola, {user.firstName}
    </Link>
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
