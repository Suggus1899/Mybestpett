'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCESS_COOKIE, API_URL, CHALLENGE_COOKIE, REFRESH_COOKIE } from './config';
import { forwardHeaders } from './forward';
import { clearSession, saveSession, type AuthTokens } from './session';

export interface FormState {
  error?: string;
  ok?: string;
  fields?: Record<string, string>;
  twoFactor?: boolean; // la contraseña es correcta; falta el código
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
    headers: { ...forwardHeaders(await headers()), 'Content-Type': 'application/json' },
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

  const body = await res.json();
  if (body.twoFactorRequired) {
    // El token intermedio va en una cookie httpOnly, fuera del HTML.
    (await cookies()).set(CHALLENGE_COOKIE, body.challengeToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 300,
    });
    return { twoFactor: true, fields: { email } };
  }
  await saveSession(body as AuthTokens);
  redirect(safeNext(text(formData, 'next')));
}

export async function twoFactorLoginAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const store = await cookies();
  const challengeToken = store.get(CHALLENGE_COOKIE)?.value;
  if (!challengeToken) {
    return { error: 'El inicio de sesión venció. Vuelve a escribir tu contraseña.' };
  }
  let res: Response;
  try {
    res = await post('/auth/2fa/login', { challengeToken, code: text(formData, 'code') });
  } catch {
    return { twoFactor: true, error: 'No pudimos conectar con el servidor.' };
  }
  if (!res.ok) return { twoFactor: true, error: await errorMessage(res) };
  store.delete(CHALLENGE_COOKIE);
  await saveSession((await res.json()) as AuthTokens);
  redirect(safeNext(text(formData, 'next')));
}

// ---------- Configuración de 2FA (cuenta del equipo) ----------

// Llamada con la sesión. Devuelve null si no hay conexión con la API.
async function authed(path: string, body: unknown): Promise<Response | null> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect('/entrar?next=/cuenta/seguridad');
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: {
        ...forwardHeaders(await headers()),
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    return null;
  }
  // Fuera del try: redirect() lanza una excepción que Next debe recibir.
  if (res.status === 401) redirect('/entrar?next=/cuenta/seguridad');
  return res;
}

const offline = 'No pudimos conectar con el servidor.';

export interface SetupState extends FormState {
  secret?: string;
  otpauthUrl?: string;
  recoveryCodes?: string[];
}

export async function setupTwoFactorAction(): Promise<SetupState> {
  const res = await authed('/auth/2fa/setup', {});
  if (!res) return { error: offline };
  if (!res.ok) return { error: await errorMessage(res) };
  return res.json();
}

export async function enableTwoFactorAction(prev: SetupState, formData: FormData): Promise<SetupState> {
  const res = await authed('/auth/2fa/enable', { code: text(formData, 'code') });
  if (!res) return { ...prev, error: offline };
  if (!res.ok) return { ...prev, error: await errorMessage(res) };
  const { recoveryCodes } = await res.json();
  return { recoveryCodes };
}

export async function disableTwoFactorAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const res = await authed('/auth/2fa/disable', {
    password: text(formData, 'password'),
    code: text(formData, 'code'),
  });
  if (!res) return { error: offline };
  if (!res.ok) return { error: await errorMessage(res) };
  redirect('/cuenta/seguridad');
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
