import 'server-only';
import { cookies, headers as requestHeaders } from 'next/headers';
import { notFound } from 'next/navigation';
import { ACCESS_COOKIE, API_URL } from './config';
import { forwardHeaders } from './forward';

// Lecturas de la API desde el servidor de Next. Sin caché por ahora: precios
// y stock deben verse al día; se cacheará con etiquetas cuando haga falta.

export type Species = 'DOG' | 'CAT' | 'BIRD' | 'FISH' | 'RODENT' | 'REPTILE' | 'OTHER';

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Image {
  url: string;
  alt: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
}

export interface ProductCard {
  id: string;
  name: string;
  slug: string;
  species: Species[];
  category: { name: string; slug: string };
  brand: { name: string; slug: string } | null;
  image: Image | null;
  priceFromUsdCents: number | null;
  compareAtUsdCents: number | null;
  inStock: boolean;
  rating: Rating;
}

export interface Rating {
  average: number | null;
  count: number;
}

export interface Review {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  author: string;
  verifiedPurchase: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewPage extends Page<Review> {
  summary: { count: number; average: number | null; distribution: number[] };
}

export interface MyReview {
  canReview: boolean;
  review: {
    id: string;
    rating: number;
    title: string | null;
    body: string;
    status: 'VISIBLE' | 'HIDDEN';
    hiddenReason: string | null;
  } | null;
}

export interface ReviewRow {
  id: string;
  rating: number;
  title: string | null;
  body: string;
  status: 'VISIBLE' | 'HIDDEN';
  hiddenReason: string | null;
  moderatedAt: string | null;
  createdAt: string;
  product: { name: string; slug: string };
  user: { email: string; firstName: string; lastName: string };
  moderatedBy: { firstName: string; lastName: string } | null;
}

export interface ProductDetail {
  id: string;
  name: string;
  slug: string;
  description: string;
  species: Species[];
  isReturnable: boolean;
  category: { name: string; slug: string };
  brand: { name: string } | null;
  images: Image[];
  variants: {
    id: string;
    sku: string;
    name: string;
    priceUsdCents: number;
    compareAtUsdCents: number | null;
    inStock: boolean;
  }[];
  rating: Rating;
}

export interface Animal {
  id: string;
  name: string;
  slug: string;
  listingType: 'SALE' | 'ADOPTION';
  status: 'AVAILABLE' | 'RESERVED' | 'SOLD' | 'ADOPTED' | 'UNAVAILABLE';
  species: Species;
  breed: string | null;
  sex: 'MALE' | 'FEMALE' | 'UNKNOWN';
  birthDate: string | null;
  description: string;
  priceUsdCents: number | null;
  isVaccinated: boolean;
  isSterilized: boolean;
  images: Image[];
}

export interface Rates {
  usdVes: { rate: string; effectiveAt: string } | null;
  eurVes: { rate: string; effectiveAt: string } | null;
}

export interface InventoryRow {
  id: string;
  sku: string;
  name: string;
  stock: number;
  priceUsdCents: number;
  isActive: boolean;
  updatedAt: string;
  status: 'out' | 'low' | 'in';
  product: {
    name: string;
    slug: string;
    isActive: boolean;
    category: { name: string; slug: string };
  };
}

export interface InventorySummary {
  lowThreshold: number;
  variants: number;
  units: number;
  outOfStock: number;
  lowStock: number;
  valueUsdCents: number;
  animalsForSale: number;
  animalsForAdoption: number;
}

// ---------- Compra ----------

export type Currency = 'USD' | 'VES' | 'EUR' | 'USDT';

export interface Cart {
  items: {
    variantId: string;
    sku: string;
    name: string;
    product: { name: string; slug: string; image: Image | null };
    unitPriceUsdCents: number;
    quantity: number;
    lineTotalUsdCents: number;
    issue: 'unavailable' | 'insufficient_stock' | null;
    available: number;
  }[];
  itemCount: number;
  subtotalUsdCents: number;
  combos: { comboId: string; name: string; count: number; savingsUsdCents: number }[];
  comboDiscountUsdCents: number;
  coupon: { code: string; description: string; discountUsdCents: number } | null;
  // Lo que cuestan los productos tras combos y cupón, sin envío.
  itemsTotalUsdCents: number;
  canCheckout: boolean;
}

export interface Combo {
  id: string;
  name: string;
  slug: string;
  description: string;
  priceUsdCents: number;
  regularUsdCents: number;
  savingsUsdCents: number;
  available: number;
  items: {
    quantity: number;
    variantId: string;
    variantName: string;
    sku: string;
    unitPriceUsdCents: number;
    product: { name: string; slug: string; image: Image | null };
  }[];
}

export interface ComboRow extends Combo {
  isActive: boolean;
  sellable: boolean;
}

export interface Coupon {
  id: string;
  code: string;
  description: string;
  type: 'PERCENT' | 'FIXED';
  value: number;
  minSubtotalUsdCents: number;
  maxDiscountUsdCents: number | null;
  startsAt: string | null;
  endsAt: string | null;
  maxRedemptions: number | null;
  perUserLimit: number;
  isActive: boolean;
  createdAt: string;
  createdBy: { firstName: string; lastName: string };
  uses: number;
  discountedUsdCents: number;
}

export interface Address {
  id: string;
  recipientName: string;
  phone: string;
  state: string;
  city: string;
  municipality: string | null;
  line1: string;
  referencePoint: string | null;
  isDefault: boolean;
}

export interface ShippingZone {
  id: string;
  name: string;
  states: string[];
  carrier: string;
  priceUsdCents: number;
  freeOverUsdCents: number;
  isActive?: boolean;
  sortOrder?: number;
}

export interface PaymentMethod {
  id: string;
  code: string;
  name: string;
  currency: Currency;
  instructions: string;
  isActive?: boolean;
  sortOrder?: number;
}

export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'PAYMENT_REPORTED'
  | 'PAID'
  | 'PREPARING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REFUNDED';

export type PaymentStatus = 'REPORTED' | 'VERIFIED' | 'REJECTED';

export interface OrderSummary {
  id: string;
  code: string;
  status: OrderStatus;
  totalUsdCents: number;
  totalCharged: string;
  chargedCurrency: Currency;
  paymentDueAt: string;
  createdAt: string;
  _count: { items: number };
  user?: { email: string; firstName: string; lastName: string };
  state?: string;
  city?: string;
}

export interface Order {
  id: string;
  code: string;
  status: OrderStatus;
  chargedCurrency: Currency;
  usdVesRate: string | null;
  eurVesRate: string | null;
  rateEffectiveAt: string | null;
  subtotalUsdCents: number;
  comboDiscountUsdCents: number;
  couponDiscountUsdCents: number;
  couponCode: string | null;
  shippingUsdCents: number;
  totalUsdCents: number;
  totalCharged: string;
  recipientName: string;
  phone: string;
  state: string;
  city: string;
  municipality: string | null;
  line1: string;
  referencePoint: string | null;
  shippingZoneName: string;
  carrier: string;
  trackingCode: string | null;
  paymentDueAt: string;
  createdAt: string;
  items: {
    id: string;
    productName: string;
    productSlug: string;
    variantName: string;
    sku: string;
    unitPriceUsdCents: number;
    quantity: number;
    isReturnable: boolean;
  }[];
  paymentMethod: { code: string; name: string; currency: Currency; instructions: string };
  payments: {
    id: string;
    reference: string;
    amount: string;
    currency: Currency;
    paidAt: string;
    status: PaymentStatus;
    rejectionReason: string | null;
    originBank?: string | null;
    createdAt: string;
    proof: PaymentProof | null;
  }[];
  history: {
    toStatus: OrderStatus;
    note: string | null;
    createdAt: string;
    changedBy?: { firstName: string; lastName: string } | null;
  }[];
  user?: { email: string; firstName: string; lastName: string; phone: string | null };
  // Hasta cuándo se puede pedir una devolución; null si no aplica.
  returnUntil: string | null;
  returns: OrderReturn[];
}

export type ReturnStatus = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'REFUNDED';

export interface OrderReturn {
  id: string;
  status: ReturnStatus;
  reason: string;
  refundUsdCents: number;
  currency: Currency;
  refundAmount: string;
  decisionNote: string | null;
  refundReference: string | null;
  refundedAt: string | null;
  createdAt: string;
  items: { orderItemId: string; quantity: number }[];
}

export interface ReturnRow extends Omit<OrderReturn, 'items'> {
  restocked: boolean;
  decidedAt: string | null;
  decidedBy: { firstName: string; lastName: string } | null;
  refundedBy: { firstName: string; lastName: string } | null;
  items: {
    orderItemId: string;
    quantity: number;
    orderItem: { productName: string; variantName: string; sku: string; unitPriceUsdCents: number };
  }[];
  order: {
    id: string;
    code: string;
    status: OrderStatus;
    deliveredAt: string | null;
    paymentMethod: { code: string; name: string };
    user: { email: string; firstName: string; lastName: string };
  };
}

export interface PaymentProof {
  contentType: string;
  sizeBytes: number;
  createdAt: string;
}

export interface PaymentRow {
  id: string;
  proof: PaymentProof | null;
  reference: string;
  originBank: string | null;
  amount: string;
  currency: Currency;
  paidAt: string;
  status: PaymentStatus;
  rejectionReason: string | null;
  createdAt: string;
  method: { code: string; name: string };
  order: {
    id: string;
    code: string;
    status: OrderStatus;
    totalCharged: string;
    chargedCurrency: Currency;
    user: { email: string; firstName: string; lastName: string };
  };
}

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`La API respondió ${status}`);
  }
}

