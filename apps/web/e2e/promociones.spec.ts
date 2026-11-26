import { expect, test, type Page } from '@playwright/test';
import { createProduct, createUser, login, open, ready, retireTestProducts } from './helpers';

// Combos y cupones: el equipo los crea en el panel, el carrito descuenta el
// combo y el checkout aplica el cupón.

test.afterAll(retireTestProducts);

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();

async function createComboInPanel(page: Page, name: string, price: string, skus: string[]) {
  await open(page, '/admin/promociones?ver=combos');
  const form = page.getByRole('form', { name: 'Nuevo combo' });
  await form.getByLabel('Nombre').fill(name);
  await form.getByLabel('Precio del combo ($)').fill(price);
  await form.getByLabel('Descripción').fill('Combo creado en una prueba automática');
  for (const [i, sku] of skus.entries()) await form.getByLabel(`SKU ${i + 1}`, { exact: true }).fill(sku);
  await form.getByRole('button', { name: 'Crear combo' }).click();
  return form;
}

async function createCouponInPanel(page: Page, code: string, percent: string) {
  await open(page, '/admin/promociones');
  const form = page.getByRole('form', { name: 'Nuevo cupón' });
  await form.getByLabel('Código').fill(code.toLowerCase());
  await form.getByLabel('Descripción').fill('Descuento de prueba');
  await form.getByLabel('Porcentaje (%)').fill(percent);
  await form.getByRole('button', { name: 'Crear cupón' }).click();
  await expect(form.getByRole('status')).toHaveText(`Cupón ${code} creado`);
}

test('el equipo crea un combo y un cupón; el cliente los usa en su compra', async ({ page, browser }) => {
  const champu = await createProduct(1000);
  const toalla = await createProduct(800);
  const manager = await browser.newPage();
  await login(manager, await createUser(['CATALOG_MANAGER']), '/admin/promociones');
  await ready(manager);

  // Un combo que no ahorra no se crea, y lo escrito se conserva.
  const name = `Kit E2E ${uid()}`;
  const form = await createComboInPanel(manager, name, '18', [champu.sku, toalla.sku]);
  await expect(form.getByRole('alert')).toHaveText(/costar menos que sus productos por separado \(18\.00 \$\)/);
  await expect(form.getByLabel('Nombre')).toHaveValue(name);
  await form.getByLabel('Precio del combo ($)').fill('15');
  await form.getByRole('button', { name: 'Crear combo' }).click();
  await expect(manager.getByRole('status').filter({ hasText: `Combo ${name} creado` })).toBeVisible();
  const row = manager.getByRole('listitem', { name: `Combo ${name}` });
  await expect(row.getByText(/En la tienda · ahorra \$3[.,]00/)).toBeVisible();

  const code = `E2E${uid()}`;
  await createCouponInPanel(manager, code, '10');
  await expect(manager.getByRole('listitem', { name: `Cupón ${code}` }).getByText('Usado 0 veces')).toBeVisible();

  // El cliente añade el combo y ve el descuento en el carrito.
  await login(page, await createUser());
  await open(page, '/combos');
  const card = page.getByRole('article', { name });
  await expect(card.getByText(/Ahorras \$3[.,]00/)).toBeVisible();
  await card.getByRole('button', { name: `Añadir combo ${name} al carrito` }).click();
  await expect(card.getByRole('status')).toHaveText('Combo añadido al carrito');
  await open(page, '/carrito');
  await expect(page.getByText(`Combo ${name}`)).toBeVisible();
  await expect(page.getByText('Total de productos')).toBeVisible();

  // Checkout: un cupón que no existe muestra el motivo; el bueno descuenta.
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
  const coupon = page.getByRole('form', { name: 'Cupón de descuento' });
  await coupon.getByLabel('Cupón de descuento').fill('NO-EXISTE');
  await coupon.getByRole('button', { name: 'Aplicar' }).click();
  await ready(page);
  await expect(coupon.getByRole('alert')).toHaveText('Ese cupón no existe o ya no está activo');
  await coupon.getByLabel('Cupón de descuento').fill(code.toLowerCase());
  await coupon.getByRole('button', { name: 'Aplicar' }).click();
  await ready(page);
  // 18 $ − 3 $ del combo = 15 $; 10 % = 1,50 $.
  await expect(page.getByText(`Cupón ${code}`)).toBeVisible();
  await expect(page.getByText(/−\$1[.,]50/)).toBeVisible();
  await page.getByRole('radio', { name: 'Zelle' }).check();
  await page.getByLabel(/Acepto los términos/).check();
  await page.getByRole('button', { name: 'Confirmar pedido' }).click();
  await page.waitForURL(/\/pedidos\/[0-9a-f-]{36}$/);
  await ready(page);
  await expect(page.getByRole('heading', { level: 1, name: /^Pedido PB-/ })).toBeVisible();
  const totals = page.getByRole('term');
  await expect(totals.filter({ hasText: /^Combos$/ })).toHaveCount(1);
  await expect(totals.filter({ hasText: `Cupón ${code}` })).toHaveCount(1);
  // 13,50 $ de productos + 3 $ de envío (no llega a 25 $).
  await expect(page.getByTestId('order-charge')).toHaveText(/16[.,]50/);

  // El panel cuenta el uso y permite desactivarlo.
  await open(manager, '/admin/promociones');
  const used = manager.getByRole('listitem', { name: `Cupón ${code}` });
  await expect(used.getByText(/Usado 1 vez · descontado \$1[.,]50/)).toBeVisible();
  await used.getByRole('button', { name: `Desactivar cupón ${code}` }).click();
  await expect(used.getByText('Inactivo')).toBeVisible();
});

test('solo el equipo de catálogo entra a promociones', async ({ page }) => {
  await login(page, await createUser(['ORDERS_OPERATOR']), '/admin/promociones');
  await ready(page);
  await expect(page.getByRole('heading', { name: 'No tienes acceso a esta sección' })).toBeVisible();
});

test('sin sesión, añadir un combo pide entrar', async ({ page, browser }) => {
  const a = await createProduct(500);
  const b = await createProduct(500);
  const manager = await browser.newPage();
  await login(manager, await createUser(['CATALOG_MANAGER']), '/admin/promociones');
  const name = `Duo E2E ${uid()}`;
  await createComboInPanel(manager, name, '8', [a.sku, b.sku]);
  await expect(manager.getByRole('status').filter({ hasText: `Combo ${name} creado` })).toBeVisible();
  await open(page, '/combos');
  await page.getByRole('article', { name }).getByRole('button', { name: `Añadir combo ${name} al carrito` }).click();
  await page.waitForURL(/\/entrar\?next=%2Fcombos/);
});
