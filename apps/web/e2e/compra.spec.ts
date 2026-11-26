import { expect, test, type Page } from '@playwright/test';
import { createProduct, createUser, login, open, ready, retireTestProducts } from './helpers';

// Flujo de compra en el navegador: carrito, checkout, pago reportado,
// verificación del equipo y despacho. Cada prueba usa su propio producto.

test.afterAll(retireTestProducts);

const address = {
  'Quién recibe': 'Ana Pérez',
  'Teléfono de contacto': '0412-1234567',
  Ciudad: 'Caracas',
  Dirección: 'Av. Urdaneta, edificio Sol',
};

async function addToCart(page: Page, product: { name: string; slug: string }, quantity = 1) {
  await open(page, `/productos/${product.slug}`);
  const qty = page.getByLabel(`Cantidad de ${product.name} Unidad`);
  await qty.fill(String(quantity));
  await page.getByRole('button', { name: `Añadir ${product.name} Unidad al carrito` }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Añadido al carrito' })).toBeVisible();
}

async function saveAddress(page: Page, state = 'Distrito Capital') {
  for (const [label, value] of Object.entries(address)) {
    await page.getByLabel(label, { exact: true }).fill(value);
  }
  await page.getByLabel('Estado').selectOption(state);
  await page.getByRole('button', { name: 'Guardar dirección' }).click();
  await expect(page.getByRole('group', { name: 'Dirección de envío' })).toBeVisible();
}

// Compra completa hasta la pantalla de pago. Devuelve la URL del pedido.
async function buy(page: Page, method: string, priceUsdCents = 1200, quantity = 1) {
  const product = await createProduct(priceUsdCents);
  await addToCart(page, product, quantity);
  await open(page, '/checkout');
  if (await page.getByRole('button', { name: 'Guardar dirección' }).isVisible()) await saveAddress(page);
  await page.getByRole('radio', { name: method }).check();
  await page.getByLabel(/Acepto los términos/).check();
  await page.getByRole('button', { name: 'Confirmar pedido' }).click();
  await page.waitForURL(/\/pedidos\/[0-9a-f-]{36}$/);
  await ready(page);
  return page.url();
}

async function reportPayment(page: Page, reference: string) {
  await page.getByLabel('Número de referencia').fill(reference);
  await page.getByLabel('Banco de origen (opcional)').fill('Banesco');
  // Hora local de Venezuela, un minuto atrás.
  const now = new Date(Date.now() - 4 * 60 * 60 * 1000 - 60_000).toISOString().slice(0, 16);
  await page.getByLabel('Fecha y hora del pago').fill(now);
  await page.getByRole('button', { name: 'Reportar pago' }).click();
  // El pedido pasa a revisión y la pantalla cambia.
  await expect(page.getByText('Estamos verificando tu pago con el banco.')).toBeVisible();
}

const orderCode = async (page: Page) =>
  (await page.getByRole('heading', { level: 1 }).textContent())!.replace('Pedido ', '').trim();

test.describe('carrito', () => {
  test('sin sesión, añadir lleva a entrar y luego vuelve al producto', async ({ page }) => {
    const product = await createProduct(900);
    await open(page, `/productos/${product.slug}`);
    await page.getByRole('button', { name: `Añadir ${product.name} Unidad al carrito` }).click();
    await page.waitForURL(`**/entrar?next=${encodeURIComponent(`/productos/${product.slug}`)}`);
  });

  test('un producto agotado no se puede añadir', async ({ page }) => {
    await login(page, await createUser());
    await open(page, '/productos/arena-aglomerante-gatos');
    await expect(page.getByText('Agotado').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^Añadir/ })).toHaveCount(0);
  });

  test('añade, muestra el contador, cambia la cantidad y quita', async ({ page }) => {
    await login(page, await createUser());
    const product = await createProduct(900);
    await addToCart(page, product, 2);
    await expect(page.getByRole('banner').getByRole('link', { name: /Carrito/ })).toContainText('(2)');

    await open(page, '/carrito');
    await expect(page.getByText('$18,00').first()).toBeVisible();
    await expect(page.getByText(/Te faltan \$7,00 para el envío gratis/)).toBeVisible();
    await page.getByLabel(`Cantidad de ${product.name} Unidad`).fill('3');
    await page.getByRole('button', { name: 'Actualizar' }).click();
    await expect(page.getByText('Tu envío es gratis.')).toBeVisible();

    await page.getByRole('button', { name: `Quitar ${product.name} Unidad` }).click();
    await expect(page.getByText('Tu carrito está vacío.')).toBeVisible();
  });

  test('no deja pedir más de lo que hay', async ({ page }) => {
    await login(page, await createUser());
    const product = await createProduct(900, 2);
    await open(page, `/productos/${product.slug}`);
    await page.getByLabel(`Cantidad de ${product.name} Unidad`).fill('3');
    await page.getByRole('button', { name: `Añadir ${product.name} Unidad al carrito` }).click();
    await expect(page.locator('form [role=alert]')).toHaveText('Solo hay 2 disponibles de esta presentación');
  });

  test('el carrito y el checkout exigen sesión', async ({ page }) => {
    await page.goto('/carrito');
    await page.waitForURL(/\/entrar\?next=(%2F|\/)carrito$/);
    await page.goto('/checkout');
    await page.waitForURL(/\/entrar\?next=(%2F|\/)checkout$/);
  });
});

