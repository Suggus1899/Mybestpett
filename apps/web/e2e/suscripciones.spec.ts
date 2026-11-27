import { expect, test } from '@playwright/test';
import { createProduct, createUser, login, open, retireTestProducts, settleTestPayments } from './helpers';

// Suscripción: el cliente pide recibir un producto cada cierto tiempo.

test.afterAll(async () => {
  await settleTestPayments();
  await retireTestProducts();
});

test('el cliente se suscribe, cambia, pausa, reanuda y cancela', async ({ page }) => {
  const product = await createProduct(2000, 10, true);
  const email = await createUser();
  await login(page, email);

  await open(page, '/cuenta/suscripciones');
  await expect(page.getByText('Todavía no tienes suscripciones.')).toBeVisible();

  await open(page, `/productos/${product.slug}`);
  await page.getByRole('link', { name: `Recibir ${product.name} Unidad cada cierto tiempo` }).click();
  await expect(page.getByRole('heading', { level: 1, name: `Recibir ${product.name} Unidad` })).toBeVisible();

  // Sin dirección guardada, primero se pide.
  await page.getByLabel('Quién recibe', { exact: true }).fill('Ana Pérez');
  await page.getByLabel('Teléfono de contacto', { exact: true }).fill('0412-1234567');
  await page.getByLabel('Ciudad', { exact: true }).fill('Caracas');
  await page.getByLabel('Dirección', { exact: true }).fill('Av. Urdaneta');
  await page.getByLabel('Estado').selectOption('Distrito Capital');
  await page.getByRole('button', { name: 'Guardar dirección' }).click();

  const form = page.getByRole('form', { name: `Suscribirme a ${product.name} Unidad` });
  await expect(form).toBeVisible();
  // El navegador no deja enviar más de 10 unidades.
  const quantity = form.getByLabel('Unidades por entrega');
  await quantity.fill('11');
  expect(await quantity.evaluate((el: HTMLInputElement) => el.validity.rangeOverflow)).toBe(true);
  await quantity.fill('2');
  await form.getByLabel('Frecuencia').selectOption('30');
  await form.getByRole('radio', { name: 'Zelle' }).check();
  await form.getByRole('button', { name: 'Confirmar suscripción' }).click();
  await page.waitForURL('**/cuenta/suscripciones');

  const card = page.getByRole('listitem', { name: `Suscripción de ${product.name}` });
  await expect(card).toBeVisible();
  await expect(card.getByText('Activa')).toBeVisible();
  await expect(card.getByText('2 unidades cada 30 días')).toBeVisible();
  await expect(card.getByRole('link', { name: /^Pedido PB-/ })).toHaveCount(1);

  // Cambiar cantidad.
  await card.getByLabel('Unidades', { exact: true }).fill('3');
  await card.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(card.getByText('Cambios guardados')).toBeVisible();
  await expect(card.getByText('3 unidades cada 30 días')).toBeVisible();

  // Pausar y reanudar.
  await card.getByRole('button', { name: `Pausar suscripción de ${product.name}` }).click();
  await expect(card.getByText('Suscripción pausada')).toBeVisible();
  await expect(card.getByText('En pausa')).toBeVisible();
  await card.getByRole('button', { name: `Reanudar suscripción de ${product.name}` }).click();
  await expect(card.getByText('Activa')).toBeVisible();

  // Cancelar.
  await card.getByRole('button', { name: `Cancelar suscripción de ${product.name}` }).click();
  // Las canceladas salen de la lista.
  await expect(card).toHaveCount(0);
  await expect(page.getByText('Todavía no tienes suscripciones.')).toBeVisible();
});

test('un producto que no es de suscripción no ofrece la opción ni abre el formulario', async ({ page }) => {
  const product = await createProduct(1500);
  const email = await createUser();
  await login(page, email);
  await open(page, `/productos/${product.slug}`);
  await expect(page.getByRole('link', { name: /cada cierto tiempo/ })).toHaveCount(0);
  await open(page, `/cuenta/suscripciones/nueva?producto=${product.slug}&presentacion=00000000-0000-0000-0000-000000000000`);
  await expect(page.getByRole('heading', { name: 'No encontramos esta página' })).toBeVisible();
});

test('sin sesión, la suscripción pide entrar', async ({ page }) => {
  await page.goto('/cuenta/suscripciones');
  await page.waitForURL(/\/entrar\?next=/);
});
