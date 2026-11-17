'use client';

/**
 * Invoice preview for an offline sale
 * (/dashboard/offline-sales/[id]/invoice — opened in a new tab from the
 * offline-sales list).
 *
 * Two shapes, chosen by `sale.invoiceType`:
 *   - gst      → TAX INVOICE under the seller's GSTIN. The total is GST
 *                inclusive at the sale's rate, split into taxable value
 *                + CGST/SGST (buyer in seller's state) or IGST (buyer in
 *                another state).
 *   - non_gst  → plain INVOICE, no tax lines.
 *
 * The sheet itself lives in components/common/OfflineInvoiceDocument.tsx
 * (also used by the list's "Download" action to build the PDF).
 *
 * Backend: GET /seller/offline-sales/:id/invoice → { sale, seller }
 */

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, unwrap } from '@/lib/api';
import OfflineInvoiceDocument, {
  type InvoiceSale,
  type InvoiceSeller,
} from '@/components/common/OfflineInvoiceDocument';
import { apiMessage } from '@/lib/notify';

export default function OfflineSaleInvoicePage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || '');

  const [sale, setSale] = useState<InvoiceSale | null>(null);
  const [seller, setSeller] = useState<InvoiceSeller | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api
      .get(`/seller/offline-sales/${id}/invoice`)
      .then((r) => {
        const data = unwrap<{ sale?: any; seller?: any }>(r);
        setSale(data?.sale || null);
        setSeller(data?.seller || null);
      })
      .catch((e: any) => {
        const status = e?.response?.status;
        setError(
          status === 401
            ? 'Please sign in to the seller portal to view this invoice.'
            : apiMessage(e) || 'Could not load the invoice.',
        );
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <div className="min-h-screen grid place-items-center text-sm text-muted">Loading invoice…</div>;
  }
  if (error || !sale || !seller) {
    return (
      <div className="min-h-screen grid place-items-center px-4">
        <div className="max-w-md rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          {error || 'Invoice not found.'}
        </div>
      </div>
    );
  }

  const isGst = sale.invoiceType === 'gst';

  return (
    <div className="min-h-screen bg-default-100 py-6 px-4">
      {/* Toolbar */}
      <div className="mx-auto mb-4 flex max-w-[800px] flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-default-600">
          {isGst ? 'Tax invoice' : 'Invoice'} {sale.invoiceNumber}
        </div>
        <button
          className="h-9 rounded-md border border-default-300 bg-white px-4 text-sm font-semibold text-brand-black"
          onClick={() => window.close()}
          type="button"
        >
          Close
        </button>
      </div>

      <OfflineInvoiceDocument sale={sale} seller={seller} />
    </div>
  );
}
