import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { DisableTwoFactor, EnableTwoFactor } from '@/components/two-factor-forms';
import { getCurrentUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Seguridad', robots: { index: false } };

async function Security() {
  const user = await getCurrentUser();
  if (!user) redirect('/entrar?next=/cuenta/seguridad');
  const { twoFactor } = user;

  return (
    <>
      <h1 className="mb-2 text-3xl">Verificación en dos pasos</h1>
      <p className="mb-6 text-slate">
        Además de la contraseña, pide un código de tu teléfono al entrar. Así, aunque alguien conozca tu contraseña, no
        puede entrar al panel.
      </p>
      {!twoFactor.available ? (
        <p>Por ahora está disponible para las cuentas del equipo.</p>
      ) : twoFactor.enabled ? (
        <div className="flex flex-col gap-6">
          <p role="status" className="rounded-[var(--radius-field)] bg-petbf-soft px-4 py-3 font-bold">
            Activa
            {twoFactor.verified ? '' : '. Esta sesión entró sin código: vuelve a entrar para usar el panel.'}
          </p>
          <section aria-labelledby="desactivar" className="flex flex-col gap-3">
            <h2 id="desactivar" className="text-xl">
              Desactivar
            </h2>
            {twoFactor.required && (
              <p className="text-danger">Sin ella no podrás usar el panel: es obligatoria para el equipo.</p>
            )}
            <DisableTwoFactor />
          </section>
        </div>
      ) : (
        <EnableTwoFactor />
      )}
      <p className="mt-8">
        <Link href="/cuenta" className="font-bold text-petbf hover:underline">
          Volver a mi cuenta
        </Link>
      </p>
    </>
  );
}

export default function SecurityPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12">
      <div className="rounded-[var(--radius-card)] border border-line bg-white p-6 sm:p-8">
        <Suspense fallback={<p className="text-slate">Cargando…</p>}>
          <Security />
        </Suspense>
      </div>
    </div>
  );
}
