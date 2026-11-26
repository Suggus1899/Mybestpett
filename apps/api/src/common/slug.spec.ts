import { slugify } from './slug.js';

describe('slugify', () => {
  it('quita tildes, eñes y símbolos', () => {
    expect(slugify('Alimento Perro Adulto 3 kg')).toBe('alimento-perro-adulto-3-kg');
    expect(slugify('Champú  para Gatos ¡Nuevo!')).toBe('champu-para-gatos-nuevo');
    expect(slugify('Piña & Ñandú')).toBe('pina-nandu');
  });
});
