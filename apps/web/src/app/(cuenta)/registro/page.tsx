import type { Metadata } from 'next';
import { RegisterForm } from '@/components/auth-forms';

export const metadata: Metadata = { title: 'Crear cuenta' };

export default function RegisterPage() {
  return (
    <>
      <h1 className="mb-2 text-3xl">Crea tu cuenta</h1>
      <p className="mb-6 text-slate">La necesitas para comprar y seguir tus pedidos.</p>
      <RegisterForm />
    </>
  );
}
