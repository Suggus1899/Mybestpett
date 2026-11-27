'use server';

import { revalidatePath } from 'next/cache';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCESS_COOKIE, API_URL } from './config';
import { forwardHeaders } from './forward';

// Acciones de compra y del panel. Todas llaman a la API con la sesión de la
// persona: la API vuelve a validar permisos, datos y estado en cada una.

export interface ActionState {
  error?: string;
  ok?: string;
  fields?: Record<string, string>;
}

function text(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

// Solo rutas internas para volver tras iniciar sesión.
function safePath(value: string, fallback: string) {
  return value.startsWith('/') && !value.startsWith('//') ? value : fallback;
}

async function message(res: Response): Promise<string> {
  if (res.status === 429) return 'Demasiadas peticiones. Espera un minuto.';
  if (res.status === 413) return 'El comprobante pesa más de 5 MB.';
  if (res.status === 403) return 'No tienes permiso para hacer esto.';
  try {
    const body = await res.json();
    const msg = Array.isArray(body.message) ? body.message[0] : body.message;
    if (typeof msg === 'string') return msg.replace(/^[a-zA-Z.]+: /, '');
  } catch {}
  return 'Algo salió mal. Inténtalo de nuevo.';
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function call<T>(
  method: string,
  path: string,
  body: unknown,
  next: string,
): Promise<Result<T>> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) redirect(`/entrar?next=${encodeURIComponent(next)}`);
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        ...forwardHeaders(await headers()),
        // Con FormData, fetch pone el multipart con su separador.
        ...(!(body instanceof FormData) && { 'Content-Type': 'application/json' }),
        Authorization: `Bearer ${token}`,
      },
      body: body === undefined || body instanceof FormData ? body : JSON.stringify(body),
      cache: 'no-store',
    });
  } catch {
    return { ok: false, error: 'No pudimos conectar con el servidor.' };
  }
  if (res.status === 401) redirect(`/entrar?next=${encodeURIComponent(next)}`);
  if (!res.ok) return { ok: false, error: await message(res) };
  return { ok: true, data: res.status === 204 ? (undefined as T) : await res.json() };
}

// ---------- Carrito ----------

export async function addToCartAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const back = safePath(text(formData, 'back'), '/productos');
  const result = await call('POST', '/cart/items', {
    variantId: text(formData, 'variantId'),
    quantity: Number(text(formData, 'quantity') || '1'),
  }, back);
  if (!result.ok) return { error: result.error };
  revalidatePath('/', 'layout'); // el contador del carrito en la cabecera
  return { ok: 'Añadido al carrito' };
}

export async function addComboToCartAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const slug = text(formData, 'slug');
  const result = await call('POST', `/cart/combos/${encodeURIComponent(slug)}`, {
    quantity: Number(text(formData, 'quantity') || '1'),
  }, '/combos');
  if (!result.ok) return { error: result.error };
  revalidatePath('/', 'layout');
  return { ok: 'Combo añadido al carrito' };
}

export async function setCartQuantityAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const variantId = text(formData, 'variantId');
  const result = await call('PUT', `/cart/items/${encodeURIComponent(variantId)}`, {
    quantity: Number(text(formData, 'quantity')),
  }, '/carrito');
  if (!result.ok) return { error: result.error };
  revalidatePath('/', 'layout');
  return {};
}

export async function removeFromCartAction(formData: FormData) {
  const variantId = text(formData, 'variantId');
  await call('DELETE', `/cart/items/${encodeURIComponent(variantId)}`, undefined, '/carrito');
  revalidatePath('/', 'layout');
}

// ---------- Direcciones y checkout ----------

const addressFields = ['recipientName', 'phone', 'state', 'city', 'municipality', 'line1', 'referencePoint'];

export async function createAddressAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const fields = Object.fromEntries(addressFields.map((f) => [f, text(formData, f)]));
  const result = await call('POST', '/addresses', { ...fields, isDefault: true }, '/checkout');
  if (!result.ok) return { error: result.error, fields };
  revalidatePath('/checkout');
  return { ok: 'Dirección guardada' };
}