type Params = Record<string, string | number | undefined>;

async function get<T>(path: string, auth = false): Promise<T> {
  const headers: Record<string, string> = forwardHeaders(await requestHeaders());
  if (auth) {
    const token = (await cookies()).get(ACCESS_COOKIE)?.value;
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_URL}${path}`, { headers, cache: 'no-store' });
  if (res.status === 404) notFound();
  if (!res.ok) throw new ApiError(res.status);
  return res.json();
}

function qs(params: Params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const api = {
  categories: () => get<Category[]>('/categories'),
  products: (params: Params) => get<Page<ProductCard>>(`/products${qs(params)}`),
  product: (slug: string) => get<ProductDetail>(`/products/${encodeURIComponent(slug)}`),
  productReviews: (slug: string, params: Params) =>
    get<ReviewPage>(`/products/${encodeURIComponent(slug)}/reviews${qs(params)}`),
  myReview: (slug: string) => get<MyReview>(`/products/${encodeURIComponent(slug)}/reviews/mine`, true),
  recommendations: (slug: string) => get<ProductCard[]>(`/products/${encodeURIComponent(slug)}/recommendations`),
  manageReviews: (params: Params) => get<Page<ReviewRow>>(`/manage/reviews${qs(params)}`, true),
  animals: (params: Params) => get<Page<Animal>>(`/animals${qs(params)}`),
  animal: (slug: string) => get<Animal>(`/animals/${encodeURIComponent(slug)}`),
  rates: () => get<Rates>('/exchange-rates/current'),
  // Rutas del equipo: van con la sesión del usuario.
  inventory: (params: Params) => get<Page<InventoryRow>>(`/manage/inventory${qs(params)}`, true),
  inventorySummary: () => get<InventorySummary>('/manage/inventory/summary', true),
  manageOrders: (params: Params) => get<Page<OrderSummary>>(`/manage/orders${qs(params)}`, true),
  manageOrder: (id: string) => get<Order>(`/manage/orders/${encodeURIComponent(id)}`, true),
  managePayments: (params: Params) => get<Page<PaymentRow>>(`/manage/payments${qs(params)}`, true),
  manageReturns: (params: Params) => get<Page<ReturnRow>>(`/manage/returns${qs(params)}`, true),
  manageZones: () => get<ShippingZone[]>('/manage/shipping-zones', true),
  managePaymentMethods: () => get<PaymentMethod[]>('/manage/payment-methods', true),
  // Compra: con la sesión del cliente.
  cart: () => get<Cart>('/cart', true),
  // Carrito con un cupón de prueba: si no aplica, devuelve el motivo.
  cartWithCoupon: async (code: string): Promise<{ cart: Cart } | { error: string }> => {
    const headers: Record<string, string> = forwardHeaders(await requestHeaders());
    const token = (await cookies()).get(ACCESS_COOKIE)?.value;
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API_URL}/cart${qs({ coupon: code })}`, { headers, cache: 'no-store' });
    if (res.ok) return { cart: await res.json() };
    if (res.status !== 400) throw new ApiError(res.status);
    const body = await res.json().catch(() => ({}));
    const msg = Array.isArray(body.message) ? body.message[0] : body.message;
    return { error: typeof msg === 'string' ? msg.replace(/^[a-zA-Z.]+: /, '') : 'Ese cupón no aplica' };
  },
  combos: () => get<Combo[]>('/combos'),
  manageCombos: (params: Params) => get<Page<ComboRow>>(`/manage/combos${qs(params)}`, true),
  manageCoupons: (params: Params) => get<Page<Coupon>>(`/manage/coupons${qs(params)}`, true),
  addresses: () => get<Address[]>('/addresses', true),
  shippingZones: () => get<ShippingZone[]>('/shipping-zones'),
  paymentMethods: () => get<PaymentMethod[]>('/payment-methods'),
  myOrders: (params: Params) => get<Page<OrderSummary>>(`/orders${qs(params)}`, true),
  myOrder: (id: string) => get<Order>(`/orders/${encodeURIComponent(id)}`, true),
};

export const speciesLabel: Record<Species, string> = {
  DOG: 'Perros',
  CAT: 'Gatos',
  BIRD: 'Aves',
  FISH: 'Peces',
  RODENT: 'Roedores',
  REPTILE: 'Reptiles',
  OTHER: 'Otros',
};
