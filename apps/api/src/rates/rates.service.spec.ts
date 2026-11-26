import { caracasToday } from './rates.service.js';

describe('caracasToday', () => {
  it('usa la fecha de Caracas (UTC-4), no la de UTC', () => {
    // 02:00 UTC del 27 son las 22:00 del 26 en Caracas.
    expect(caracasToday(new Date('2026-11-27T02:00:00Z'))).toBe('2026-11-26');
    expect(caracasToday(new Date('2026-11-27T05:00:00Z'))).toBe('2026-11-27');
  });
});