test.describe('checkout', () => {
  test('pide una dirección la primera vez y solo ofrece las zonas que llegan', async ({ page }) => {
    await login(page, await createUser());
    await addToCart(page, await createProduct(1000));
    await open(page, '/checkout');
    await expect(page.getByRole('heading', { name: '¿A dónde te lo enviamos?' })).toBeVisible();

    // Validación de la API: el teléfono no es válido.
    for (const [label, value] of Object.entries({ ...address, 'Teléfono de contacto': '0412-ABC' })) {
      await page.getByLabel(label, { exact: true }).fill(value);
    }
    await page.getByLabel('Estado').selectOption('Zulia');
    await page.getByRole('button', { name: 'Guardar dirección' }).click();
    await expect(page.locator('form [role=alert]')).toHaveText('Teléfono inválido');
    await expect(page.getByLabel('Ciudad')).toHaveValue('Caracas'); // conserva lo escrito

    await page.getByLabel('Teléfono de contacto').fill('0412-1234567');
    await page.getByRole('button', { name: 'Guardar dirección' }).click();
    const shipping = page.getByRole('group', { name: 'Envío', exact: true });
    await expect(shipping.getByRole('radio')).toHaveCount(1);
    await expect(shipping.getByText('Encomienda nacional')).toBeVisible();
    await expect(shipping.getByText('Delivery en Caracas')).toHaveCount(0);
  });

  test('muestra el monto en bolívares y el envío gratis desde 25 $', async ({ page }) => {
    await login(page, await createUser());
    await addToCart(page, await createProduct(3000));
    await open(page, '/checkout');
    await saveAddress(page);
    await expect(page.getByRole('group', { name: 'Envío', exact: true }).getByText('Gratis').first()).toBeVisible();
    await page.getByRole('radio', { name: 'Pago Móvil' }).check();
    // 30 $ × 245,50 = 7.365,00 Bs (tasa del seed de ejemplo)
    await expect(page.getByTestId('checkout-charge')).toHaveText('Bs. 7.365,00');
  });

  test('sin aceptar los términos no se crea el pedido', async ({ page }) => {
    await login(page, await createUser());
    await addToCart(page, await createProduct(1000));
    await open(page, '/checkout');
    await saveAddress(page);
    await page.getByRole('button', { name: 'Confirmar pedido' }).click();
    await expect(page).toHaveURL(/\/checkout$/);
    const valid = await page.getByLabel(/Acepto los términos/).evaluate((el: HTMLInputElement) => el.validity.valid);
    expect(valid).toBe(false);
  });
});

