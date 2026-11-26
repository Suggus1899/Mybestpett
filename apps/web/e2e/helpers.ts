import { expect, type Page } from '@playwright/test';

export const API = process.env.E2E_API_URL ?? 'http://localhost:3001/v1';
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@petbf.local';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'admin-local-123456';
export const PASSWORD = 'clave-segura-1';

type Role = 'ADMIN' | 'ORDERS_OPERATOR' | 'CATALOG_MANAGER' | 'ADOPTION_COORDINATOR';

async function post(path: string, body: unknown, token?: string, method = 'POST') {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

let adminToken: string | undefined;
async function admin() {
  adminToken ??= (await post('/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }))
    .accessToken;
  return adminToken!;
}

// Crea una cuenta nueva (y le da roles si hace falta). Devuelve su correo.
export async function createUser(roles: Role[] = [], firstName = 'Prueba') {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.com`;
  const { user } = await post('/auth/register', {
    email,
    password: PASSWORD,
    firstName,
    lastName: 'E2E',
  });
  if (roles.length > 0) await post(`/users/${user.id}/roles`, { roles }, await admin(), 'PUT');
  return email;
}

export async function login(page: Page, email: string, next = '/cuenta') {
  await page.goto(`/entrar?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL(`**${next}`);
}

// Las páginas transmiten su contenido por partes: espera a que termine.
export async function ready(page: Page) {
  await expect(page.getByText(/^Cargando/)).toHaveCount(0);
}

export async function open(page: Page, path: string) {
  const response = await page.goto(path);
  await ready(page);
  return response;
}
