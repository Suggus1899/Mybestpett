import { liveSpeciesProblem } from './live-species.js';

describe('liveSpeciesProblem', () => {
  it('acepta perros, gatos y peces con o sin raza', () => {
    expect(liveSpeciesProblem('DOG', null)).toBeNull();
    expect(liveSpeciesProblem('CAT', 'Siamés')).toBeNull();
    expect(liveSpeciesProblem('FISH', 'Guppy')).toBeNull();
  });

  it('acepta aves y roedores domésticos sin importar tildes ni mayúsculas', () => {
    expect(liveSpeciesProblem('BIRD', 'periquito australiano')).toBeNull();
    expect(
      liveSpeciesProblem('BIRD', 'Periquito Australiano arlequín'),
    ).toBeNull();
    expect(liveSpeciesProblem('BIRD', 'cacatua ninfa')).toBeNull();
    expect(liveSpeciesProblem('RODENT', 'hamster')).toBeNull();
    expect(liveSpeciesProblem('OTHER', 'Conejo')).toBeNull();
  });

  it('rechaza fauna silvestre y especies sin tipo', () => {
    for (const [species, breed] of [
      ['BIRD', 'Guacamaya'],
      ['BIRD', 'Turpial'],
      ['BIRD', 'Loro real'],
      ['BIRD', null],
      ['BIRD', 'Periquitos'], // no es un tipo de la lista
      ['RODENT', 'Chigüire'],
      ['OTHER', 'Mono capuchino'],
      ['REPTILE', 'Morrocoy'],
      ['REPTILE', null],
    ] as const) {
      expect(liveSpeciesProblem(species, breed)).not.toBeNull();
    }
  });

  it('explica qué tipos se aceptan', () => {
    expect(liveSpeciesProblem('BIRD', 'Guacamaya')).toMatch(
      /Periquito australiano, Canario/,
    );
    expect(liveSpeciesProblem('REPTILE', null)).toMatch(/fauna protegida/);
  });
});

describe('razas de perro bloqueadas en venta', () => {
  const variants = [
    'Pitbull',
    'pit bull',
    'American Pit Bull Terrier',
    'Pit-bull azul',
    'PITBULL mestizo',
  ];

  it('no se ponen en venta', () => {
    for (const breed of variants) {
      expect(liveSpeciesProblem('DOG', breed, 'SALE')).toMatch(
        /pendiente de revisión legal/,
      );
    }
  });

  it('sí se aceptan en adopción', () => {
    for (const breed of variants) {
      expect(liveSpeciesProblem('DOG', breed, 'ADOPTION')).toBeNull();
      expect(liveSpeciesProblem('DOG', breed)).toBeNull();
    }
  });

  it('otras razas siguen en venta', () => {
    for (const breed of ['Labrador', 'Bulldog francés', 'Pitufo', null]) {
      expect(liveSpeciesProblem('DOG', breed, 'SALE')).toBeNull();
    }
  });
});