export async function checkoutAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const result = await call<{ id: string }>('POST', '/orders', {
    addressId: text(formData, 'addressId'),
    shippingZoneId: text(formData, 'shippingZoneId'),
    paymentMethodId: text(formData, 'paymentMethodId'),
    acceptTerms: formData.get('acceptTerms') === 'on',
    couponCode: text(formData, 'couponCode') || undefined,
    points: Number(text(formData, 'points') || '0'),
  }, '/checkout');
  if (!result.ok) return { error: result.error };
  revalidatePath('/', 'layout');
  redirect(`/pedidos/${result.data.id}`);
}

// ---------- Pedidos del cliente ----------

// El campo datetime-local llega sin zona horaria: es hora de Venezuela (UTC-4).
function caracasIso(local: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local) ? `${local}:00-04:00` : local;
}

const MAX_PROOF_BYTES = 5 * 1024 * 1024; // igual que la API
const PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

// Archivo elegido en el formulario, o null si no se eligió ninguno.
function proofFile(formData: FormData): File | null {
  const file = formData.get('proof');
  return file instanceof File && file.size > 0 ? file : null;
}

// Revisión previa para avisar antes de enviar. La API vuelve a validar el
// contenido real del archivo, que es lo que cuenta.
function proofProblem(file: File): string | null {
  if (file.size > MAX_PROOF_BYTES) return 'El comprobante pesa más de 5 MB.';
  if (!PROOF_TYPES.includes(file.type)) return 'El comprobante debe ser una imagen JPG, PNG o WebP, o un PDF.';
  return null;
}

function uploadProof(orderId: string, paymentId: string, file: File) {
  const body = new FormData();
  body.set('file', file);
  return call(
    'PUT',
    `/orders/${encodeURIComponent(orderId)}/payments/${encodeURIComponent(paymentId)}/proof`,
    body,
    `/pedidos/${orderId}`,
  );
}

export async function reportPaymentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const orderId = text(formData, 'orderId');
  const fields = {
    reference: text(formData, 'reference'),
    originBank: text(formData, 'originBank'),
    amount: text(formData, 'amount').replace(',', '.'),
    paidAt: text(formData, 'paidAt'),
  };
  const file = proofFile(formData);
  const problem = file && proofProblem(file);
  if (problem) return { error: problem, fields };
  const result = await call<{ payments: { id: string; status: string }[] }>('POST', `/orders/${encodeURIComponent(orderId)}/payments`, {
    ...fields,
    originBank: fields.originBank || undefined,
    paidAt: caracasIso(fields.paidAt),
  }, `/pedidos/${orderId}`);
  if (!result.ok) return { error: result.error, fields };
  revalidatePath(`/pedidos/${orderId}`);
  const payment = result.data.payments.find((p) => p.status === 'REPORTED');
  if (file && payment) {
    const uploaded = await uploadProof(orderId, payment.id, file);
    // El reporte ya quedó hecho: el comprobante se puede adjuntar después.
    if (!uploaded.ok) return { error: `Recibimos tu reporte, pero no el comprobante: ${uploaded.error} Puedes adjuntarlo de nuevo.` };
  }
  return { ok: 'Recibimos tu reporte. Te avisaremos cuando lo verifiquemos.' };
}

export async function attachProofAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const orderId = text(formData, 'orderId');
  const paymentId = text(formData, 'paymentId');
  const file = proofFile(formData);
  if (!file) return { error: 'Elige el archivo del comprobante.' };
  const problem = proofProblem(file);
  if (problem) return { error: problem };
  const result = await uploadProof(orderId, paymentId, file);
  if (!result.ok) return { error: result.error };
  revalidatePath(`/pedidos/${orderId}`);
  return { ok: 'Comprobante guardado' };
}

export async function cancelMyOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const orderId = text(formData, 'orderId');
  const result = await call('POST', `/orders/${encodeURIComponent(orderId)}/cancel`, undefined, `/pedidos/${orderId}`);
  if (!result.ok) return { error: result.error };
  revalidatePath(`/pedidos/${orderId}`);
  return { ok: 'Pedido cancelado' };
}

// ---------- Panel: pagos y pedidos ----------

export async function verifyPaymentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, 'paymentId');
  const result = await call('POST', `/manage/payments/${encodeURIComponent(id)}/verify`, undefined, '/admin/pagos');
  if (!result.ok) return { error: result.error };
  revalidatePath('/admin', 'layout');
  return { ok: 'Pago verificado' };
}

