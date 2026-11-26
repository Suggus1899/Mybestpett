import { expect, test } from '@playwright/test';
import { createUser, login, open, PASSWORD, ready } from './helpers';

// Recorridos de un cliente. Usan los datos de SEED_DEMO=true.

test.describe('catálogo', () => {
  test('lista productos con precio en USD, en Bs, ofertas y agotados', async ({ page }) => {
    await open(page, '/productos');
    const main = page.getByRole('main');
    await expect(main.getByRole('link', { name: 'Croquetas perro adulto sabor pollo' })).toBeVisible();
    await expect(main.getByText('$14,50')).toBeVisible();
    await expect(main.getByText(/^Bs\. [\d.]+,\d{2}$/).first()).toBeVisible();
    await expect(main.getByText('Oferta').first()).toBeVisible();
    await expect(main.getByText('Agotado').first()).toBeVisible();
  });

  test('filtra por categoría, especie y ofertas', async ({ page }) => {
    await open(page, '/productos');
    await page.getByRole('navigation', { name: 'Categorías' }).getByRole('link', { name: 'Gatos' }).click();
    await page.waitForURL('**categoria=gatos');
    await ready(page);
    await expect(page.getByRole('link', { name: 'Arena aglomerante para gatos' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Croquetas/ })).toHaveCount(0);

    await open(page, '/productos?especie=BIRD');
    await expect(page.getByRole('link', { name: 'Jaula mediana para aves' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Arena/ })).toHaveCount(0);

    await open(page, '/productos?ofertas=si');
    await expect(page.getByRole('link', { name: /Croquetas/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Jaula/ })).toHaveCount(0);
  });

  test('busca y muestra un mensaje cuando no hay resultados', async ({ page }) => {
    await open(page, '/productos');
    await page.getByRole('searchbox', { name: 'Buscar productos' }).fill('jaula');
    await page.getByRole('button', { name: 'Buscar' }).click();
    await page.waitForURL('**q=jaula**');
    await ready(page);
    await expect(page.getByText('1 producto para “jaula”')).toBeVisible();

    await open(page, '/productos?q=zzzzzz');
    await expect(page.getByText('No encontramos productos con esos filtros.')).toBeVisible();
  });

  test('ignora parámetros de URL inválidos sin romperse', async ({ page }) => {
    const res = await open(page, '/productos?pagina=-3&especie=DRAGON&categoria=../x&q=a&ofertas=quizas');
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Productos', level: 1 })).toBeVisible();
    await expect(page.getByText(/\d+ productos?/)).toBeVisible();
  });

  test('ficha de producto con presentaciones, oferta y política de devolución', async ({ page }) => {
    await open(page, '/productos/croquetas-perro-adulto-pollo');
    await expect(page.getByRole('heading', { name: 'Croquetas perro adulto sabor pollo' })).toBeVisible();
    await expect(page.getByText('Saco 3 kg')).toBeVisible();
    await expect(page.getByText('Saco 15 kg')).toBeVisible();
    await expect(page.getByText('$17,00')).toBeVisible(); // precio anterior tachado
    await expect(page.getByText(/no admite devolución una vez abierto/)).toBeVisible();
    // El público no ve cantidades de stock, solo si está disponible.
    await expect(page.getByText('Disponible').first()).toBeVisible();
    await expect(page.getByText(/stock\s*\d/i)).toHaveCount(0);
  });

  test('un producto inexistente muestra la página de no encontrado', async ({ page }) => {
    await page.goto('/productos/no-existe-este-producto');
    await expect(page.getByRole('heading', { name: 'No encontramos esta página' })).toBeVisible();
  });
});

