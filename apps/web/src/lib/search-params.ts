import type { Species } from './api';

// Los parámetros de la URL los escribe cualquiera: se limpian antes de
// enviarlos a la API, así un valor raro no rompe la página con un 400.

type Raw = Record<string, string | string[] | undefined>;

export function one(raw: Raw, key: string): string | undefined {
  const value = raw[key];
  return Array.isArray(value) ? value[0] : value;
}

export function pageParam(raw: Raw): number {
  const page = Number(one(raw, 'pagina'));
  return Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1;
}

export function slugParam(raw: Raw, key: string): string | undefined {
  const value = one(raw, key);
  return value && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 80
    ? value
    : undefined;
}

export function textParam(raw: Raw, key: string, min = 2, max = 80): string | undefined {
  const value = one(raw, key)?.trim();
  return value && value.length >= min && value.length <= max ? value : undefined;
}

export function enumParam<T extends string>(
  raw: Raw,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = one(raw, key);
  return allowed.includes(value as T) ? (value as T) : undefined;
}

export const SPECIES: readonly Species[] = [
  'DOG',
  'CAT',
  'BIRD',
  'FISH',
  'RODENT',
  'REPTILE',
  'OTHER',
];

// Construye la URL de un listado manteniendo los filtros actuales.
export function withParams(
  path: string,
  current: Record<string, string | number | undefined>,
  changes: Record<string, string | number | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...current, ...changes })) {
    if (value !== undefined && value !== '' && !(key === 'pagina' && value === 1)) {
      search.set(key, String(value));
    }
  }
  const text = search.toString();
  return text ? `${path}?${text}` : path;
}
