import Link from 'next/link';
import { Suspense } from 'react';
import { NoAccess, Stat } from '@/components/admin';
import { api } from '@/lib/api';
import { formatInt, formatUsd } from '@/lib/format';
import { requireRoles } from '@/lib/guards';

const INVENTORY_ROLES = ['CATALOG_MANAGER', 'ORDERS_OPERATOR'] as const;

async function Summary() {
  const { user, allowed } = await requireRoles([...INVENTORY_ROLES], '/admin');
  if (!allowed) {
    return user.roles.some((r) => r !== 'CUSTOMER') ? (
      <p className="text-slate">Hola, {user.firstName}. Tus secciones llegan pronto.</p>
    ) : (
      <NoAccess />
    );
  }
  const summary = await api.inventorySummary();

  return (
    <>
      <h1 className="mb-6 text-3xl">Hola, {user.firstName}</h1>
      <section aria-labelledby="inventario">
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 id="inventario" className="text-2xl">
            Inventario
          </h2>
          <Link href="/admin/inventario" className="font-bold text-petbf hover:underline">
            Ver inventario completo
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat label="Unidades en stock" value={formatInt(summary.units)} />
          <Stat label="Valor a precio de venta" value={formatUsd(summary.valueUsdCents)} />
          <Stat
            label="Agotados"
            value={formatInt(summary.outOfStock)}
            tone={summary.outOfStock > 0 ? 'danger' : 'default'}
          />
          <Stat
            label={`Stock bajo (≤ ${summary.lowThreshold})`}
            value={formatInt(summary.lowStock)}
            tone={summary.lowStock > 0 ? 'warn' : 'default'}
          />
          <Stat label="Presentaciones a la venta" value={formatInt(summary.variants)} />
          <Stat label="Animales en venta" value={formatInt(summary.animalsForSale)} />
          <Stat label="Animales en adopción" value={formatInt(summary.animalsForAdoption)} />
        </div>
      </section>
    </>
  );
}

export default function AdminHome() {
  return (
    <Suspense fallback={<p className="text-slate">Cargando…</p>}>
      <Summary />
    </Suspense>
  );
}