test.describe('animales', () => {
  test('separa venta y adopción', async ({ page }) => {
    await open(page, '/animales?tipo=adopcion');
    await expect(page.getByRole('link', { name: 'Luna' })).toBeVisible();
    await expect(page.getByText('En adopción').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Periquito azul' })).toHaveCount(0);

    await open(page, '/animales?tipo=venta');
    await expect(page.getByRole('link', { name: 'Periquito azul' })).toBeVisible();
    await expect(page.getByText('$25,00')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Luna' })).toHaveCount(0);
  });

  test('ficha de un animal en adopción', async ({ page }) => {
    await open(page, '/animales/luna-gata-adopcion');
    await expect(page.getByRole('heading', { name: 'Luna' })).toBeVisible();
    await expect(page.getByText('Hembra')).toBeVisible();
    await expect(page.getByText('Esterilizado')).toBeVisible();
    await expect(page.getByText(/^\$/)).toHaveCount(0); // sin precio
  });
});

test.describe('cuenta', () => {
  test('registro completo, mi cuenta y cierre de sesión', async ({ page }) => {
    const email = `nuevo-${Date.now()}@test.com`;
    await page.goto('/registro');
    await page.getByLabel('Nombre').fill('María');
    await page.getByLabel('Apellido').fill('González');
    await page.getByLabel('Correo').fill(`  ${email.toUpperCase()} `);
    await page.getByLabel('Teléfono (opcional)').fill('0412-1234567');
    await page.getByLabel('Contraseña').fill(PASSWORD);
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await page.waitForURL('**/cuenta');
    await ready(page);
    await expect(page.getByRole('heading', { name: 'Hola, María' })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByText('Cliente')).toBeVisible();

    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await page.waitForURL('/');
    await expect(page.getByRole('link', { name: 'Entrar' })).toBeVisible();
    expect(await page.context().cookies()).toHaveLength(0);
  });

  test('el registro muestra los errores de validación', async ({ page }) => {
    const existing = await createUser();
    await page.goto('/registro');
    const fill = async (overrides: Record<string, string> = {}) => {
      const values = {
        Nombre: 'Ana',
        Apellido: 'Pérez',
        Correo: `ok-${Date.now()}@test.com`,
        'Teléfono (opcional)': '',
        Contraseña: PASSWORD,
        ...overrides,
      };
      for (const [label, value] of Object.entries(values)) {
        await page.getByLabel(label).fill(value);
      }
      await page.getByRole('button', { name: 'Crear cuenta' }).click();
    };
    const alert = page.locator('form [role=alert]');

    await fill({ Correo: existing });
    await expect(alert).toHaveText('Ya existe una cuenta con ese correo');
    // Lo escrito se conserva tras el error.
    await expect(page.getByLabel('Nombre')).toHaveValue('Ana');

    await fill({ 'Teléfono (opcional)': '0412-ABC' });
    await expect(alert).toHaveText('Teléfono inválido');
  });

  test('el navegador exige los campos obligatorios antes de enviar', async ({ page }) => {
    await page.goto('/registro');
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    await expect(page).toHaveURL(/\/registro$/);
    const valid = await page.getByLabel('Nombre').evaluate((el: HTMLInputElement) => el.validity.valid);
    expect(valid).toBe(false);
    await page.getByLabel('Contraseña').fill('corta');
    const tooShort = await page
      .getByLabel('Contraseña')
      .evaluate((el: HTMLInputElement) => el.validity.tooShort);
    expect(tooShort).toBe(true);
  });

  test('login con contraseña incorrecta y con correo inexistente', async ({ page }) => {
    const email = await createUser();
    await page.goto('/entrar');
    await page.getByLabel('Correo').fill(email);
    await page.getByLabel('Contraseña').fill('mala-clave-123');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.locator('form [role=alert]')).toHaveText('Correo o contraseña incorrectos');
    await expect(page.getByLabel('Correo')).toHaveValue(email);

    await page.getByLabel('Correo').fill('nadie-existe@test.com');
    await page.getByLabel('Contraseña').fill('mala-clave-123');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page.locator('form [role=alert]')).toHaveText('Correo o contraseña incorrectos');
  });

  test('tras entrar vuelve a la página pedida, pero nunca a otro sitio', async ({ page }) => {
    const email = await createUser();
    await page.goto('/cuenta');
    await page.waitForURL(/\/entrar\?next=(%2F|\/)cuenta$/);

    await page.goto(`/entrar?next=${encodeURIComponent('//sitio-malicioso.com')}`);
    await page.getByLabel('Correo').fill(email);
    await page.getByLabel('Contraseña').fill(PASSWORD);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.waitForURL('**/cuenta');
    expect(new URL(page.url()).host).toBe('localhost:3000');
  });

  test('la sesión se renueva sola cuando vence el token de acceso', async ({ page }) => {
    const email = await createUser([], 'Renovado');
    await login(page, email);
    const context = page.context();
    const before = (await context.cookies()).find((c) => c.name === 'petbf_rt')?.value;
    await context.clearCookies({ name: 'petbf_at' });

    await open(page, '/cuenta');
    await expect(page.getByRole('heading', { name: 'Hola, Renovado' })).toBeVisible();
    const cookies = await context.cookies();
    const access = cookies.find((c) => c.name === 'petbf_at');
    const refresh = cookies.find((c) => c.name === 'petbf_rt');
    expect(access?.httpOnly).toBe(true);
    expect(refresh?.httpOnly).toBe(true);
    expect(refresh?.value).not.toBe(before); // el refresh token rotó
  });

  test('los tokens no son accesibles desde JavaScript', async ({ page }) => {
    await login(page, await createUser());
    expect(await page.evaluate(() => document.cookie)).not.toContain('petbf_');
  });
});

test.describe('móvil', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const path of ['/', '/productos', '/productos/croquetas-perro-adulto-pollo', '/animales', '/registro']) {
    test(`sin scroll horizontal en ${path}`, async ({ page }) => {
      await open(page, path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(overflow).toBe(false);
    });
  }
});
