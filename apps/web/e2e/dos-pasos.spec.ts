import { expect, test } from '@playwright/test';
import { createUser, open, PASSWORD, ready, totp } from './helpers';

// Verificación en dos pasos del equipo: activarla, entrar con el código o con
// un código de recuperación, y desactivarla.

async function enterPassword(page: import('@playwright/test').Page, email: string, next = '/cuenta') {
  await page.goto(`/entrar?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Correo').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

test('el equipo activa 2FA, entra con el código y con un código de recuperación', async ({ page }) => {
  const email = await createUser(['ORDERS_OPERATOR']);
  await enterPassword(page, email);
  await page.waitForURL('**/cuenta');
  await ready(page);
  await page.getByRole('link', { name: 'Verificación en dos pasos: sin activar' }).click();
  await ready(page);
  await page.getByRole('button', { name: 'Configurar verificación en dos pasos' }).click();
  const secret = (await page.getByTestId('totp-secret').textContent())!.replace(/\s/g, '');
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  await expect(page.getByRole('link', { name: 'ábrela en la app' })).toHaveAttribute('href', /^otpauth:\/\/totp\//);

  // Un código equivocado no la activa.
  await page.getByLabel('Código de la app').fill(totp(secret, 5));
  await page.getByRole('button', { name: 'Activar' }).click();
  await expect(page.locator('form [role=alert]')).toHaveText('Código incorrecto');
  await page.getByLabel('Código de la app').fill(totp(secret));
  await page.getByRole('button', { name: 'Activar' }).click();
  const codes = page.getByRole('list', { name: 'Códigos de recuperación' }).getByRole('listitem');
  await expect(codes).toHaveCount(10);
  const [recovery, spare] = await codes.allTextContents();

  await open(page, '/cuenta');
  await expect(page.getByRole('link', { name: 'Verificación en dos pasos: activa' })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await page.waitForURL('/');

  // Con 2FA, la contraseña sola no basta.
  await enterPassword(page, email, '/admin/pagos');
  const step = page.getByRole('form', { name: 'Código de verificación' });
  await expect(step).toBeVisible();
  await step.getByLabel('Código').fill('000000');
  await step.getByRole('button', { name: 'Verificar' }).click();
  await expect(step.getByRole('alert')).toHaveText('Código incorrecto');
  await step.getByLabel('Código').fill(totp(secret, 1));
  await step.getByRole('button', { name: 'Verificar' }).click();
  await page.waitForURL('**/admin/pagos');
  await ready(page);
  await expect(page.getByRole('heading', { name: 'Pagos' })).toBeVisible();

  // Con un código de recuperación también, una sola vez.
  await open(page, '/cuenta');
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await page.waitForURL('/');
  await enterPassword(page, email);
  await page.getByRole('form', { name: 'Código de verificación' }).getByLabel('Código').fill(recovery.toLowerCase());
  await page.getByRole('button', { name: 'Verificar' }).click();
  await page.waitForURL('**/cuenta');

  // Desactivar pide contraseña y código; el de recuperación usado ya no sirve.
  await open(page, '/cuenta/seguridad');
  const disable = page.getByRole('form', { name: 'Desactivar verificación en dos pasos' });
  await disable.getByLabel('Contraseña').fill(PASSWORD);
  await disable.getByLabel('Código de la app o de recuperación').fill(recovery);
  await disable.getByRole('button', { name: 'Desactivar' }).click();
  await expect(disable.getByRole('alert')).toHaveText('Código incorrecto');
  await disable.getByLabel('Contraseña').fill(PASSWORD);
  await disable.getByLabel('Código de la app o de recuperación').fill(spare);
  await disable.getByRole('button', { name: 'Desactivar' }).click();
  await expect(page.getByRole('button', { name: 'Configurar verificación en dos pasos' })).toBeVisible();
});

test('un cliente no tiene la opción', async ({ page }) => {
  const email = await createUser();
  await enterPassword(page, email);
  await page.waitForURL('**/cuenta');
  await ready(page);
  await expect(page.getByRole('link', { name: /Verificación en dos pasos/ })).toHaveCount(0);
  await open(page, '/cuenta/seguridad');
  await expect(page.getByText('Por ahora está disponible para las cuentas del equipo.')).toBeVisible();
});
