/**
 * GST on offline sales. Pure.
 *
 * Every sale is either a GST tax invoice or a non-GST bill. GST is
 * INCLUSIVE: `totalAmount` is what the buyer paid and what revenue sums,
 * and it never changes with the invoice type. A GST invoice splits that
 * total into taxable value + GST at the rate the seller entered:
 *   intra-state (buyer in the seller's state) → CGST + SGST (half each)
 *   inter-state (buyer in another state)      → IGST (the full amount)
 * Must stay in step with `splitGst` in frontend/lib/offlineInvoice.ts.
 */

/** Rate used when the seller does not send one. */
const DEFAULT_GST_RATE = 18;

const round2 = (n) => Math.round(n * 100) / 100;

function computeTax(totalAmount, invoiceType, gstRate, supplyType) {
  if (invoiceType !== 'gst') {
    return {
      gstRate: 0,
      supplyType: 'intra',
      taxableAmount: totalAmount,
      gstAmount: 0,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 0,
    };
  }
  const taxableAmount = round2(totalAmount / (1 + gstRate / 100));
  const gstAmount = round2(totalAmount - taxableAmount);
  const inter = supplyType === 'inter';
  const cgstAmount = inter ? 0 : round2(gstAmount / 2);
  return {
    gstRate,
    supplyType: inter ? 'inter' : 'intra',
    taxableAmount,
    gstAmount,
    cgstAmount,
    sgstAmount: inter ? 0 : round2(gstAmount - cgstAmount),
    igstAmount: inter ? gstAmount : 0,
  };
}

/** The seller-entered rate: a number in (0, 100], the fallback when blank, or null when invalid. */
function readGstRate(v, fallback = DEFAULT_GST_RATE) {
  if (v === undefined || v === null || v === '') return fallback;
  const n = round2(Number(v));
  if (!Number.isFinite(n) || n <= 0 || n > 100) return null;
  return n;
}

const sameState = (a, b) =>
  String(a || '')
    .trim()
    .toLowerCase() ===
  String(b || '')
    .trim()
    .toLowerCase();

/** An explicit choice wins; otherwise the buyer's state vs the seller's pickup state (unknown → intra). */
function resolveSupplyType(explicit, buyerState, sellerState) {
  if (explicit === 'inter' || explicit === 'intra') return explicit;
  if (buyerState && sellerState && !sameState(buyerState, sellerState)) return 'inter';
  return 'intra';
}

const normalizeInvoiceType = (v) => (String(v || '').trim() === 'gst' ? 'gst' : 'non_gst');

module.exports = { DEFAULT_GST_RATE, computeTax, readGstRate, resolveSupplyType, normalizeInvoiceType };
