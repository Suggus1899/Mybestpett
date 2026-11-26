import { proofFileName, sniffProofType } from './proofs.js';

describe('sniffProofType', () => {
  const bytes = (...b: number[]) => Buffer.from(b);

  it('reconoce JPG, PNG, WebP y PDF por sus primeros bytes', () => {
    expect(sniffProofType(bytes(0xff, 0xd8, 0xff, 0xe0, 0))).toBe('image/jpeg');
    expect(
      sniffProofType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)),
    ).toBe('image/png');
    expect(sniffProofType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe(
      'image/webp',
    );
    expect(sniffProofType(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf');
  });

  it('rechaza HTML, SVG, ejecutables y archivos cortos o vacíos', () => {
    for (const text of [
      '<html><script>alert(1)</script>',
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
      'MZ\x90\0',
      'RIFF',
      '',
      '%PD',
    ]) {
      expect(sniffProofType(Buffer.from(text, 'latin1'))).toBeNull();
    }
    // Un PNG truncado no pasa.
    expect(sniffProofType(bytes(0x89, 0x50, 0x4e, 0x47))).toBeNull();
  });
});

describe('proofFileName', () => {
  it('usa la referencia y la extensión del tipo real', () => {
    expect(proofFileName('ABC123', 'image/png')).toBe('comprobante-ABC123.png');
    expect(proofFileName('ABC123', 'application/pdf')).toBe(
      'comprobante-ABC123.pdf',
    );
  });
});
