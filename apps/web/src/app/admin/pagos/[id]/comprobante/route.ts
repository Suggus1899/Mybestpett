import { proxyProof } from '@/lib/proof-proxy';

// Comprobante de un pago, para el equipo de pagos.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyProof(req, `/manage/payments/${encodeURIComponent(id)}/proof`, [id], '/admin/pagos');
}