test.describe('pedido y pago', () => {
  test('crea el pedido en bolívares con la tasa congelada y 2 horas para pagar', async ({ page }) => {
    await login(page, await createUser());
    await buy(page, 'Pago Móvil', 1000); // 10 $ + 3 $ de envío = 13 $ × 245,50
    await expect(page.getByRole('heading', { name: 'Paga Bs. 3.191,50 con Pago Móvil' })).toBeVisible();
    await expect(page.getByText('Datos de pago por configurar en el panel.')).toBeVisible();
    await expect(page.getByText(/Tienes hasta el .* para reportar el pago/)).toBeVisible();
    await expect(page.getByText(/Tasa BCV congelada en el pedido: Bs\. 245\.5/)).toBeVisible();
    await expect(page.getByText('Esperando el pago').first()).toBeVisible();
    // El carrito quedó vacío.
    await expect(page.getByRole('banner').getByRole('link', { name: 'Carrito' })).toHaveText('Carrito');
  });

  test('el reporte valida los datos y luego queda en revisión', async ({ page }) => {
    await login(page, await createUser());
    await buy(page, 'Zelle');
    await page.getByLabel('Número de referencia').fill('12');
    await page.getByLabel('Fecha y hora del pago').fill('2020-01-01T10:00');
    await page.getByRole('button', { name: 'Reportar pago' }).click();
    const valid = await page.getByLabel('Número de referencia').evaluate((el: HTMLInputElement) => el.validity.valid);
    expect(valid).toBe(false); // minLength del navegador

    await page.getByLabel('Número de referencia').fill('ZELLE-OLD-1');
    await page.getByRole('button', { name: 'Reportar pago' }).click();
    await expect(page.locator('form [role=alert]')).toHaveText('La fecha del pago es anterior al pedido');

    await reportPayment(page, `ZL-${Date.now()}`);
    await open(page, page.url());
    await expect(page.getByText('Pago en revisión').first()).toBeVisible();
    await expect(page.getByRole('region', { name: 'Pagos reportados' }).getByText('En revisión')).toBeVisible();
  });

  test('el cliente cancela un pedido sin pagar', async ({ page }) => {
    await login(page, await createUser());
    await buy(page, 'Zelle');
    await page.getByRole('button', { name: 'Cancelar pedido' }).click();
    await expect(page.getByText('Cancelado').first()).toBeVisible();
    await open(page, '/pedidos');
    await expect(page.getByText('Cancelado').first()).toBeVisible();
  });

  test('un pedido ajeno no se puede ver', async ({ page, browser }) => {
    await login(page, await createUser());
    const url = await buy(page, 'Zelle');
    const other = await browser.newPage();
    await login(other, await createUser());
    await other.goto(url);
    await expect(other.getByRole('heading', { name: 'No encontramos esta página' })).toBeVisible();
    await other.close();
  });
});

