/**
 * Shared helpers for offline-sale invoices — used by the record/edit
 * form (live GST preview) and the printable invoice page.
 *
 * GST is INCLUSIVE at a seller-entered rate: the sale total never
 * changes; a GST invoice only splits it into taxable value + GST, shown as
 *   intra-state (buyer in the seller's state) → CGST + SGST, half each
 *   inter-state (buyer in another state)      → IGST, the full amount
 * Must stay in step with `computeTax` in
 * backend/src/controllers/offlineSaleController.js.
 */

/** Default rate pre-filled in the form. */
export const DEFAULT_GST_RATE = 18;
/** Quick-pick chips next to the rate input. */
export const COMMON_GST_RATES = [5, 12, 18, 28, 40];

export type InvoiceType = 'non_gst' | 'gst';
export type SupplyType = 'intra' | 'inter';

/** Names match DashboardProfilePage's list (and checkout addresses). */
export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim',
  'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand',
  'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi',
  'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
];

/** Buyer's state vs seller's state → supply type (unknown → intra). */
export function supplyTypeFor(buyerState?: string, sellerState?: string): SupplyType {
  const a = String(buyerState || '').trim().toLowerCase();
  const b = String(sellerState || '').trim().toLowerCase();
  return a && b && a !== b ? 'inter' : 'intra';
}

export type OfflineBuyer = {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  state?: string;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Split an inclusive total into taxable value + GST at `rate`, then
 *  into CGST/SGST (intra) or IGST (inter). */
export function splitGst(total: number, rate: number, supplyType: SupplyType = 'intra') {
  const safe = Number.isFinite(total) ? total : 0;
  const r = Number.isFinite(rate) && rate > 0 ? rate : 0;
  const taxable = round2(safe / (1 + r / 100));
  const gst = round2(safe - taxable);
  const inter = supplyType === 'inter';
  const cgst = inter ? 0 : round2(gst / 2);
  return {
    taxable,
    gst,
    cgst,
    sgst: inter ? 0 : round2(gst - cgst),
    igst: inter ? gst : 0,
  };
}

/** Rate shown as "9" or "2.5" (no trailing zeros). */
export const fmtRate = (n: number) => String(round2(n));

/** ₹ amount with paise, Indian grouping: 18,644.07 */
export const inr2 = (n: number) =>
  new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
  'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function below100(n: number): string {
  if (n < 20) return ONES[n];
  return TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : '');
}

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', r ? below100(r) : ''].filter(Boolean).join(' ');
}

/** Integer → words in the Indian system (lakh / crore). */
function intWords(n: number): string {
  if (n === 0) return 'Zero';
  const crore = Math.floor(n / 1e7);
  const lakh = Math.floor((n % 1e7) / 1e5);
  const thousand = Math.floor((n % 1e5) / 1000);
  const rest = n % 1000;
  return [
    crore ? `${intWords(crore)} Crore` : '',
    lakh ? `${below100(lakh)} Lakh` : '',
    thousand ? `${below100(thousand)} Thousand` : '',
    rest ? below1000(rest) : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** 22000 → "Rupees Twenty Two Thousand Only" */
export function amountInWords(amount: number): string {
  const safe = Math.max(0, Number.isFinite(amount) ? amount : 0);
  const rupees = Math.floor(safe);
  const paise = Math.round((safe - rupees) * 100);
  const r = `Rupees ${intWords(rupees)}`;
  return paise ? `${r} and ${below100(paise)} Paise Only` : `${r} Only`;
}
