'use client';

import { useActionState } from 'react';
import {
  disableTwoFactorAction,
  enableTwoFactorAction,
  setupTwoFactorAction,
  type FormState,
  type SetupState,
} from '@/lib/actions';
import { Button, Field, Notice } from './ui';

// Clave en grupos de 4 para copiarla a mano sin errores.
const grouped = (secret: string) => secret.match(/.{1,4}/g)?.join(' ') ?? secret;

// Activar: genera la clave, se agrega a la app y se confirma con un código.
// Al final muestra los códigos de recuperación una sola vez.
export function EnableTwoFactor() {
  const [setup, generate, generating] = useActionState<SetupState, FormData>(setupTwoFactorAction, {});
  const [enabled, enable, enabling] = useActionState<SetupState, FormData>(enableTwoFactorAction, {});

  if (enabled.recoveryCodes) {
    return (
      <section aria-labelledby="recuperacion" className="flex flex-col gap-3">
        <Notice ok="Verificación en dos pasos activada" />
        <h2 id="recuperacion" className="text-xl">
          Guarda tus códigos de recuperación
        </h2>
        <p>
          Cada uno sirve una sola vez para entrar si pierdes el teléfono. No los volverás a ver: guárdalos en un lugar
          seguro, fuera de este equipo.
        </p>
        <ul className="grid grid-cols-2 gap-2 font-mono text-lg" aria-label="Códigos de recuperación">
          {enabled.recoveryCodes.map((code) => (
            <li key={code}>{code}</li>
          ))}
        </ul>
      </section>
    );
  }

  if (!setup.secret) {
    return (
      <form action={generate} className="flex flex-col gap-3">
        <Notice error={setup.error} />
        <p>Necesitas una app de autenticación, como Google Authenticator, Authy o 1Password.</p>
        <Button type="submit" disabled={generating} className="self-start">
          {generating ? 'Generando…' : 'Configurar verificación en dos pasos'}
        </Button>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex list-decimal flex-col gap-2 pl-5">
        <li>
          En tu app, agrega una cuenta con esta clave (o{' '}
          <a href={setup.otpauthUrl} className="font-bold text-petbf hover:underline">
            ábrela en la app
          </a>{' '}
          desde el teléfono):
          <p className="mt-1 font-mono text-lg" data-testid="totp-secret">
            {grouped(setup.secret)}
          </p>
        </li>
        <li>Escribe el código de 6 dígitos que muestra la app.</li>
      </ol>
      <form action={enable} className="flex flex-col gap-3">
        <Notice error={enabled.error} />
        <Field
          label="Código de la app"
          id="enable-code"
          name="code"
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="\d{3}\s?\d{3}"
          required
        />
        <Button type="submit" disabled={enabling} className="self-start">
          {enabling ? 'Activando…' : 'Activar'}
        </Button>
      </form>
    </div>
  );
}

export function DisableTwoFactor() {
  const [state, action, pending] = useActionState<FormState, FormData>(disableTwoFactorAction, {});
  return (
    <form action={action} aria-label="Desactivar verificación en dos pasos" className="flex flex-col gap-3">
      <Notice error={state.error} />
      <Field label="Contraseña" id="disable-password" name="password" type="password" autoComplete="current-password" required />
      <Field label="Código de la app o de recuperación" id="disable-code" name="code" autoComplete="one-time-code" required />
      <Button type="submit" variant="secondary" disabled={pending} className="self-start">
        {pending ? 'Desactivando…' : 'Desactivar'}
      </Button>
    </form>
  );
}
