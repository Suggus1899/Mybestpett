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