test.describe('panel de pagos y pedidos', () => {
  test('el operador verifica el pago y despacha el pedido hasta entregarlo', async ({ page, browser }) => {
    await login(page, await createUser());
    const url = await buy(page, 'Zelle');
    const code = await orderCode(page);
    const reference = `OK-${Date.now()}`;
    await reportPayment(page, reference);

    const staff = await browser.newPage();
    await login(staff, await createUser(['ORDERS_OPERATOR']), '/admin/pagos');
    await ready(staff);
    const card = staff.getByRole('listitem').filter({ hasText: `Pedido ${code}` });
    await expect(card.getByText(reference)).toBeVisible();
    await card.getByRole('button', { name: `Verificar pago ${reference}` }).click();
    await expect(card).toHaveCount(0); // sale de la cola de pendientes

    await open(staff, '/admin/pedidos?estado=PAID');
    await staff.getByRole('link', { name: code }).click();
    await ready(staff);
    await staff.getByRole('button', { name: 'Pasar a preparación' }).click();
    await expect(staff.getByRole('button', { name: 'Marcar como enviado' })).toBeVisible();
    await staff.getByLabel('Número de guía').fill('MRW-12345');
    await staff.getByRole('button', { name: 'Marcar como enviado' }).click();
    await expect(staff.getByRole('button', { name: 'Marcar como entregado' })).toBeVisible();
    await staff.getByRole('button', { name: 'Marcar como entregado' }).click();
    await expect(staff.getByText('Entregado').first()).toBeVisible();
    await staff.close();

    await open(page, url);
    await expect(page.getByText('Entregado').first()).toBeVisible();
    await expect(page.getByText(/Guía MRW-12345/)).toBeVisible();
  });

  test('rechazar exige motivo y el cliente puede reportar de nuevo', async ({ page, browser }) => {
    await login(page, await createUser());
    const url = await buy(page, 'Zelle');
    const code = await orderCode(page);
    await reportPayment(page, `BAD-${Date.now()}`);

    const staff = await browser.newPage();
    await login(staff, await createUser(['ORDERS_OPERATOR']), '/admin/pagos');
    await ready(staff);
    const card = staff.getByRole('listitem').filter({ hasText: `Pedido ${code}` });
    await card.getByLabel('Motivo del rechazo').fill('no');
    await card.getByRole('button', { name: 'Rechazar' }).click();
    const tooShort = await card.getByLabel('Motivo del rechazo').evaluate((el: HTMLInputElement) => el.validity.tooShort);
    expect(tooShort).toBe(true);
    await card.getByLabel('Motivo del rechazo').fill('No vemos el pago en Zelle');
    await card.getByRole('button', { name: 'Rechazar' }).click();
    await expect(card).toHaveCount(0);
    await staff.close();

    await open(page, url);
    await expect(
      page.getByRole('region', { name: 'Pagos reportados' }).getByText('Rechazado: No vemos el pago en Zelle'),
    ).toBeVisible();
    await reportPayment(page, `GOOD-${Date.now()}`);
  });

  test('el equipo cancela un pedido sin pago verificado', async ({ page, browser }) => {
    await login(page, await createUser());
    const url = await buy(page, 'Zelle');
    const staff = await browser.newPage();
    await login(staff, await createUser(['ORDERS_OPERATOR']), url.replace(/.*\/pedidos\//, '/admin/pedidos/'));
    await ready(staff);
    await staff.getByLabel('Motivo de la cancelación').fill('El cliente pidió cancelar');
    await staff.getByRole('button', { name: 'Cancelar pedido y devolver stock' }).click();
    await expect(staff.getByText('Cancelado').first()).toBeVisible();
    await expect(staff.getByText('El cliente pidió cancelar')).toBeVisible(); // nota en el historial
    await staff.close();
  });

  test('busca pedidos por código', async ({ page, browser }) => {
    await login(page, await createUser());
    await buy(page, 'Zelle');
    const code = await orderCode(page);
    const staff = await browser.newPage();
    await login(staff, await createUser(['ORDERS_OPERATOR']), '/admin/pedidos');
    await ready(staff);
    await staff.getByLabel('Código o correo').fill(code.toLowerCase());
    await staff.getByRole('button', { name: 'Filtrar' }).click();
    await staff.waitForURL('**q=**');
    await ready(staff);
    await expect(staff.getByText('1 pedido', { exact: true })).toBeVisible();
    await expect(staff.getByRole('link', { name: code })).toBeVisible();
    await staff.close();
  });

  test('clientes y catálogo no entran a pagos ni pedidos', async ({ page }) => {
    await login(page, await createUser(['CATALOG_MANAGER']));
    for (const path of ['/admin/pagos', '/admin/pedidos']) {
      await open(page, path);
      await expect(page.getByRole('heading', { name: 'No tienes acceso a esta sección' })).toBeVisible();
    }
  });

  test('parámetros inválidos no rompen el panel', async ({ page }) => {
    await login(page, await createUser(['ORDERS_OPERATOR']));
    const res = await open(page, '/admin/pedidos?estado=HACK&pagina=-1&q=');
    expect(res?.status()).toBe(200);
    await open(page, '/admin/pagos?estado=X');
    await expect(page.getByRole('heading', { name: 'Pagos', exact: true })).toBeVisible();
    await page.goto('/admin/pedidos/no-es-un-id');
    await expect(page.getByRole('heading', { name: 'No encontramos esta página' })).toBeVisible();
  });
});

test.describe('móvil', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('carrito, checkout y pedido sin scroll horizontal', async ({ page }) => {
    await login(page, await createUser());
    const product = await createProduct(1000);
    await addToCart(page, product);
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    await open(page, '/carrito');
    expect(await overflow()).toBe(false);
    await open(page, '/checkout');
    expect(await overflow()).toBe(false);
    await saveAddress(page);
    expect(await overflow()).toBe(false);
    await page.getByRole('radio', { name: 'Zelle' }).check();
    await page.getByLabel(/Acepto los términos/).check();
    await page.getByRole('button', { name: 'Confirmar pedido' }).click();
    await page.waitForURL(/\/pedidos\/[0-9a-f-]{36}$/);
    await ready(page);
    expect(await overflow()).toBe(false);
  });
});