export async function rejectPaymentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, 'paymentId');
  const reason = text(formData, 'reason');
  const result = await call('POST', `/manage/payments/${encodeURIComponent(id)}/reject`, { reason }, '/admin/pagos');
  if (!result.ok) return { error: result.error, fields: { reason } };
  revalidatePath('/admin', 'layout');
  return { ok: 'Pago rechazado' };
}

export async function advanceOrderAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, 'orderId');
  const body: Record<string, string> = { status: text(formData, 'status') };
  for (const key of ['trackingCode', 'carrier', 'note']) {
    const value = text(formData, key);
    if (value) body[key] = value;
  }
  const result = await call('POST', `/manage/orders/${encodeURIComponent(id)}/status`, body, `/admin/pedidos/${id}`);
  if (!result.ok) return { error: result.error, fields: body };
  revalidatePath('/admin', 'layout');
  return { ok: 'Estado actualizado' };
}

export async function cancelOrderManageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, 'orderId');
  const reason = text(formData, 'reason');
  const result = await call('POST', `/manage/orders/${encodeURIComponent(id)}/cancel`, { reason }, `/admin/pedidos/${id}`);
  if (!result.ok) return { error: result.error, fields: { reason } };
  revalidatePath('/admin', 'layout');
  return { ok: 'Pedido cancelado' };
}

// ---------- Panel: ajustes de la tienda (ADMIN) ----------

// "12,50" o "12.50" en dólares → 1250 céntimos. Devuelve NaN si no es válido.
function dollarsToCents(value: string) {
  const normalized = value.replace(',', '.');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(normalized)) return Number.NaN;
  return Math.round(Number(normalized) * 100);
}

export async function updatePaymentMethodAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, 'id');
  const body = {
    name: text(formData, 'name'),
    instructions: text(formData, 'instructions'),
    isActive: formData.get('isActive') === 'on',
    sortOrder: Number(text(formData, 'sortOrder') || '0'),
  };
  const result = await call('PATCH', `/manage/payment-methods/${encodeURIComponent(id)}`, body, '/admin/ajustes');
  if (!result.ok) return { error: result.error };
  revalidatePath('/admin/ajustes');
  return { ok: 'Método guardado' };
}

export async function saveZoneAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, 'id');
  const price = dollarsToCents(text(formData, 'price'));
  const freeOver = dollarsToCents(text(formData, 'freeOver'));
  if (Number.isNaN(price) || Number.isNaN(freeOver)) {
    return { error: 'Usa montos en dólares con hasta 2 decimales, por ejemplo 3,50' };
  }
  const body = {
    name: text(formData, 'name'),
    carrier: text(formData, 'carrier'),
    states: formData.getAll('states').filter((v): v is string => typeof v === 'string'),
    priceUsdCents: price,
    freeOverUsdCents: freeOver,
    isActive: formData.get('isActive') === 'on',
    sortOrder: Number(text(formData, 'sortOrder') || '0'),
  };
  const result = id
    ? await call('PATCH', `/manage/shipping-zones/${encodeURIComponent(id)}`, body, '/admin/ajustes')
    : await call('POST', '/manage/shipping-zones', body, '/admin/ajustes');
  if (!result.ok) return { error: result.error };
  revalidatePath('/admin/ajustes');
  return { ok: id ? 'Zona guardada' : 'Zona creada' };
}

// ---------- Devoluciones ----------

export async function requestReturnAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const orderId = text(formData, 'orderId');
  const reason = text(formData, 'reason');
  const items: { orderItemId: string; quantity: number }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith('qty-') || typeof value !== 'string' || value.trim() === '') continue;
    const quantity = Number(value);
    if (quantity !== 0) items.push({ orderItemId: key.slice(4), quantity });
  }
  if (items.length === 0) return { error: 'Elige al menos un producto para devolver.', fields: { reason } };
  const result = await call('POST', `/orders/${encodeURIComponent(orderId)}/returns`, { reason, items }, `/pedidos/${orderId}`);
  if (!result.ok) return { error: result.error, fields: { reason } };
  revalidatePath(`/pedidos/${orderId}`);
  return { ok: 'Recibimos tu solicitud. Te diremos si la aprobamos y cómo entregar el producto.' };
}

