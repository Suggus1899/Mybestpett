import 'server-only';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { ACCESS_COOKIE, API_URL } from './config';

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

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`La API respondió ${status}`);
  }
}

type Params = Record<string, string | number | undefined>;

async function get<T>(path: string, auth = false): Promise<T> {
  const headers: Record<string, string> = {};
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
  animals: (params: Params) => get<Page<Animal>>(`/animals${qs(params)}`),
  animal: (slug: string) => get<Animal>(`/animals/${encodeURIComponent(slug)}`),
  rates: () => get<Rates>('/exchange-rates/current'),
  // Rutas del equipo: van con la sesión del usuario.
  inventory: (params: Params) => get<Page<InventoryRow>>(`/manage/inventory${qs(params)}`, true),
  inventorySummary: () => get<InventorySummary>('/manage/inventory/summary', true),
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
