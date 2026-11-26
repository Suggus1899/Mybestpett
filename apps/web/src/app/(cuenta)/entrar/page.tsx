import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoginForm } from '@/components/auth-forms';

export const metadata: Metadata = { title: 'Entrar' };

async function Form({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <LoginForm next={next} />;
}

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  return (
    <>
      <h1 className="mb-6 text-3xl">Entra a tu cuenta</h1>
      <Suspense>
        <Form searchParams={searchParams} />
      </Suspense>
    </>
  );
}
