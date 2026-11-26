import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { Button } from '@/components/ui';
import { logoutAction } from '@/lib/actions';
import { getCurrentUser } from '@/lib/session';

export const metadata: Metadata = { title: 'Mi cuenta' };

const roleLabel = { CUSTOMER: 'Cliente', OPERATOR: 'Operador', ADMIN: 'Administrador' };

async function Account() {
  // La API valida el token: esta página nunca confía solo en la cookie.
  const user = await getCurrentUser();
  if (!user) redirect('/entrar?next=/cuenta');

  return (
    <>
      <h1 className="mb-6 text-3xl">Hola, {user.firstName}</h1>
      <dl className="mb-8 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
        <dt className="font-bold">Nombre</dt>
        <dd>
          {user.firstName} {user.lastName}
        </dd>
        <dt className="font-bold">Correo</dt>
        <dd>{user.email}</dd>
        <dt className="font-bold">Teléfono</dt>
        <dd>{user.phone ?? 'Sin registrar'}</dd>
        <dt className="font-bold">Tipo de cuenta</dt>
        <dd>{roleLabel[user.role]}</dd>
      </dl>
      <form action={logoutAction}>
        <Button type="submit" variant="secondary">
          Cerrar sesión
        </Button>
      </form>
    </>
  );
}

export default function AccountPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-12">
      <div className="rounded-[var(--radius-card)] border border-line bg-white p-6 sm:p-8">
        <Suspense fallback={<p className="text-slate">Cargando tu cuenta…</p>}>
          <Account />
        </Suspense>
      </div>
    </div>
  );
}
