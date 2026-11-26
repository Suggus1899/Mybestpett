import Link from 'next/link';
import type { Order, OrderStatus } from '@/lib/api';
import { AttachProofForm } from './shop-forms';
import { formatDateTime, formatMoney, formatUsd } from '@/lib/format';
import { orderStatusClass, orderStatusLabel, paymentStatusLabel, returnStatusLabel } from '@/lib/orders';

// Piezas del pedido que comparten la cuenta del cliente y el panel.

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-sm font-bold ${orderStatusClass[status]}`}>
      {orderStatusLabel[status]}
    </span>
  );
}

export function OrderItems({ order }: { order: Order }) {
  return (
    <section aria-labelledby="productos" className="rounded-[var(--radius-card)] border border-line bg-white p-5">
      <h2 id="productos" className="mb-3 text-xl">
        Productos
      </h2>
      <ul className="mb-4 flex flex-col gap-2">
        {order.items.map((item) => (
          <li key={item.id} className="flex justify-between gap-3">
            <span>
              {item.quantity} ×{' '}
              <Link href={`/productos/${item.productSlug}`} className="font-bold hover:underline">
                {item.productName}
              </Link>{' '}
              <span className="text-slate">
                ({item.variantName} · {item.sku})
              </span>
            </span>
            <span className="font-bold">{formatUsd(item.unitPriceUsdCents * item.quantity)}</span>
          </li>
        ))}
      </ul>
      <dl className="grid grid-cols-[1fr_auto] gap-y-1 border-t border-line pt-3">
        <dt>Subtotal</dt>
        <dd className="text-right">{formatUsd(order.subtotalUsdCents)}</dd>
        {order.comboDiscountUsdCents > 0 && (
          <>
            <dt>Combos</dt>
            <dd className="text-right">−{formatUsd(order.comboDiscountUsdCents)}</dd>
          </>
        )}
        {order.couponDiscountUsdCents > 0 && (
          <>
            <dt>Cupón {order.couponCode}</dt>
            <dd className="text-right">−{formatUsd(order.couponDiscountUsdCents)}</dd>
          </>
        )}
        {order.pointsDiscountUsdCents > 0 && (
          <>
            <dt>Puntos ({order.pointsRedeemed})</dt>
            <dd className="text-right">−{formatUsd(order.pointsDiscountUsdCents)}</dd>
          </>
        )}
        <dt>Envío ({order.shippingZoneName})</dt>
        <dd className="text-right">{order.shippingUsdCents === 0 ? 'Gratis' : formatUsd(order.shippingUsdCents)}</dd>
        <dt className="font-extrabold">Total</dt>
        <dd className="text-right font-extrabold">{formatUsd(order.totalUsdCents)}</dd>
        <dt>A pagar con {order.paymentMethod.name}</dt>
        <dd className="text-right font-extrabold" data-testid="order-charge">
          {formatMoney(order.totalCharged, order.chargedCurrency)}
        </dd>
      </dl>
      {order.pointsEarned > 0 && (
        <p className="mt-2 font-bold text-petbf">Con este pedido ganaste {order.pointsEarned} puntos.</p>
      )}
      {order.usdVesRate && order.chargedCurrency !== 'USD' && order.chargedCurrency !== 'USDT' && (
        <p className="mt-2 text-sm text-slate">
          Tasa BCV congelada en el pedido: Bs. {order.usdVesRate} por dólar
          {order.chargedCurrency === 'EUR' && order.eurVesRate && ` y Bs. ${order.eurVesRate} por euro`}.
        </p>
      )}
    </section>
  );
}

export function OrderShipping({ order }: { order: Order }) {
  return (
    <section aria-labelledby="envio" className="rounded-[var(--radius-card)] border border-line bg-white p-5">
      <h2 id="envio" className="mb-3 text-xl">
        Envío
      </h2>
      <p className="font-bold">{order.recipientName}</p>
      <p>{order.phone}</p>
      <p>
        {order.line1}
        {order.municipality && `, ${order.municipality}`}, {order.city}, {order.state}
      </p>
      {order.referencePoint && <p className="text-slate">Referencia: {order.referencePoint}</p>}
      <p className="mt-2 text-sm text-slate">
        {order.carrier}
        {order.trackingCode && ` · Guía ${order.trackingCode}`}
      </p>
    </section>
  );
}

// El cliente ve su comprobante y puede adjuntarlo mientras el pago espera; el
// equipo lo abre desde el panel.
export function OrderPayments({ order, viewer }: { order: Order; viewer: 'customer' | 'staff' }) {
  if (order.payments.length === 0) return null;
  return (
    <section aria-labelledby="pagos" className="rounded-[var(--radius-card)] border border-line bg-white p-5">
      <h2 id="pagos" className="mb-3 text-xl">
        Pagos reportados
      </h2>
      <ul className="flex flex-col gap-3">
        {order.payments.map((p) => (
          <li key={p.id} className="border-b border-line pb-3 last:border-0 last:pb-0">
            <p>
              <span className="font-bold">Ref. {p.reference}</span> · {formatMoney(p.amount, p.currency)} ·{' '}
              {formatDateTime(p.paidAt)}
              {p.originBank && ` · ${p.originBank}`}
            </p>
            <p className={p.status === 'REJECTED' ? 'font-bold text-danger' : 'text-slate'}>
              {paymentStatusLabel[p.status]}
              {p.rejectionReason && `: ${p.rejectionReason}`}
            </p>
            {p.proof ? (
              <a
                href={viewer === 'customer' ? `/pedidos/${order.id}/comprobante/${p.id}` : `/admin/pagos/${p.id}/comprobante`}
                target="_blank"
                rel="noopener"
                className="text-sm font-bold text-petbf hover:underline"
              >
                Ver comprobante
              </a>
            ) : (
              <p className="text-sm text-slate">Sin comprobante</p>
            )}
            {viewer === 'customer' && p.status === 'REPORTED' && (
              <AttachProofForm orderId={order.id} paymentId={p.id} hasProof={Boolean(p.proof)} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function OrderHistory({ order }: { order: Order }) {
  return (
    <section aria-labelledby="historial" className="rounded-[var(--radius-card)] border border-line bg-white p-5">
      <h2 id="historial" className="mb-3 text-xl">
        Historial
      </h2>
      <ol className="flex flex-col gap-2">
        {order.history.map((h, i) => (
          <li key={i} className="text-sm">
            <span className="font-bold">{orderStatusLabel[h.toStatus]}</span> · {formatDateTime(h.createdAt)}
            {h.changedBy !== undefined && (
              <span className="text-slate">
                {' '}
                · {h.changedBy ? `${h.changedBy.firstName} ${h.changedBy.lastName}` : 'Sistema'}
              </span>
            )}
            {h.note && <span className="block text-slate">{h.note}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function OrderReturns({ order }: { order: Order }) {
  if (order.returns.length === 0) return null;
  const name = (id: string) => order.items.find((i) => i.id === id)?.productName ?? 'Producto';
  return (
    <section aria-labelledby="devoluciones" className="rounded-[var(--radius-card)] border border-line bg-white p-5">
      <h2 id="devoluciones" className="mb-3 text-xl">
        Devoluciones
      </h2>
      <ul className="flex flex-col gap-3">
        {order.returns.map((r) => (
          <li key={r.id} className="border-b border-line pb-3 last:border-0 last:pb-0">
            <p className="font-bold">
              {returnStatusLabel[r.status]} · {formatMoney(r.refundAmount, r.currency)}
            </p>
            <p className="text-sm">{r.items.map((l) => `${l.quantity} × ${name(l.orderItemId)}`).join(', ')}</p>
            <p className="text-sm text-slate">Motivo: {r.reason}</p>
            {r.decisionNote && (
              <p className={r.status === 'REJECTED' ? 'font-bold text-danger' : 'text-slate'}>{r.decisionNote}</p>
            )}
            {r.refundedAt && (
              <p className="text-sm text-slate">
                Reembolsado el {formatDateTime(r.refundedAt)}
                {r.refundReference && ` · Ref. ${r.refundReference}`}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
