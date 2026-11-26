import { createHash } from 'node:crypto';

export const MAX_PROOF_BYTES = 5 * 1024 * 1024; // 5 MB

// Tipo real del archivo según sus primeros bytes. Lo que diga el navegador
// (nombre o tipo MIME) no se usa: se puede falsear.
export function sniffProofType(data: Buffer): string | null {
  const starts = (bytes: number[], offset = 0) =>
    bytes.every((b, i) => data[offset + i] === b);
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return 'image/png';
  if (
    data.length >= 12 &&
    data.toString('latin1', 0, 4) === 'RIFF' &&
    data.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (data.toString('latin1', 0, 5) === '%PDF-') return 'application/pdf';
  return null;
}

export function sha256(data: Buffer) {
  return createHash('sha256').update(data).digest('hex');
}

const extension: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export function proofFileName(reference: string, contentType: string) {
  return `comprobante-${reference}.${extension[contentType] ?? 'bin'}`;
}
