'use client';

/**
 * The offline-sale invoice itself (A4-style sheet) — shared by the
 * invoice preview page (/dashboard/offline-sales/[id]/invoice) and the
 * "Download" action on the offline-sales list, which renders it off-screen
 * and saves it as a PDF. One layout, so the preview and the PDF match.
 *
 *   - gst      → TAX INVOICE under the seller's GSTIN. The total is GST
 *                inclusive at the sale's rate, split into taxable value
 *                + CGST/SGST (buyer in seller's state) or IGST (buyer in
 *                another state).
 *   - non_gst  → plain INVOICE, no tax lines.
 */

import {
  DEFAULT_GST_RATE,
  amountInWords,
  fmtRate,
  inr2,
  splitGst,
  type InvoiceType,
  type OfflineBuyer,
  type SupplyType,
} from '@/lib/offlineInvoice';

export type InvoiceSale = {
  _id: string;
  productName: string;
  variant?: { size?: string; color?: string };
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  note?: string;
  saleDate: string;
  deletedAt?: string | null;
  invoiceType?: InvoiceType;
  invoiceNumber?: string;
  gstRate?: number;
  supplyType?: SupplyType;
  buyer?: OfflineBuyer;
};

export type InvoiceSeller = {
  storeName: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  state: string;
  gstin: string;
};

function formatLongDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function OfflineInvoiceDocument({
  sale,
  seller,
  forPdf = false,
}: {
  sale: InvoiceSale;
  seller: InvoiceSeller;
  /** Flat sheet at a fixed width (no card border / shadow) for PDF export. */
  forPdf?: boolean;
}) {
  const isGst = sale.invoiceType === 'gst';
  const rate = sale.gstRate && sale.gstRate > 0 ? sale.gstRate : DEFAULT_GST_RATE;
  const inter = sale.supplyType === 'inter';
  const total = Number(sale.totalAmount) || 0;
  const split = splitGst(total, rate, inter ? 'inter' : 'intra');
  const unitSplit = splitGst(Number(sale.unitPrice) || 0, rate);
  // Place of supply: the seller's state for a within-state sale. For an
  // other-state sale it's the buyer's state, which isn't collected — so
  // it's only shown when an older sale has one stored.
  const placeOfSupply = sale.buyer?.state || (inter ? '' : seller.state);
  const variantText = [sale.variant?.size, sale.variant?.color].filter(Boolean).join(' · ');
  const buyer = sale.buyer || {};
  const hasBuyer = Boolean(buyer.name || buyer.phone || buyer.email || buyer.address);
  const cancelled = Boolean(sale.deletedAt);

  return (
    <div
      className={`relative overflow-hidden bg-white p-8 text-[13px] leading-relaxed text-neutral-900 ${
        forPdf ? 'w-[800px]' : 'mx-auto max-w-[800px] rounded-lg border border-default-200 shadow-sm'
      }`}
    >
      {cancelled && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <span className="-rotate-12 rounded border-4 border-rose-500/40 px-6 py-2 text-5xl font-extrabold tracking-widest text-rose-500/40">
            CANCELLED
          </span>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-300 pb-4">
        <div className="min-w-0">
          <div className="text-xl font-extrabold">{seller.storeName || seller.name}</div>
          {seller.address && <div className="max-w-sm text-neutral-700">{seller.address}</div>}
          <div className="text-neutral-700">
            {[seller.phone, seller.email].filter(Boolean).join(' · ')}
          </div>
          {isGst && seller.gstin && (
            <div className="mt-1 font-semibold">GSTIN: {seller.gstin}</div>
          )}
        </div>
        <div className="text-right">
          <div className="text-lg font-extrabold tracking-wide">
            {isGst ? 'TAX INVOICE' : 'INVOICE'}
          </div>
          <div>
            <span className="text-neutral-600">Invoice no:</span>{' '}
            <span className="font-semibold">{sale.invoiceNumber || '—'}</span>
          </div>
          <div>
            <span className="text-neutral-600">Date:</span>{' '}
            <span className="font-semibold">{formatLongDate(sale.saleDate)}</span>
          </div>
          {isGst && placeOfSupply && (
            <div>
              <span className="text-neutral-600">Place of supply:</span>{' '}
              <span className="font-semibold">{placeOfSupply}</span>
            </div>
          )}
        </div>
      </div>

      {/* Bill to */}
      <div className="border-b border-neutral-300 py-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Bill to</div>
        {hasBuyer ? (
          <>
            {buyer.name && <div className="font-semibold">{buyer.name}</div>}
            {buyer.address && <div className="max-w-md whitespace-pre-line text-neutral-700">{buyer.address}</div>}
            <div className="text-neutral-700">
              {[buyer.phone, buyer.email].filter(Boolean).join(' · ')}
            </div>
          </>
        ) : (
          <div className="font-semibold">Walk-in customer</div>
        )}
      </div>

      {/* Items */}
      <table className="mt-4 w-full border-collapse">
        <thead>
          <tr className="border-b border-neutral-400 text-left text-xs uppercase tracking-wider text-neutral-600">
            <th className="py-2 pr-2 font-semibold">#</th>
            <th className="py-2 pr-2 font-semibold">Item</th>
            <th className="py-2 pr-2 text-right font-semibold">Qty</th>
            {isGst ? (
              <>
                <th className="py-2 pr-2 text-right font-semibold">Rate (excl. GST)</th>
                <th className="py-2 pr-2 text-right font-semibold">Taxable value</th>
                <th className="py-2 pr-2 text-right font-semibold">
                  {inter ? 'IGST' : 'GST'} {fmtRate(rate)}%
                </th>
              </>
            ) : (
              <th className="py-2 pr-2 text-right font-semibold">Rate</th>
            )}
            <th className="py-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-neutral-200 align-top">
            <td className="py-2 pr-2">1</td>
            <td className="py-2 pr-2">
              <div className="font-semibold">{sale.productName}</div>
              {variantText && <div className="text-xs text-neutral-600">{variantText}</div>}
            </td>
            <td className="py-2 pr-2 text-right">{sale.quantity}</td>
            {isGst ? (
              <>
                <td className="py-2 pr-2 text-right">₹{inr2(unitSplit.taxable)}</td>
                <td className="py-2 pr-2 text-right">₹{inr2(split.taxable)}</td>
                <td className="py-2 pr-2 text-right">₹{inr2(split.gst)}</td>
              </>
            ) : (
              <td className="py-2 pr-2 text-right">₹{inr2(sale.unitPrice)}</td>
            )}
            <td className="py-2 text-right font-semibold">₹{inr2(total)}</td>
          </tr>
        </tbody>
      </table>

      {/* Totals */}
      <div className="mt-4 flex justify-end">
        <div className="w-full max-w-xs">
          {isGst && (
            <>
              <div className="flex justify-between py-0.5">
                <span className="text-neutral-600">Taxable value</span>
                <span>₹{inr2(split.taxable)}</span>
              </div>
              {inter ? (
                <div className="flex justify-between py-0.5">
                  <span className="text-neutral-600">IGST @ {fmtRate(rate)}%</span>
                  <span>₹{inr2(split.igst)}</span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between py-0.5">
                    <span className="text-neutral-600">CGST @ {fmtRate(rate / 2)}%</span>
                    <span>₹{inr2(split.cgst)}</span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span className="text-neutral-600">SGST @ {fmtRate(rate / 2)}%</span>
                    <span>₹{inr2(split.sgst)}</span>
                  </div>
                </>
              )}
            </>
          )}
          <div className="mt-1 flex justify-between border-t border-neutral-400 pt-2 text-base font-extrabold">
            <span>Total</span>
            <span>₹{inr2(total)}</span>
          </div>
        </div>
      </div>

      <div className="mt-3 border-t border-neutral-200 pt-3">
        <span className="text-neutral-600">Amount in words:</span>{' '}
        <span className="font-semibold">{amountInWords(total)}</span>
      </div>

      {sale.note && (
        <div className="mt-2">
          <span className="text-neutral-600">Note:</span> {sale.note}
        </div>
      )}

      {/* Footer */}
      <div className="mt-10 flex flex-wrap items-end justify-between gap-6">
        <div className="max-w-sm text-xs text-neutral-500">
          {isGst
            ? `Prices are inclusive of GST @ ${fmtRate(rate)}% (${inter ? 'IGST — inter-state supply' : 'CGST + SGST — intra-state supply'}). `
            : 'GST not charged on this invoice. '}
          This is a computer-generated invoice.
        </div>
        <div className="text-center">
          <div className="h-10" />
          <div className="border-t border-neutral-400 px-6 pt-1 text-xs text-neutral-600">
            For {seller.storeName || seller.name} — Authorised signatory
          </div>
        </div>
      </div>
    </div>
  );
}
