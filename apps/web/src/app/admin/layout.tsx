import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Button } from '@/components/ui';
import { logoutAction } from '@/lib/actions';
import { isStaff } from '@/lib/guards';
import { getCurrentUser } from '@/lib/session';

export const metadata: Metadata = {
  title: { default: 'Panel', template: '%s · Panel Petbf' },
  robots: { index: false, follow: false },
};

const links = [
  { href: '/admin', label: 'Resumen' },
  { href: '/admin/pagos', label: 'Pagos' },
  { href: '/admin/pedidos', label: 'Pedidos' },
  { href: '/admin/devoluciones', label: 'Devoluciones' },
  { href: '/admin/resenas', label: 'Reseñas' },
  { href: '/admin/promociones', label: 'Promociones' },
  { href: '/admin/inventario', label: 'Inventario' },
  { href: '/admin/ajustes', label: 'Ajustes' },
];

// El equipo usa el panel solo con una sesión que pasó la verificación en dos
// pasos. La API lo exige igual en cada petición; esto solo explica qué hacer.
async function TwoFactorGate({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user || !isStaff(user) || !user.twoFactor.required || user.twoFactor.verified) return children;
  return (
    <div role="alert" className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-line bg-white p-8">
      <h1 className="text-2xl">Falta la verificación en dos pasos</h1>
      {user.twoFactor.enabled ? (
        <>
          <p>Esta sesión entró sin el código de tu app. Cierra sesión y vuelve a entrar con el código.</p>
          <form action={logoutAction}>
            <Button type="submit">Cerrar sesión</Button>
          </form>
        </>
      ) : (
        <>
          <p>Para usar el panel, actívala en tu cuenta. Solo toma un minuto con una app de autenticación.</p>
          <Link href="/cuenta/seguridad" className="font-bold text-petbf hover:underline">
            Activar verificación en dos pasos
          </Link>
        </>
      )}
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <nav aria-label="Panel" className="mb-8 flex flex-wrap gap-2 border-b border-line pb-4">
        <span className="mr-4 font-display text-2xl">Panel</span>
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="inline-flex min-h-11 items-center rounded-full px-4 font-bold hover:bg-petbf-soft"
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <Suspense fallback={<p className="text-slate">Cargando…</p>}>
        <TwoFactorGate>{children}</TwoFactorGate>
      </Suspense>
    </div>
  );
}
