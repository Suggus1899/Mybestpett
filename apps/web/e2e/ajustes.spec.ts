import { expect, test } from '@playwright/test';
import { createUser, login, open, ready } from './helpers';

// Ajustes de la tienda: métodos de pago y zonas de envío (solo ADMIN).

test.describe('ajustes de la tienda', () => {
  test('solo el administrador entra', async ({ page }) => {
    await login(page, await createUser(['ORDERS_OPERATOR', 'CATALOG_MANAGER']));
    await open(page, '/admin/ajustes');
    await expect(page.getByRole('heading', { name: 'No tienes acceso a esta sección' })).toBeVisible();
  });

  test('edita los datos para pagar de un método', async ({ page }) => {
    await login(page, await createUser(['ADMIN']), '/admin/ajustes');
    await ready(page);
    const form = page.getByRole('form', { name: 'Método Efectivo en dólares' });
    const text = `Pago contra entrega en la tienda ${Date.now()}`;
    await form.getByLabel('Datos para pagar').fill(text);
    await form.getByRole('button', { name: /^Guardar/ }).click();
    await expect(form.getByText('Método guardado')).toBeVisible();
    await open(page, '/admin/ajustes');
    await expect(page.getByRole('form', { name: 'Método Efectivo en dólares' }).getByLabel('Datos para pagar')).toHaveValue(text);

    // La API rechaza dejar los datos vacíos aunque se salte el navegador.
    await form.getByLabel('Datos para pagar').evaluate((el: HTMLTextAreaElement) => {
      el.removeAttribute('required');
      el.value = '   ';
    });
    await form.getByRole('button', { name: /^Guardar/ }).click();
    await expect(form.getByRole('alert')).toBeVisible();
  });

  test('crea una zona y valida montos y estados', async ({ page }) => {
    await login(page, await createUser(['ADMIN']), '/admin/ajustes');
    await ready(page);
    await page.getByText('Añadir zona').click();
    const form = page.getByRole('form', { name: 'Nueva zona' });
    const name = `Zona E2E ${Date.now()}`;
    await form.getByLabel('Nombre').fill(name);
    await form.getByLabel('Agencia o reparto').fill('MRW');
    await form.getByLabel('Tarifa ($)').fill('4,50');
    // Inactiva para no aparecer en el checkout de otras pruebas.
    await form.getByLabel('Activo').uncheck();

    await form.getByRole('button', { name: 'Crear zona' }).click();
    await expect(form.getByRole('alert')).toHaveText(/Elige al menos un estado/);

    await form.getByLabel('Amazonas').check();
    await form.getByLabel('Tarifa ($)').evaluate((el: HTMLInputElement) => {
      el.removeAttribute('pattern');
      el.value = '4.555';
    });
    await form.getByRole('button', { name: 'Crear zona' }).click();
    await expect(form.getByRole('alert')).toHaveText(/hasta 2 decimales/);

    await form.getByLabel('Tarifa ($)').fill('4,50');
    await form.getByRole('button', { name: 'Crear zona' }).click();
    await open(page, '/admin/ajustes');
    const saved = page.getByRole('form', { name: `Zona ${name}` });
    await expect(saved.getByLabel('Tarifa ($)')).toHaveValue('4,50');
    await expect(saved.getByLabel('Amazonas')).toBeChecked();
    await expect(saved.getByLabel('Activo')).not.toBeChecked();
  });

  test('la zona inactiva no aparece en las zonas públicas', async ({ request }) => {
    const zones: { name: string }[] = await (await request.get('http://localhost:3001/v1/shipping-zones')).json();
    expect(zones.some((z) => z.name.startsWith('Zona E2E'))).toBe(false);
  });
});
