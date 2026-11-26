import { expect, test } from '@playwright/test';
import { createProduct, createUser, deliveredOrder, login, open, ready, retireTestProducts } from './helpers';

// Reseñas: solo quien recibió el producto la escribe; el equipo de catálogo
// la oculta con un motivo que el autor ve, y la vuelve a mostrar.

test.afterAll(retireTestProducts);

test('el cliente reseña lo que recibió, la edita y el equipo la oculta y la vuelve a mostrar', async ({ page, browser }) => {
  await login(page, await createUser());
  const { product } = await deliveredOrder(page);
  await open(page, `/productos/${product.slug}`);
  const reviews = page.getByRole('region', { name: 'Reseñas' });
  await expect(reviews.getByText('Todavía no hay reseñas.')).toBeVisible();

  const form = page.getByRole('form', { name: 'Escribir una reseña' });
  // Sin estrellas ni texto suficiente el navegador no la envía.
  await form.getByLabel('Tu experiencia').fill('Corta');
  const valid = await form.evaluate((el: HTMLFormElement) => el.checkValidity());
  expect(valid).toBe(false);
  await form.getByRole('radio', { name: '5 estrellas' }).check();
  await form.getByLabel('Título (opcional)').fill('Le encantó');
  await form.getByLabel('Tu experiencia').fill('Mi perro no la suelta, aguanta mordidas fuertes.');
  await form.getByRole('button', { name: 'Publicar reseña' }).click();
  await expect(reviews.getByText('¡Gracias! Tu reseña quedó guardada.')).toBeVisible();

  await open(page, `/productos/${product.slug}`);
  await expect(reviews.getByText('Le encantó')).toBeVisible();
  await expect(reviews.getByText(/Prueba E\. · Compra verificada/)).toBeVisible();
  await expect(reviews.getByLabel('5 de 5 estrellas, 1 reseña').first()).toBeVisible();
  await expect(reviews.getByRole('list', { name: 'Reseñas por estrellas' })).toContainText('5 ★: 1');

  // Al editarla conserva lo escrito y cambia la valoración.
  const edit = page.getByRole('form', { name: 'Editar mi reseña' });
  await expect(edit.getByLabel('Tu experiencia')).toHaveValue('Mi perro no la suelta, aguanta mordidas fuertes.');
  await edit.getByRole('radio', { name: '4 estrellas' }).check();
  await edit.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(reviews.getByText('¡Gracias! Tu reseña quedó guardada.')).toBeVisible();
  await open(page, `/productos/${product.slug}`);
  await expect(reviews.getByRole('list', { name: 'Reseñas por estrellas' })).toContainText('4 ★: 1');

  // El equipo de catálogo la oculta; el motivo es obligatorio.
  const manager = await browser.newPage();
  await login(manager, await createUser(['CATALOG_MANAGER']), '/admin/resenas');
  await ready(manager);
  const card = manager.getByRole('listitem').filter({ hasText: product.name });
  await expect(card.getByText('Mi perro no la suelta, aguanta mordidas fuertes.')).toBeVisible();
  const reason = card.getByLabel('Motivo para ocultarla');
  expect(await reason.evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
  await reason.fill('Menciona una tienda de la competencia');
  await card.getByRole('button', { name: 'Ocultar' }).click();
  await expect(card).toHaveCount(0); // sale de las visibles

  // Ya no aparece en la tienda y el autor ve el motivo.
  const visitor = await browser.newPage();
  await open(visitor, `/productos/${product.slug}`);
  await expect(visitor.getByText('Todavía no hay reseñas.')).toBeVisible();
  await expect(visitor.getByText('Entra a tu cuenta para reseñar los productos que compraste.')).toBeVisible();
  await open(page, `/productos/${product.slug}`);
  await expect(page.getByText('El equipo ocultó tu reseña: Menciona una tienda de la competencia')).toBeVisible();

  // En la pestaña de ocultas se ve quién la ocultó y se puede volver a mostrar.
  await open(manager, '/admin/resenas?estado=HIDDEN');
  const hidden = manager.getByRole('listitem').filter({ hasText: product.name });
  await expect(hidden.getByText(/Oculta por Prueba E2E .*: Menciona una tienda de la competencia/)).toBeVisible();
  await hidden.getByRole('button', { name: 'Volver a mostrar' }).click();
  await expect(hidden).toHaveCount(0);
  await open(visitor, `/productos/${product.slug}`);
  await expect(visitor.getByText('Mi perro no la suelta, aguanta mordidas fuertes.')).toBeVisible();

  // El autor la borra.
  await open(page, `/productos/${product.slug}`);
  await page.getByRole('button', { name: 'Borrar mi reseña' }).click();
  await expect(page.getByRole('form', { name: 'Escribir una reseña' })).toBeVisible();
  await expect(reviews.getByText('Todavía no hay reseñas.')).toBeVisible();
});

test('sin compra entregada no se puede reseñar', async ({ page }) => {
  const product = await createProduct(700);
  await login(page, await createUser());
  await open(page, `/productos/${product.slug}`);
  await expect(page.getByText('Podrás dejar una reseña cuando recibas este producto.')).toBeVisible();
  await expect(page.getByRole('form', { name: 'Escribir una reseña' })).toHaveCount(0);
});

test('solo el equipo de catálogo modera reseñas', async ({ page }) => {
  await login(page, await createUser(['ORDERS_OPERATOR']), '/admin/resenas');
  await ready(page);
  await expect(page.getByRole('heading', { name: 'No tienes acceso a esta sección' })).toBeVisible();
});
