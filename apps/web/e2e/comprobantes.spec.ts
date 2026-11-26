import { expect, test, type Page } from '@playwright/test';
import { createProduct, createUser, login, open, ready, retireTestProducts, settleTestPayments } from './helpers';

// Comprobantes de pago: el cliente los adjunta al reportar o después, y solo
// él y el equipo de pagos los pueden abrir.

test.afterAll(async () => {
  await settleTestPayments();
  await retireTestProducts();
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n');

async function buyWithZelle(page: Page) {
  const product = await createProduct(1100);
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
  await page.getByRole('radio', { name: 'Zelle' }).check();
  await page.getByLabel(/Acepto los términos/).check();
  await page.getByRole('button', { name: 'Confirmar pedido' }).click();
  await page.waitForURL(/\/pedidos\/[0-9a-f-]{36}$/);
  await ready(page);
  return (await page.getByRole('heading', { level: 1 }).textContent())!.replace('Pedido ', '').trim();
}

async function fillReport(page: Page, reference: string) {
  await page.getByLabel('Número de referencia').fill(reference);
  const now = new Date(Date.now() - 4 * 60 * 60 * 1000 - 60_000).toISOString().slice(0, 16);
  await page.getByLabel('Fecha y hora del pago').fill(now);
}

test('reporta con comprobante; el cliente y el equipo lo abren, nadie más', async ({ page, browser }) => {
  await login(page, await createUser());
  const code = await buyWithZelle(page);
  const reference = `PRF-${Date.now()}`;
  await fillReport(page, reference);
  await page.getByLabel('Comprobante (opcional)').setInputFiles({ name: 'pago.png', mimeType: 'image/png', buffer: PNG });
  await page.getByRole('button', { name: 'Reportar pago' }).click();
  await expect(page.getByText('Estamos verificando tu pago con el banco.')).toBeVisible();

  const payments = page.getByRole('region', { name: 'Pagos reportados' });
  const link = payments.getByRole('link', { name: 'Ver comprobante' });
  const href = (await link.getAttribute('href'))!;
  const mine = await page.request.get(href);
  expect(mine.status()).toBe(200);
  expect(mine.headers()['content-type']).toBe('image/png');
  expect(mine.headers()['cache-control']).toBe('private, no-store');
  expect(Buffer.compare(await mine.body(), PNG)).toBe(0);

  const other = await browser.newPage();
  await login(other, await createUser());
  expect((await other.request.get(href)).status()).toBe(404);

  const staff = await browser.newPage();
  await login(staff, await createUser(['ORDERS_OPERATOR']), '/admin/pagos');
  await ready(staff);
  const card = staff.getByRole('listitem').filter({ hasText: `Pedido ${code}` });
  const staffHref = (await card.getByRole('link', { name: 'Ver comprobante' }).getAttribute('href'))!;
  const res = await staff.request.get(staffHref);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('image/png');
  // Un cliente no abre la ruta del equipo.
  expect((await other.request.get(staffHref)).status()).toBe(403);
  await other.close();
  await staff.close();
});

test('rechaza un archivo que no es imagen ni PDF y conserva lo escrito', async ({ page }) => {
  await login(page, await createUser());
  await buyWithZelle(page);
  await fillReport(page, 'TXT-12345');
  await page.getByLabel('Comprobante (opcional)').setInputFiles({ name: 'nota.txt', mimeType: 'text/plain', buffer: Buffer.from('hola') });
  await page.getByRole('button', { name: 'Reportar pago' }).click();
  await expect(page.locator('form [role=alert]')).toHaveText('El comprobante debe ser una imagen JPG, PNG o WebP, o un PDF.');
  await expect(page.getByLabel('Número de referencia')).toHaveValue('TXT-12345');
  // El pago no se reportó.
  await expect(page.getByText('Estamos verificando tu pago con el banco.')).toHaveCount(0);
});

test('sin comprobante al reportar, se adjunta después; un archivo disfrazado no pasa', async ({ page }) => {
  await login(page, await createUser());
  await buyWithZelle(page);
  await fillReport(page, `LATE-${Date.now()}`);
  await page.getByRole('button', { name: 'Reportar pago' }).click();
  await expect(page.getByText('Estamos verificando tu pago con el banco.')).toBeVisible();

  const payments = page.getByRole('region', { name: 'Pagos reportados' });
  await expect(payments.getByText('Sin comprobante')).toBeVisible();
  const form = payments.getByRole('form', { name: 'Adjuntar comprobante' });
  // Un HTML con nombre y tipo de imagen: la API mira el contenido y lo rechaza.
  await form
    .getByLabel('Comprobante')
    .setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from('<html><script>alert(1)</script>') });
  await form.getByRole('button', { name: 'Adjuntar comprobante' }).click();
  await expect(form.getByRole('alert')).toHaveText('El comprobante debe ser una imagen JPG, PNG o WebP, o un PDF');

  await form.getByLabel('Comprobante').setInputFiles({ name: 'recibo.pdf', mimeType: 'application/pdf', buffer: PDF });
  await form.getByRole('button', { name: 'Adjuntar comprobante' }).click();
  await expect(payments.getByRole('link', { name: 'Ver comprobante' })).toBeVisible();
  const res = await page.request.get((await payments.getByRole('link', { name: 'Ver comprobante' }).getAttribute('href'))!);
  expect(res.headers()['content-type']).toBe('application/pdf');
  expect(res.headers()['content-disposition']).toMatch(/^attachment;/);
});

test('sin sesión, el enlace del comprobante lleva a entrar', async ({ page }) => {
  const res = await page.request.get('/admin/pagos/00000000-0000-4000-8000-000000000000/comprobante', { maxRedirects: 0 });
  expect(res.status()).toBe(303);
  expect(res.headers()['location']).toContain('/entrar?next=%2Fadmin%2Fpagos');
  expect((await page.request.get('/admin/pagos/no-es-uuid/comprobante')).status()).toBe(404);
});
