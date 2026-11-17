/**
 * Each seller slice's share of the order-level fees (audit A11).
 *
 * The customer's payable total includes the order-level shipping fee and
 * (for COD) the convenience fee, but every seller shipment used to carry
 * zero charges and only its merchandise subtotal — so the sum of carrier
 * collectibles never reconciled with what the customer owes (₹500 + ₹49 +
 * ₹30 recorded as ₹579 while the shipment said ₹500). Fees are allocated
 * across slices proportionally to merchandise value, giving any rounding
 * remainder to the largest slice so Σ(sub_total + shipping + cod) ===
 * order.total exactly.
 *
 * Delivery is NOT allocated proportionally: each seller's parcel was quoted
 * and paid for on its own, so the slice carries exactly the amount the
 * customer paid for THAT parcel. Sellers who absorb delivery carry ₹0, which
 * is the truth — the customer paid them nothing for it. (`order.delivery`
 * is empty on orders placed before this existed, and the proportional split
 * of `shippingFee` is used for those.)
 *
 * Shared by the Shiprocket push (carrier collectibles) and the tax invoice
 * (what the customer paid each seller), so the two can't drift.
 *
 * @returns {Map<string, { subtotal: number, shipping: number, codFee: number }>}
 */
'use strict';

function sliceCharges(order) {
  const subtotals = new Map();
  for (const it of order.items || []) {
    if (!it.seller) continue;
    const k = String(it.seller);
    subtotals.set(k, (subtotals.get(k) || 0) + (Number(it.subtotal) || 0));
  }
  const sliceKeys = [...subtotals.keys()];
  const merchTotal = sliceKeys.reduce((s, k) => s + subtotals.get(k), 0) || 1;
  const allocate = (fee) => {
    const alloc = new Map();
    let assigned = 0;
    for (const k of sliceKeys) {
      const share = Math.floor((fee * subtotals.get(k)) / merchTotal);
      alloc.set(k, share);
      assigned += share;
    }
    // Remainder → largest slice (stable, deterministic).
    if (fee - assigned > 0 && sliceKeys.length) {
      const largest = sliceKeys.reduce((a, b) => (subtotals.get(a) >= subtotals.get(b) ? a : b));
      alloc.set(largest, (alloc.get(largest) || 0) + (fee - assigned));
    }
    return alloc;
  };
  const paidDelivery = new Map((order.delivery || []).map((d) => [String(d.seller), Number(d.amount) || 0]));
  const shipping = paidDelivery.size
    ? new Map(sliceKeys.map((k) => [k, paidDelivery.get(k) || 0]))
    : allocate(Number(order.shippingFee) || 0);
  const codFee = allocate(order.paymentMethod === 'cod' ? Number(order.codFee) || 0 : 0);
  return new Map(
    sliceKeys.map((k) => [
      k,
      {
        subtotal: subtotals.get(k),
        shipping: shipping.get(k) || 0,
        codFee: codFee.get(k) || 0,
      },
    ]),
  );
}

module.exports = { sliceCharges };
