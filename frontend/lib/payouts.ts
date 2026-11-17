/** Shapes returned by GET /api/seller/payouts — see backend services/payouts.js. */
export type PayoutLine = {
  orderId: string;
  orderNumber: string;
  paymentMethod: 'cod' | 'online';
  deliveredAt: string | null;
  status: string;
  courierName: string;
  itemTotal: number;
  courierCharge: number | null;
  gatewayCharge: number;
  refunds: number;
  net: number;
  flags: Array<'courier_charge_missing' | 'gateway_fee_missing'>;
};

export type PayoutTotals = {
  orders: number; itemTotal: number; courierCharge: number; gatewayCharge: number; refunds: number; net: number; missing: number;
};

export type PayoutWeek = {
  weekKey: string;
  periodStart: string;
  periodEnd: string;
  lines: PayoutLine[];
  totals: PayoutTotals;
  status: 'in_progress' | 'due' | 'paid';
  settlement: { amountPaid: number; utr: string; paidAt: string; note: string } | null;
};

export type PayoutSummary = {
  ok: true;
  /** Parcels on their way — charges known, but not in a week until delivered. */
  inTransit: { lines: PayoutLine[]; totals: PayoutTotals };
  thisWeek: PayoutWeek | null;
  due: number;
  paidLifetime: number;
  weeks: PayoutWeek[];
};

export const inr2 = (n: number | null | undefined) =>
  n == null ? '—' : `₹${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;

/** "22–28 Sep 2026" — a settlement week, end shown as the Sunday. */
export function weekLabel(periodStart: string, periodEnd: string) {
  const s = new Date(periodStart);
  const e = new Date(new Date(periodEnd).getTime() - 1);
  const fmt = (d: Date, withMonth: boolean) =>
    d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', ...(withMonth ? { month: 'short' } : {}) });
  const sameMonth = s.getMonth() === e.getMonth();
  const year = e.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric' });
  return `${fmt(s, !sameMonth)}–${fmt(e, true)} ${year}`;
}

/** Short status words for an in-transit payout line (mirrors orderStatusDisplay). */
export function transitLabel(status: string): { label: string; status: string } {
  if (status === 'out_for_delivery') return { label: 'Out for delivery', status: 'out_for_delivery' };
  if (status === 'undelivered') return { label: 'Delivery failed', status: 'delivery_failed' };
  if (status === 'awb') return { label: 'Awaiting pickup', status: 'awaiting_pickup' };
  return { label: 'In transit', status: 'in_transit' };
}
