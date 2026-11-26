import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: { default: 'Panel', template: '%s · Panel Petbf' },
  robots: { index: false, follow: false },
};

const links = [
  { href: '/admin', label: 'Resumen' },
  { href: '/admin/pagos', label: 'Pagos' },
  { href: '/admin/pedidos', label: 'Pedidos' },
  { href: '/admin/inventario', label: 'Inventario' },
  { href: '/admin/ajustes', label: 'Ajustes' },
];

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
      {children}
    </div>
  );
}
