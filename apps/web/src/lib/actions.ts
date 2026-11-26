'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { API_URL, REFRESH_COOKIE } from './config';
import { clearSession, saveSession, type AuthTokens } from './session';

export interface FormState {
  error?: string;
  fields?: Record<string, string>;
}

function text(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value : '';
}

// Convierte la respuesta de error de la API en un mensaje legible.
async function errorMessage(res: Response): Promise<string> {
  if (res.status === 429) return 'Demasiados intentos. Espera un minuto.';
  try {
    const body = await res.json();
    const message = Array.isArray(body.message) ? body.message[0] : body.message;
    if (typeof message === 'string') {
      // "password: La contraseña..." -> "La contraseña..."
      return message.replace(/^[a-zA-Z]+: /, '');
    }
  } catch {}
  return 'Algo salió mal. Inténtalo de nuevo.';
}

// Solo se aceptan rutas internas para evitar redirecciones a otros sitios.
function safeNext(value: string) {
  return value.startsWith('/') && !value.startsWith('//') ? value : '/cuenta';
}

async function post(path: string, body: unknown) {
  return fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

export async function loginAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = text(formData, 'email');
  let res: Response;
  try {
    res = await post('/auth/login', { email, password: text(formData, 'password') });
  } catch {
    return { error: 'No pudimos conectar con el servidor.', fields: { email } };
  }
  if (!res.ok) return { error: await errorMessage(res), fields: { email } };

  await saveSession((await res.json()) as AuthTokens);
  redirect(safeNext(text(formData, 'next')));
}

export async function registerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const fields = {
    firstName: text(formData, 'firstName'),
    lastName: text(formData, 'lastName'),
    email: text(formData, 'email'),
    phone: text(formData, 'phone'),
  };
  let res: Response;
  try {
    res = await post('/auth/register', {
      ...fields,
      phone: fields.phone || undefined,
      password: text(formData, 'password'),
    });
  } catch {
    return { error: 'No pudimos conectar con el servidor.', fields };
  }
  if (!res.ok) return { error: await errorMessage(res), fields };

  await saveSession((await res.json()) as AuthTokens);
  redirect('/cuenta');
}

export async function logoutAction() {
  const refreshToken = (await cookies()).get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    // Si la API no responde igual se borran las cookies locales.
    await post('/auth/logout', { refreshToken }).catch(() => undefined);
  }
  await clearSession();
  redirect('/');
}
