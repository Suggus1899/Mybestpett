import { expect, test } from '@playwright/test';
import { createUser, login, open, ready } from './helpers';

// Panel administrativo: acceso por rol, resumen e inventario.

test.describe('acceso al panel', () => {
  test('sin sesión, el panel lleva a entrar y luego vuelve', async ({ page }) => {
    const email = await createUser(['CATALOG_MANAGER']);
    await page.goto('/admin/inventario');
    await page.waitForURL('**/entrar?next=%2Fadmin%2Finventario');
    await page.getByLabel('Correo').fill(email);
    await page.getByLabel('Contraseña').fill('clave-segura-1');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL('**/admin/inventario');
    await ready(page);
    await expect(page.getByRole('heading', { name: 'Inventario' })).toBeVisible();
  });

  test('un cliente no ve el enlace ni puede entrar', async ({ page }) => {
    await login(page, await createUser());
    await expect(page.getByRole('banner').getByRole('link', { name: 'Panel' })).toHaveCount(0);
    await open(page, '/admin');
    await expect(page.getByRole('heading', { name: 'No tienes acceso a esta sección' })).toBeVisible();
    await open(page, '/admin/inventario');
    await expect(page.getByRole('heading', { name: 'No tienes acceso a esta sección' })).toBeVisible();
  });

  test('adopciones ve el panel pero no el inventario', async ({ page }) => {
    await login(page, await createUser(['ADOPTION_COORDINATOR']));
    await expect(page.getByRole('banner').getByRole('link', { name: 'Panel' })).toBeVisible();
    await open(page, '/admin/inventario');
    await expect(page.getByRole('heading', { name: 'No tienes acceso a esta sección' })).toBeVisible();
  });

  for (const role of ['CATALOG_MANAGER', 'ORDERS_OPERATOR', 'ADMIN'] as const) {
    test(`${role} accede al inventario`, async ({ page }) => {
      await login(page, await createUser([role]), '/admin');
      await ready(page);
      await expect(page.getByText('Unidades en stock')).toBeVisible();
      await open(page, '/admin/inventario');
      await expect(page.getByRole('table')).toBeVisible();
    });
  }

  test('si pierde el rol, pierde el acceso al instante', async ({ page }) => {
    // El admin quita el rol mientras la persona tiene la sesión abierta.
    const email = await createUser(['CATALOG_MANAGER']);
    await login(page, email, '/admin');
    await ready(page);
    await expect(page.getByText('Unidades en stock')).toBeVisible();

    const { API } = await import('./helpers');
    const adminLogin = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: process.env.E2E_ADMIN_EMAIL ?? 'admin@petbf.local',
        password: process.env.E2E_ADMIN_PASSWORD ?? 'admin-local-123456',
      }),
    }).then((r) => r.json());
    const users = await fetch(`${API}/users?pageSize=100`, {
      headers: { Authorization: `Bearer ${adminLogin.accessToken}` },
    }).then((r) => r.json());
    const target = users.items.find((u: { email: string }) => u.email === email);
    await fetch(`${API}/users/${target.id}/roles`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminLogin.accessToken}`,
      },
      body: JSON.stringify({ roles: [] }),
    });

    await open(page, '/admin/inventario');
    await expect(page.getByRole('heading', { name: 'No tienes acceso a esta sección' })).toBeVisible();
  });
});

test.describe('inventario', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, await createUser(['CATALOG_MANAGER']), '/admin');
    await ready(page);
  });

  test('el resumen muestra unidades, valor, agotados y animales', async ({ page }) => {
    for (const label of [
      'Unidades en stock',
      'Valor a precio de venta',
      'Agotados',
      /Stock bajo/,
      'Animales en venta',
      'Animales en adopción',
    ]) {
      await expect(page.getByText(label)).toBeVisible();
    }
  });

  test('ordena con lo agotado primero y marca cada estado', async ({ page }) => {
    await open(page, '/admin/inventario');
    const rows = page.getByRole('row');
    await expect(rows.nth(1)).toContainText('AR-10');
    await expect(rows.nth(1)).toContainText('Agotado');
    await expect(page.getByRole('cell', { name: 'Stock bajo' }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Con stock' }).first()).toBeVisible();
  });

  test('filtra por estado, categoría y búsqueda por SKU', async ({ page }) => {
    await open(page, '/admin/inventario');
    await page.getByLabel('Estado').selectOption('low');
    await page.getByRole('button', { name: 'Filtrar' }).click();
    await page.waitForURL('**estado=low**');
    await ready(page);
    await expect(page.getByRole('cell', { name: 'NP-PA-15' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'AR-10' })).toHaveCount(0);

    await open(page, '/admin/inventario?categoria=aves');
    await expect(page.getByRole('cell', { name: 'JA-M' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'NP-PA-3' })).toHaveCount(0);

    await open(page, '/admin/inventario?q=np-pa');
    await expect(page.getByText('2 presentaciones')).toBeVisible();

    await open(page, '/admin/inventario?q=no-existe-nada');
    await expect(page.getByText('No hay resultados con esos filtros.')).toBeVisible();
  });

  test('ordena por más stock y conserva los filtros en el formulario', async ({ page }) => {
    await open(page, '/admin/inventario?orden=stock_desc&estado=in');
    await expect(page.getByRole('row').nth(1)).toContainText('NP-PA-3');
    await expect(page.getByLabel('Ordenar por')).toHaveValue('stock_desc');
    await expect(page.getByLabel('Estado')).toHaveValue('in');
  });

  test('ignora parámetros inválidos', async ({ page }) => {
    const res = await open(page, '/admin/inventario?orden=hack&estado=x&pagina=abc&categoria=../');
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('table')).toBeVisible();
  });
});
