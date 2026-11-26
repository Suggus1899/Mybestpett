import type { Metadata } from 'next';
import { Suspense } from 'react';
import { NoAccess } from '@/components/admin';
import { PaymentMethodForm, ZoneForm } from '@/components/settings-forms';
import { api } from '@/lib/api';
import { requireRoles } from '@/lib/guards';

export const metadata: Metadata = { title: 'Ajustes de la tienda' };

// Métodos de pago y zonas de envío: según el MVP, solo el administrador.
async function Settings() {
  // Lista vacía: solo pasa ADMIN.
  const { allowed } = await requireRoles([], '/admin/ajustes');
  if (!allowed) return <NoAccess />;
  const [methods, zones] = await Promise.all([api.managePaymentMethods(), api.manageZones()]);

  return (
    <>
      <h1 className="mb-6 text-3xl">Ajustes de la tienda</h1>

      <section aria-labelledby="metodos" className="mb-10">
        <h2 id="metodos" className="mb-2 text-2xl">
          Métodos de pago
        </h2>
        <p className="mb-4 text-slate">
          El cliente ve estos datos al pagar. La moneda de cada método es fija y el monto se calcula con la tasa
          BCV del día.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          {methods.map((m) => (
            <PaymentMethodForm key={m.id} method={m} />
          ))}
        </div>
      </section>

      <section aria-labelledby="zonas">
        <h2 id="zonas" className="mb-2 text-2xl">
          Zonas de envío
        </h2>
        <p className="mb-4 text-slate">
          En el checkout solo aparecen las zonas activas que cubren el estado de la dirección del cliente.
        </p>
        <div className="flex flex-col gap-4">
          {zones.map((z) => (
            <ZoneForm key={z.id} zone={z} />
          ))}
          <details className="rounded-[var(--radius-card)] border border-dashed border-line p-4">
            <summary className="min-h-11 cursor-pointer content-center font-bold text-petbf">Añadir zona</summary>
            <div className="mt-3">
              <ZoneForm />
            </div>
          </details>
        </div>
      </section>
    </>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<p className="text-slate">Cargando ajustes…</p>}>
      <Settings />
    </Suspense>
  );
}
