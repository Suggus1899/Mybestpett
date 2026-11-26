'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ACCESS_COOKIE, API_URL } from './config';

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
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: body === undefined ? undefined : JSON.stringify(body),
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

export async function reportPaymentAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const orderId = text(formData, 'orderId');
  const fields = {
    reference: text(formData, 'reference'),
    originBank: text(formData, 'originBank'),
    amount: text(formData, 'amount').replace(',', '.'),
    paidAt: text(formData, 'paidAt'),
  };
  const result = await call('POST', `/orders/${encodeURIComponent(orderId)}/payments`, {
    ...fields,
    originBank: fields.originBank || undefined,
    paidAt: caracasIso(fields.paidAt),
  }, `/pedidos/${orderId}`);
  if (!result.ok) return { error: result.error, fields };
  revalidatePath(`/pedidos/${orderId}`);
  return { ok: 'Recibimos tu reporte. Te avisaremos cuando lo verifiquemos.' };
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
