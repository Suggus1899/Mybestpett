import { proxyProof } from '@/lib/proof-proxy';

// Comprobante de un pago propio.
export async function GET(req: Request, { params }: { params: Promise<{ id: string; paymentId: string }> }) {
  const { id, paymentId } = await params;
  return proxyProof(
    req,
    `/orders/${encodeURIComponent(id)}/payments/${encodeURIComponent(paymentId)}/proof`,
    [id, paymentId],
    `/pedidos/${id}`,
  );
}
