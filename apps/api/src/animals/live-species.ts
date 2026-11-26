import type { Species } from '../generated/prisma/enums.js';

// Qué animales vivos se pueden publicar, en venta o en adopción.
//
// Criterio: solo especies domésticas o de cría en cautiverio habituales en
// Venezuela. La fauna silvestre autóctona (loros, guacamayas, pericos
// criollos, turpiales, cardenalitos, morrocoyes, iguanas, babas, monos,
// chigüires…) está protegida: su tenencia y comercio exigen permisos del
// Ministerio del Ecosocialismo, así que no se aceptan. Antes de lanzar hay
// que confirmar esta lista con un abogado (supuesto S9 del MVP).
//
// - `any`: se acepta cualquier raza (o ninguna).
// - `kinds`: la raza debe ser uno de estos tipos domésticos.
// - `none`: la especie no se puede publicar.
export type SpeciesRule =
  | { species: Species; allowed: 'any'; note: string }
  | { species: Species; allowed: 'kinds'; kinds: string[]; note: string }
  | { species: Species; allowed: 'none'; note: string };

export const LIVE_SPECIES: SpeciesRule[] = [
  {
    species: 'DOG',
    allowed: 'any',
    note: 'Perros de cualquier raza o mestizos.',
  },
  {
    species: 'CAT',
    allowed: 'any',
    note: 'Gatos de cualquier raza o mestizos.',
  },
  {
    species: 'BIRD',
    allowed: 'kinds',
    kinds: [
      'Periquito australiano',
      'Canario',
      'Cacatúa ninfa',
      'Agapornis',
      'Diamante mandarín',
    ],
    note: 'Solo aves domésticas de cría. Loros, guacamayas, pericos criollos, turpiales y cardenalitos son fauna protegida.',
  },
  {
    species: 'RODENT',
    allowed: 'kinds',
    kinds: [
      'Hámster',
      'Cobayo',
      'Jerbo',
      'Chinchilla',
      'Rata doméstica',
      'Ratón doméstico',
    ],
    note: 'Solo roedores domésticos. El chigüire y la lapa son fauna silvestre.',
  },
  {
    species: 'FISH',
    allowed: 'any',
    note: 'Peces ornamentales de acuario criados en cautiverio.',
  },
  {
    species: 'REPTILE',
    allowed: 'none',
    note: 'No se publican: morrocoyes, iguanas y babas son fauna protegida.',
  },
  {
    species: 'OTHER',
    allowed: 'kinds',
    kinds: ['Conejo'],
    note: 'Solo conejos domésticos.',
  },
];

// Sin tildes ni mayúsculas, para comparar "hamster" con "Hámster".
function normalize(text: string) {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

// Devuelve el motivo del rechazo, o null si la combinación es válida.
// La raza puede detallar el tipo: "Periquito australiano arlequín" vale.
export function liveSpeciesProblem(
  species: Species,
  breed: string | null | undefined,
): string | null {
  const rule = LIVE_SPECIES.find((r) => r.species === species);
  if (!rule || rule.allowed === 'none')
    return rule?.note ?? 'Especie no permitida';
  if (rule.allowed === 'any') return null;
  const given = normalize(breed ?? '');
  const ok = rule.kinds.some((kind) => {
    const k = normalize(kind);
    return given === k || given.startsWith(`${k} `);
  });
  return ok
    ? null
    : `Indica el tipo en la raza: ${rule.kinds.join(', ')}. ${rule.note}`;
}