export async function approveReturnAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, 'returnId');
  const note = text(formData, 'note');
  const result = await call('POST', `/manage/returns/${encodeURIComponent(id)}/approve`, note ? { note } : {}, '/admin/devoluciones');
  if (!result.ok) return { error: result.error, fields: { note } };
  revalidatePath('/admin', 'layout');
  return { ok: 'Devolución aprobada' };
}

export async function rejectReturnAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, 'returnId');
  const reason = text(formData, 'reason');
  const result = await call('POST', `/manage/returns/${encodeURIComponent(id)}/reject`, { reason }, '/admin/devoluciones');
  if (!result.ok) return { error: result.error, fields: { reason } };
  revalidatePath('/admin', 'layout');
  return { ok: 'Devolución rechazada' };
}

export async function refundReturnAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, 'returnId');
  const reference = text(formData, 'reference');
  const restock = text(formData, 'restock');
  if (restock !== 'yes' && restock !== 'no') {
    return { error: 'Indica si el producto vuelve al inventario.', fields: { reference } };
  }
  const result = await call(
    'POST',
    `/manage/returns/${encodeURIComponent(id)}/refund`,
    { reference, restock: restock === 'yes' },
    '/admin/devoluciones',
  );
  if (!result.ok) return { error: result.error, fields: { reference, restock } };
  revalidatePath('/admin', 'layout');
  return { ok: 'Reembolso registrado' };
}

// ---------- Reseñas ----------

export async function saveReviewAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const slug = text(formData, 'slug');
  const fields = { rating: text(formData, 'rating'), title: text(formData, 'title'), body: text(formData, 'body') };
  if (!fields.rating) return { error: 'Elige de 1 a 5 estrellas.', fields };
  const result = await call(
    'PUT',
    `/products/${encodeURIComponent(slug)}/reviews/mine`,
    { rating: Number(fields.rating), title: fields.title || undefined, body: fields.body },
    `/productos/${slug}`,
  );
  if (!result.ok) return { error: result.error, fields };
  revalidatePath(`/productos/${slug}`);
  return { ok: '¡Gracias! Tu reseña quedó guardada.', fields };
}

export async function deleteReviewAction(formData: FormData) {
  const slug = text(formData, 'slug');
  await call('DELETE', `/products/${encodeURIComponent(slug)}/reviews/mine`, undefined, `/productos/${slug}`);
  revalidatePath(`/productos/${slug}`);
}

export async function moderateReviewAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, 'reviewId');
  const status = text(formData, 'status');
  const reason = text(formData, 'reason');
  const result = await call(
    'PATCH',
    `/manage/reviews/${encodeURIComponent(id)}`,
    status === 'HIDDEN' ? { status, reason } : { status },
    '/admin/resenas',
  );
  if (!result.ok) return { error: result.error, fields: { reason } };
  revalidatePath('/admin/resenas');
  return { ok: status === 'HIDDEN' ? 'Reseña oculta' : 'Reseña visible' };
}

// ---------- Panel: cupones y combos ----------

// Monto opcional en dólares: vacío → null.
function optionalCents(value: string) {
  return value === '' ? null : dollarsToCents(value);
}

export async function createCouponAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const keys = ['code', 'description', 'type', 'value', 'minSubtotal', 'maxDiscount', 'startsAt', 'endsAt', 'maxRedemptions', 'perUserLimit'];
  const fields = Object.fromEntries(keys.map((k) => [k, text(formData, k)]));
  const type = fields.type;
  const value = type === 'FIXED' ? dollarsToCents(fields.value) : Number(fields.value);
  const minSubtotal = optionalCents(fields.minSubtotal);
  const maxDiscount = type === 'PERCENT' ? optionalCents(fields.maxDiscount) : null;
  if ([value, minSubtotal, maxDiscount].some((n) => Number.isNaN(n))) {
    return { error: 'Usa montos en dólares con hasta 2 decimales, por ejemplo 3,50', fields };
  }
  const result = await call('POST', '/manage/coupons', {
    code: fields.code,
    description: fields.description,
    type,
    value,
    minSubtotalUsdCents: minSubtotal ?? 0,
    maxDiscountUsdCents: maxDiscount,
    startsAt: fields.startsAt ? caracasIso(fields.startsAt) : null,
    endsAt: fields.endsAt ? caracasIso(fields.endsAt) : null,
    maxRedemptions: fields.maxRedemptions ? Number(fields.maxRedemptions) : null,
    perUserLimit: Number(fields.perUserLimit || '1'),
  }, '/admin/promociones');
  if (!result.ok) return { error: result.error, fields };
  revalidatePath('/admin/promociones');
  return { ok: `Cupón ${fields.code.toUpperCase()} creado` };
}

