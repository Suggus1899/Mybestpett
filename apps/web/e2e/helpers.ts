import { createHmac } from 'node:crypto';
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

// Producto propio de cada prueba de compra, para no gastar el stock del seed
// que usan las pruebas del inventario. Devuelve su nombre y su slug.
// Stock por defecto 10: menos que el seed, para no alterar sus órdenes.
const created: string[] = [];
export async function createProduct(priceUsdCents: number, stock = 10) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const categories: { id: string; slug: string }[] = await fetch(`${API}/categories`).then((r) =>
    r.json(),
  );
  const perros = categories.find((c) => c.slug === 'perros')!;
  const product = await post(
    '/manage/products',
    {
      name: `Pelota E2E ${id}`,
      description: 'Producto de prueba',
      categoryId: perros.id,
      variants: [{ sku: `E2E-${id}`.toUpperCase().slice(0, 40), name: 'Unidad', priceUsdCents, stock }],
    },
    await admin(),
  );
  created.push(product.id);
  return { name: product.name as string, slug: product.slug as string };
}

// Al terminar, se retiran de la tienda y del inventario para no ensuciar el
// catálogo que revisan las otras pruebas.
export async function retireTestProducts() {
  for (const id of created.splice(0)) {
    await post(`/manage/products/${id}`, { isActive: false }, await admin(), 'PATCH');
  }
}

// Lleva un pedido con pago reportado hasta entregado, como lo haría el equipo.
export async function deliverOrder(orderId: string) {
  const token = await admin();
  const order = await fetch(`${API}/manage/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  const payment = order.payments.find((p: { status: string }) => p.status === 'REPORTED');
  await post(`/manage/payments/${payment.id}/verify`, undefined, token);
  await post(`/manage/orders/${orderId}/status`, { status: 'PREPARING' }, token);
  await post(`/manage/orders/${orderId}/status`, { status: 'SHIPPED', trackingCode: 'MRW-1' }, token);
  await post(`/manage/orders/${orderId}/status`, { status: 'DELIVERED' }, token);
}

// Al terminar, rechaza los pagos de prueba que quedaron en revisión: la cola
// del panel va del más antiguo al más nuevo y, si se acumulan, los de la
// siguiente corrida quedarían fuera de la primera página.
export async function settleTestPayments() {
  const token = await admin();
  for (;;) {
    const page = await fetch(`${API}/manage/payments?status=REPORTED&pageSize=60`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => r.json());
    const mine = page.items.filter((p: { order: { user: { email: string } } }) => p.order.user.email.startsWith('e2e-'));
    if (mine.length === 0) return;
    for (const p of mine) {
      await post(`/manage/payments/${p.id}/reject`, { reason: 'Limpieza de pruebas' }, token);
    }
  }
}

// Código TOTP (RFC 6238, SHA-1, 6 dígitos, 30 s) para la clave base32 dada.
// `offset` en pasos de 30 s: la API acepta uno de margen.
export function totp(secret: string, offset = 0) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of secret.replace(/\s/g, '')) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offset));
  const hmac = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const at = hmac[hmac.length - 1] & 0x0f;
  return String((hmac.readUInt32BE(at) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
