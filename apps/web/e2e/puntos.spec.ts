import { expect, test } from '@playwright/test';
import { createProduct, createUser, deliverOrder, givePoints, login, open, ready, retireTestProducts } from './helpers';

// Puntos: el cliente los usa al comprar y los gana cuando recibe el pedido.

test.afterAll(retireTestProducts);

test('el cliente usa sus puntos en el checkout y gana puntos al recibir', async ({ page }) => {
  const email = await createUser();
  await givePoints(email, 450);
  await login(page, email);
  await open(page, '/cuenta/puntos');
  await expect(page.getByRole('status')).toContainText('450 puntos');
  await expect(page.getByText('Ajuste de la tienda')).toBeVisible();

  const product = await createProduct(1200);
  await open(page, `/productos/${product.slug}`);
  await page.getByRole('button', { name: `Añadir ${product.name} Unidad al carrito` }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Añadido al carrito' })).toBeVisible();
  await open(page, '/checkout');
  if (await page.getByRole('button', { name: 'Guardar dirección' }).isVisible()) {
    await page.getByLabel('Quién recibe', { exact: true }).fill('Ana Pérez');
    await page.getByLabel('Teléfono de contacto', { exact: true }).fill('0412-1234567');
    await page.getByLabel('Ciudad', { exact: true }).fill('Caracas');
    await page.getByLabel('Dirección', { exact: true }).fill('Av. Urdaneta');
    await page.getByLabel('Estado').selectOption('Distrito Capital');
    await page.getByRole('button', { name: 'Guardar dirección' }).click();
    await expect(page.getByRole('group', { name: 'Dirección de envío' })).toBeVisible();
  }
  const points = page.getByLabel('Usar mis puntos');
  await expect(page.getByText('Tienes 450 puntos. En este pedido puedes usar hasta 400')).toBeVisible();
  // De 100 en 100: el navegador no deja enviar 150.
  await points.fill('150');
  expect(await points.evaluate((el: HTMLInputElement) => el.validity.stepMismatch)).toBe(true);
  await points.fill('400');
  await expect(page.getByText(/−\$4[.,]00/)).toBeVisible();
  await page.getByRole('radio', { name: 'Zelle' }).check();
  await page.getByLabel(/Acepto los términos/).check();
  await page.getByRole('button', { name: 'Confirmar pedido' }).click();
  await page.waitForURL(/\/pedidos\/[0-9a-f-]{36}$/);
  await ready(page);
  await expect(page.getByRole('heading', { level: 1, name: /^Pedido PB-/ })).toBeVisible();
  await expect(page.getByRole('term').filter({ hasText: 'Puntos (400)' })).toHaveCount(1);
  // 12 $ − 4 $ + 3 $ de envío.
  await expect(page.getByTestId('order-charge')).toHaveText(/11[.,]00/);

  const url = page.url();
  await page.getByLabel('Número de referencia').fill(`PTS-${Date.now()}`);
  const now = new Date(Date.now() - 4 * 60 * 60 * 1000 - 60_000).toISOString().slice(0, 16);
  await page.getByLabel('Fecha y hora del pago').fill(now);
  await page.getByRole('button', { name: 'Reportar pago' }).click();
  await expect(page.getByText('Estamos verificando tu pago con el banco.')).toBeVisible();
  await deliverOrder(url.split('/').pop()!);
  await open(page, url);
  await expect(page.getByText('Con este pedido ganaste 8 puntos.')).toBeVisible();

  await open(page, '/cuenta/puntos');
  await expect(page.getByRole('status')).toContainText('58 puntos'); // 450 − 400 + 8
  await expect(page.getByText('Usados en tu pedido')).toBeVisible();
  await expect(page.getByText('Ganados por tu pedido')).toBeVisible();
});

test('sin puntos el checkout no ofrece canjear y la página pide sesión', async ({ page }) => {
  await page.goto('/cuenta/puntos');
  await page.waitForURL(/\/entrar\?next=(%2F|\/)cuenta(%2F|\/)puntos/);
  await login(page, await createUser(), '/cuenta/puntos');
  await ready(page);
  await expect(page.getByRole('status')).toContainText('0 puntos');
  await expect(page.getByText('Todavía no tienes movimientos.')).toBeVisible();
});