export async function toggleCouponAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, 'id');
  const isActive = text(formData, 'isActive') === 'true';
  const result = await call('PATCH', `/manage/coupons/${encodeURIComponent(id)}`, { isActive }, '/admin/promociones');
  if (!result.ok) return { error: result.error };
  revalidatePath('/admin/promociones');
  return { ok: isActive ? 'Cupón activado' : 'Cupón desactivado' };
}

const COMBO_LINES = 5; // filas del formulario de combo (promotion-forms.tsx)

export async function createComboAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const keys = ['name', 'description', 'price'];
  for (let i = 0; i < COMBO_LINES; i++) keys.push(`sku${i}`, `qty${i}`);
  const fields = Object.fromEntries(keys.map((k) => [k, text(formData, k)]));
  const price = dollarsToCents(fields.price);
  if (Number.isNaN(price)) {
    return { error: 'Usa montos en dólares con hasta 2 decimales, por ejemplo 3,50', fields };
  }
  const items = [];
  for (let i = 0; i < COMBO_LINES; i++) {
    if (fields[`sku${i}`]) items.push({ sku: fields[`sku${i}`], quantity: Number(fields[`qty${i}`] || '1') });
  }
  const result = await call('POST', '/manage/combos', {
    name: fields.name,
    description: fields.description,
    priceUsdCents: price,
    items,
  }, '/admin/promociones?ver=combos');
  if (!result.ok) return { error: result.error, fields };
  revalidatePath('/admin/promociones');
  revalidatePath('/combos');
  return { ok: `Combo ${fields.name} creado` };
}

export async function updateComboAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, 'id');
  const price = dollarsToCents(text(formData, 'price'));
  if (Number.isNaN(price)) return { error: 'Usa montos en dólares con hasta 2 decimales, por ejemplo 3,50' };
  const result = await call('PATCH', `/manage/combos/${encodeURIComponent(id)}`, {
    priceUsdCents: price,
    isActive: formData.get('isActive') === 'on',
  }, '/admin/promociones?ver=combos');
  if (!result.ok) return { error: result.error };
  revalidatePath('/admin/promociones');
  revalidatePath('/combos');
  return { ok: 'Combo guardado' };
}

// ---------- Suscripciones ----------

export async function createSubscriptionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const keys = ['variantId', 'quantity', 'intervalDays', 'addressId', 'shippingZoneId', 'paymentMethodId'];
  const fields = Object.fromEntries(keys.map((k) => [k, text(formData, k)]));
  const result = await call('POST', '/subscriptions', {
    variantId: fields.variantId,
    quantity: Number(fields.quantity),
    intervalDays: Number(fields.intervalDays),
    addressId: fields.addressId,
    shippingZoneId: fields.shippingZoneId,
    paymentMethodId: fields.paymentMethodId,
  }, '/cuenta/suscripciones');
  if (!result.ok) return { error: result.error, fields };
  revalidatePath('/', 'layout');
  redirect('/cuenta/suscripciones');
}

export async function changeSubscriptionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, 'id');
  const action = text(formData, 'action');
  if (!['pause', 'resume', 'cancel'].includes(action)) return { error: 'Acción no válida' };
  const result = await call('POST', `/subscriptions/${encodeURIComponent(id)}/${action}`, undefined, '/cuenta/suscripciones');
  if (!result.ok) return { error: result.error };
  revalidatePath('/cuenta/suscripciones');
  return { ok: action === 'pause' ? 'Suscripción pausada' : action === 'resume' ? 'Suscripción reanudada' : 'Suscripción cancelada' };
}

export async function updateSubscriptionAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const id = text(formData, 'id');
  const result = await call('PATCH', `/subscriptions/${encodeURIComponent(id)}`, {
    quantity: Number(text(formData, 'quantity')),
    intervalDays: Number(text(formData, 'intervalDays')),
  }, '/cuenta/suscripciones');
  if (!result.ok) return { error: result.error };
  revalidatePath('/cuenta/suscripciones');
  return { ok: 'Cambios guardados' };
}
