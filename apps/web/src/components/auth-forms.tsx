'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { loginAction, registerAction, type FormState } from '@/lib/actions';
import { Button, Field } from './ui';

function ErrorBox({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-[var(--radius-field)] bg-red-50 px-4 py-3 text-danger">
      {message}
    </p>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(loginAction, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <ErrorBox message={state.error} />
      <input type="hidden" name="next" value={next ?? '/cuenta'} />
      <Field
        label="Correo"
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        defaultValue={state.fields?.email}
      />
      <Field
        label="Contraseña"
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      <Button type="submit" disabled={pending}>
        {pending ? 'Entrando…' : 'Entrar'}
      </Button>
      <p className="text-center text-slate">
        ¿No tienes cuenta?{' '}
        <Link href="/registro" className="font-bold text-petbf hover:underline">
          Regístrate
        </Link>
      </p>
    </form>
  );
}

export function RegisterForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(registerAction, {});
  const f = state.fields;
  return (
    <form action={action} className="flex flex-col gap-4">
      <ErrorBox message={state.error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Nombre"
          id="firstName"
          name="firstName"
          autoComplete="given-name"
          required
          maxLength={80}
          defaultValue={f?.firstName}
        />
        <Field
          label="Apellido"
          id="lastName"
          name="lastName"
          autoComplete="family-name"
          required
          maxLength={80}
          defaultValue={f?.lastName}
        />
      </div>
      <Field
        label="Correo"
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        required
        defaultValue={f?.email}
      />
      <Field
        label="Teléfono (opcional)"
        id="phone"
        name="phone"
        type="tel"
        autoComplete="tel"
        placeholder="0412 1234567"
        defaultValue={f?.phone}
      />
      <Field
        label="Contraseña"
        id="password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={8}
        maxLength={128}
        hint="Al menos 8 caracteres."
      />
      <Button type="submit" disabled={pending}>
        {pending ? 'Creando cuenta…' : 'Crear cuenta'}
      </Button>
      <p className="text-center text-slate">
        ¿Ya tienes cuenta?{' '}
        <Link href="/entrar" className="font-bold text-petbf hover:underline">
          Entra
        </Link>
      </p>
    </form>
  );
}
