import { expect, test } from '@playwright/test';
import { checkout, createUser, deliveredOrder, login, open, ready, retireTestProducts } from './helpers';

// Devolución completa: el cliente la pide, el operador la aprueba y el
// administrador registra el reembolso.

test.afterAll(retireTestProducts);

test('el cliente pide la devolución, el operador la aprueba y el administrador reembolsa', async ({ page, browser }) => {
  await login(page, await createUser());
  const { url, code, product } = await deliveredOrder(page);

  const form = page.getByRole('form', { name: 'Pedir devolución' });
  await expect(page.getByText(/Puedes pedir una devolución hasta el/)).toBeVisible();
  // Sin elegir productos no se envía, y el motivo escrito se conserva.
  await form.getByLabel('Motivo').fill('Llegó con una costura abierta');
  await form.getByRole('button', { name: 'Pedir devolución' }).click();
  await expect(form.getByRole('alert')).toHaveText('Elige al menos un producto para devolver.');
  await expect(form.getByLabel('Motivo')).toHaveValue('Llegó con una costura abierta');
  // No deja pedir más de lo comprado.
  await form.getByLabel(product.name).fill('2');
  const tooMany = await form.getByLabel(product.name).evaluate((el: HTMLInputElement) => el.validity.rangeOverflow);
  expect(tooMany).toBe(true);
  await form.getByLabel(product.name).fill('1');
  await form.getByRole('button', { name: 'Pedir devolución' }).click();
  // La página se actualiza: el formulario se va y aparece la devolución.
  await expect(page.getByRole('form', { name: 'Pedir devolución' })).toHaveCount(0);
  await open(page, url);
  const returns = page.getByRole('region', { name: 'Devoluciones' });
  await expect(returns.getByText(/En revisión · \$15[.,]00/)).toBeVisible();
  // Con una devolución abierta no se ofrece otra.
  await expect(page.getByRole('form', { name: 'Pedir devolución' })).toHaveCount(0);

  const operator = await browser.newPage();
  await login(operator, await createUser(['ORDERS_OPERATOR']), '/admin/devoluciones');
  await ready(operator);
  const card = operator.getByRole('listitem', { name: `Devolución del pedido ${code}` });
  await expect(card.getByText('Motivo: Llegó con una costura abierta')).toBeVisible();
  await card.getByLabel('Indicaciones para el cliente (opcional)').fill('Tráelo a la tienda el lunes');
  await card.getByRole('button', { name: `Aprobar devolución ${code}` }).click();
  await expect(card).toHaveCount(0); // sale de la cola por revisar
  // El operador no reembolsa.
  await open(operator, '/admin/devoluciones?estado=APPROVED');
  const approved = operator.getByRole('listitem', { name: `Devolución del pedido ${code}` });
  await expect(approved.getByText('Esperando el reembolso del administrador.')).toBeVisible();
  await expect(approved.getByRole('button', { name: 'Registrar reembolso' })).toHaveCount(0);
  await operator.close();

  const admin = await browser.newPage();
  await login(admin, await createUser(['ADMIN']), '/admin/devoluciones?estado=APPROVED');
  await ready(admin);
  const toRefund = admin.getByRole('listitem', { name: `Devolución del pedido ${code}` });
  await toRefund.getByLabel('Referencia del reembolso').fill('ZL-REEMB-1');
  await toRefund.getByRole('button', { name: 'Registrar reembolso' }).click();
  // Falta decidir si vuelve al inventario: lo exige el navegador.
  const missing = await toRefund
    .getByRole('radio', { name: 'Sí, llegó en buen estado' })
    .evaluate((el: HTMLInputElement) => el.validity.valueMissing);
  expect(missing).toBe(true);
  await toRefund.getByRole('radio', { name: 'Sí, llegó en buen estado' }).check();
  await toRefund.getByRole('button', { name: 'Registrar reembolso' }).click();
  await expect(toRefund).toHaveCount(0);
  await open(admin, '/admin/devoluciones?estado=REFUNDED');
  await expect(
    admin.getByRole('listitem', { name: `Devolución del pedido ${code}` }).getByText(/Ref\. ZL-REEMB-1 · volvió al inventario/),
  ).toBeVisible();
  await admin.close();

  await open(page, url);
  await expect(page.getByText('Reembolsado').first()).toBeVisible();
  await expect(returns.getByText(/Reembolsada · \$15[.,]00/)).toBeVisible();
  await expect(returns.getByText('Tráelo a la tienda el lunes')).toBeVisible();
  await expect(returns.getByText(/Ref\. ZL-REEMB-1/)).toBeVisible();
});

test('un pedido sin entregar no ofrece devolución y el cliente no entra al panel', async ({ page }) => {
  await login(page, await createUser());
  await checkout(page, 900);
  await expect(page.getByRole('form', { name: 'Pedir devolución' })).toHaveCount(0);
  await open(page, '/admin/devoluciones');
  await expect(page.getByRole('heading', { name: 'No tienes acceso a esta sección' })).toBeVisible();
});
