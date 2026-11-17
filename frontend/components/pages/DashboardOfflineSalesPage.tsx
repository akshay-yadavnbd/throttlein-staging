'use client';

/**
 * Seller dashboard — Offline sales log (/dashboard/offline-sales).
 *
 * A lightweight POS log for walk-in / offline transactions. Each sale
 * recorded here decrements stock on the linked Product (variant row
 * if applicable). Delete soft-deletes and refills stock; Edit changes
 * qty/price/date/note/invoice and moves stock by the quantity delta.
 *
 * Every sale has an invoice (printable page at
 * /dashboard/offline-sales/[id]/invoice). The With/Without GST switch
 * only changes the invoice: GST is INCLUSIVE at the rate the seller
 * enters, so the recorded total and revenue never change. Buyer in the
 * seller's state → CGST + SGST; buyer in another state → IGST.
 *
 * Layout mirrors DashboardOffersPage's visual language: breadcrumb,
 * SALES LOG eyebrow, bold h1, subtitle, KPI tile row, filter card,
 * table card. Newest first.
 *
 * Backend contract — see backend/src/controllers/offlineSaleController.js:
 *   GET    /seller/offline-sales             { items, total, totalRevenue, totalUnits }
 *   POST   /seller/offline-sales             { sale, productStock }
 *   PATCH  /seller/offline-sales/:id         { sale }
 *   DELETE /seller/offline-sales/:id
 *   GET    /seller/offline-sales/:id/invoice { sale, seller }
 *   GET    /seller/offline-sales/products-lookup?q=…
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import Link from 'next/link';
import { Card, CardBody, Spinner, Switch, Textarea, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure } from '@heroui/react';
import Button from '@/components/common/SellerButton';
import Arrow from '@/components/common/Arrow';
import SellerSelect from '@/components/common/SellerSelect';
import SellerDatePicker from '@/components/common/SellerDatePicker';
import styles from './DashboardOfflineSales.module.css';
import { api, unwrap, unwrapMeta } from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import { saveElementAsPdf } from '@/lib/offlineInvoicePdf';
import OfflineInvoiceDocument, {
  type InvoiceSale,
  type InvoiceSeller,
} from '@/components/common/OfflineInvoiceDocument';
import {
  COMMON_GST_RATES,
  DEFAULT_GST_RATE,
  fmtRate,
  inr2,
  splitGst,
  type InvoiceType,
  type OfflineBuyer,
  type SupplyType,
} from '@/lib/offlineInvoice';
import { notifyError, notifySuccess, apiMessage } from '@/lib/notify';
import { M } from '@/lib/messages';

/* ─── types ───────────────────────────────────────────────────────── */

type OfflineSale = {
  _id: string;
  product: string;
  productName: string;
  productSlug?: string;
  variant?: { size?: string; color?: string };
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  note?: string;
  saleDate: string;
  createdAt?: string;
  deletedAt?: string | null;
  invoiceType?: InvoiceType;
  invoiceNumber?: string;
  gstRate?: number;
  supplyType?: SupplyType;
  taxableAmount?: number;
  gstAmount?: number;
  buyer?: OfflineBuyer;
  editedAt?: string | null;
  /** The product was deleted from the catalog after this sale. Such sales
   *  only show under "Include deleted sales". */
  productDeleted?: boolean;
};

type ProductVariant = {
  size?: string;
  color?: string;
  stock?: number;
  sku?: string;
};

type LookupProduct = {
  _id: string;
  name: string;
  slug?: string;
  price: number;
  stock: number;
  sku?: string;
  variants?: ProductVariant[];
};

/* ─── helpers ─────────────────────────────────────────────────────── */

const PAGE_SIZE = 30;

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(
    Number.isFinite(n) ? n : 0,
  );

function formatDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Build a per-variant stock lookup keyed by "size||color". */
function variantKey(size: string, color: string): string {
  return `${size}||${color}`;
}

/* ─── main page ───────────────────────────────────────────────────── */

export default function DashboardOfflineSalesPage() {
  const latestFilterDate = todayISO();
  const [items, setItems] = useState<OfflineSale[]>([]);
  const [total, setTotal] = useState(0);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalUnits, setTotalUnits] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [productFilter, setProductFilter] = useState<string>('all');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const salesRequestId = useRef(0);

  const [busyId, setBusyId] = useState<string | null>(null);
  // Seller's KYC GSTIN — GST invoices are only possible when it's set.
  const [sellerGstin, setSellerGstin] = useState('');
  // Seller's pickup state — compared with the buyer's state to choose
  // CGST+SGST (same state) vs IGST (other state).
  const [sellerState, setSellerState] = useState('');
  // null → the modal records a new sale; a sale → the modal edits it.
  const [editing, setEditing] = useState<OfflineSale | null>(null);
  // Invoice being turned into a PDF — rendered off-screen while it's saved.
  const [pdfJob, setPdfJob] = useState<{ sale: InvoiceSale; seller: InvoiceSeller } | null>(null);
  const pdfRef = useRef<HTMLDivElement>(null);

  const recordModal = useDisclosure();

  function openRecord() {
    setEditing(null);
    recordModal.onOpen();
  }

  function openEdit(sale: OfflineSale) {
    setEditing(sale);
    recordModal.onOpen();
  }

  // Debounce filters — the date inputs fire on each keystroke while
  // typing yyyy-mm-dd, and hammering the backend on every char is rude.
  const [filterKey, setFilterKey] = useState(0);
  useEffect(() => {
    const id = setTimeout(() => setFilterKey((k) => k + 1), 300);
    return () => {
      clearTimeout(id);
      // Ignore responses for filters that have since changed or unmounted.
      salesRequestId.current += 1;
    };
  }, [from, to, productFilter, includeDeleted]);

  // ISO yyyy-mm-dd strings compare correctly as plain strings.
  const today = todayISO();
  const rangeInvalid = Boolean(from && to && from > to);
  const fromError = from > today
    ? "'From' date can't be in the future."
    : rangeInvalid ? "'From' date can't be after 'To' date." : undefined;
  const toError = to > today
    ? "'To' date can't be in the future."
    : rangeInvalid ? "'To' date can't be before 'From' date." : undefined;
  const dateFiltersInvalid = Boolean(fromError || toError);

  function load() {
    const requestId = ++salesRequestId.current;
    // Never query an inverted range — it can only ever return nothing and
    // makes the page look broken. The inline error explains what to fix.
    if (dateFiltersInvalid) {
      setItems([]);
      setTotal(0);
      setTotalRevenue(0);
      setTotalUnits(0);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const params: Record<string, string | number | boolean> = {
      page,
      limit: PAGE_SIZE,
    };
    if (from) params.from = from;
    if (to) params.to = to;
    if (productFilter && productFilter !== 'all') params.product = productFilter;
    if (includeDeleted) params.includeDeleted = 'true';
    api
      .get('/seller/offline-sales', { params })
      .then((r) => {
        if (requestId !== salesRequestId.current) return;
        const { data, meta } = unwrapMeta<{ items?: any[]; totalRevenue?: number; totalUnits?: number; sellerGstin?: string; sellerState?: string }>(r);
        setItems(Array.isArray(data?.items) ? data.items : []);
        setTotal(meta?.totalItems || 0);
        setTotalRevenue(data?.totalRevenue || 0);
        setTotalUnits(data?.totalUnits || 0);
        setSellerGstin(String(data?.sellerGstin || ''));
        setSellerState(String(data?.sellerState || ''));
      })
      .catch((e: any) => {
        if (requestId !== salesRequestId.current) return;
        setItems([]);
        setTotal(0);
        setTotalRevenue(0);
        setTotalUnits(0);
        setError(apiMessage(e) || 'Could not load offline sales.');
      })
      .finally(() => {
        if (requestId === salesRequestId.current) setLoading(false);
      });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, filterKey]);

  // Download: fetch the invoice data, render the same sheet the preview page
  // shows (off-screen) and save it as a PDF.
  async function downloadInvoice(sale: OfflineSale) {
    setBusyId(sale._id);
    try {
      const data = unwrap<{ sale?: any; seller?: any }>(await api.get(`/seller/offline-sales/${sale._id}/invoice`));
      if (!data?.sale || !data?.seller) throw new Error('Invoice not found.');
      // Render synchronously so the sheet is in the DOM for the snapshot.
      flushSync(() => setPdfJob({ sale: data.sale, seller: data.seller }));
      if (!pdfRef.current) throw new Error('Could not render the invoice.');
      await saveElementAsPdf(
        pdfRef.current,
        `${data.sale.invoiceNumber || `invoice-${sale._id}`}.pdf`,
      );
    } catch (e: any) {
      notifyError(e, M.offlineSales.couldntDownloadTheInvoice);
    } finally {
      setPdfJob(null);
      setBusyId(null);
    }
  }

  function previewInvoice(sale: OfflineSale) {
    window.open(invoiceHref(sale._id), '_blank', 'noopener,noreferrer');
  }

  async function deleteSale(sale: OfflineSale) {
    if (
      !(await confirmDialog({
        title: 'Delete this sale?',
        message:
          'Stock will be refilled and the sale removed from your list and revenue. It stays visible under "Include deleted sales" for your records. This cannot be undone — you would have to record the sale again.',
        destructive: true,
        confirmLabel: 'Delete sale',
      }))
    ) {
      return;
    }
    setBusyId(sale._id);
    try {
      await api.delete(`/seller/offline-sales/${sale._id}`);
      notifySuccess(M.offlineSales.saleDeletedStockRefilled);
      load();
    } catch (e: any) {
      notifyError(e, M.offlineSales.couldntDeleteSale);
    } finally {
      setBusyId(null);
    }
  }

  // Unique products present in the CURRENT list — used to seed the
  // product filter dropdown without a separate fetch.
  const productChoices = useMemo(() => {
    const seen = new Map<string, string>();
    for (const it of items) {
      if (!seen.has(it.product)) seen.set(it.product, it.productName || 'Untitled');
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [items]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const filterActive = Boolean(from || to || productFilter !== 'all' || includeDeleted);
  const emptyReason: 'empty' | 'filtered' | null = useMemo(() => {
    if (loading) return null;
    if (total > 0) return null;
    if (filterActive) return 'filtered';
    return 'empty';
  }, [loading, total, filterActive]);

  return (
    <div className={styles.page}>
      <h1 className="sr-only">Offline sales</h1>
      {(loading || error || emptyReason !== 'empty') && <div className="flex flex-wrap items-center justify-end gap-3 mb-5"><Button className={styles.primary} onPress={openRecord}>+ Record a sale</Button></div>}
      <div className={styles.summary}>
        <KpiTile label="Sales revenue" value={loading || error ? '—' : '₹' + inr(totalRevenue)} hint="For the selected filters" accent />
        <KpiTile label="Sales recorded" value={loading || error ? '—' : inr(total)} hint="Transactions in this view" />
        <KpiTile label="Units sold" value={loading || error ? '—' : inr(totalUnits)} hint="For the selected filters" />
      </div>
      <section className={styles.workspace} aria-label="Sales history">
      <div className={styles.listHeader}><h2>Sales history</h2><p>Find a sale to view its invoice or update the details.</p></div>
      {/* Filter bar */}
      <div className={styles.filterCard}>
        <div className={styles.filters}>
          <div className={styles.filterControls}>
          <div className={styles.dateFilter}>
            <label htmlFor="offline-from" className={styles.filterLabel}>
              From
            </label>
            <SellerDatePicker id="offline-from" ariaLabel="From date" value={from} max={to && to < latestFilterDate ? to : latestFilterDate} onChange={value => { if (value && (value > latestFilterDate || (to && value > to))) return; setFrom(value); setPage(1); }} />
          </div>
          <div className={styles.dateFilter}>
            <label htmlFor="offline-to" className={styles.filterLabel}>
              To
            </label>
            <SellerDatePicker id="offline-to" ariaLabel="To date" value={to} min={from || undefined} max={latestFilterDate} onChange={value => { if (value && (value > latestFilterDate || (from && value < from))) return; setTo(value); setPage(1); }} />
          </div>
          <div className={styles.productFilter}><span className={styles.filterLabel}>Product</span><SellerSelect ariaLabel="Product filter" value={productFilter} onChange={v => { setProductFilter(v); setPage(1); }} options={[{value:'all',label:'All products'}, ...productChoices.map(p => ({value:p.id,label:p.name}))]} fullWidth /></div>
          </div>

          <div className={styles.filterActions}>
            <Switch
              size="sm"
              aria-label="Include deleted sales"
              isSelected={includeDeleted}
              onValueChange={(v) => {
                setIncludeDeleted(v);
                setPage(1);
              }}
            ><span className={styles.deletedLabel}>Include deleted sales</span></Switch>
          {filterActive && (
            <Button
              size="sm"
              className={styles.clearFilters}
              onPress={() => {
                setFrom('');
                setTo('');
                setProductFilter('all');
                setIncludeDeleted(false);
                setPage(1);
              }}
            >
              Clear filters
            </Button>
          )}
          </div>
        </div>
      </div>

      <Card className={styles.listCard} shadow="none">
        <CardBody className="p-0">
          {loading ? (
            <div className="flex items-center gap-2 text-muted py-16 justify-center">
              <Spinner size="sm" /> Loading sales…
            </div>
          ) : error ? (
            <div className="m-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
              {error} <button type="button" className="ml-3 underline" onClick={load}>Try again</button>
            </div>
          ) : emptyReason === 'empty' ? (
            <EmptyState onRecord={openRecord} />
          ) : emptyReason === 'filtered' ? (
            <FilteredEmpty
              onClear={() => {
                setFrom('');
                setTo('');
                setProductFilter('all');
                setIncludeDeleted(false);
                setPage(1);
              }}
            />
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className={styles.table}>
                  <thead className="bg-default-50 text-default-600 text-xs uppercase tracking-wider">
                    <tr>
                      <th className="text-left px-6 py-3 font-semibold">Date</th>
                      <th className="text-left px-6 py-3 font-semibold">Product</th>
                      <th className="text-right px-6 py-3 font-semibold">Qty</th>
                      <th className="text-right px-6 py-3 font-semibold">Unit ₹</th>
                      <th className="text-right px-6 py-3 font-semibold">Total ₹</th>
                      <th className="text-right px-6 py-3 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => (
                      <SaleRow
                        key={it._id}
                        sale={it}
                        busy={busyId === it._id}
                        onDelete={() => deleteSale(it)}
                        onDownload={() => downloadInvoice(it)}
                        onEdit={() => openEdit(it)}
                        onPreview={() => previewInvoice(it)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile stacked cards */}
              <div className="md:hidden flex flex-col divide-y divide-default-200">
                {items.map((it) => (
                  <SaleCardMobile
                    key={it._id}
                    sale={it}
                    busy={busyId === it._id}
                    onDelete={() => deleteSale(it)}
                    onDownload={() => downloadInvoice(it)}
                    onEdit={() => openEdit(it)}
                    onPreview={() => previewInvoice(it)}
                  />
                ))}
              </div>

              {totalPages > 1 && (
                <div className="px-6 py-4 flex items-center justify-between gap-3 border-t border-default-200">
                  <Button
                    size="sm"
                    variant="bordered"
                    isDisabled={page <= 1}
                    onPress={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <Arrow dir="left" /> Prev
                  </Button>
                  <div className="text-xs text-muted">
                    Showing {(page - 1) * PAGE_SIZE + 1}–
                    {Math.min(page * PAGE_SIZE, total)} of {total}
                  </div>
                  <Button
                    size="sm"
                    variant="bordered"
                    isDisabled={page >= totalPages}
                    onPress={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next <Arrow />
                  </Button>
                </div>
              )}
            </>
          )}
        </CardBody>
      </Card>
      </section>

      {/* Off-screen invoice sheet used only while building a PDF download. */}
      {pdfJob && (
        <div
          aria-hidden
          style={{ position: 'fixed', left: -10000, top: 0, pointerEvents: 'none' }}
        >
          <div ref={pdfRef}>
            <OfflineInvoiceDocument forPdf sale={pdfJob.sale} seller={pdfJob.seller} />
          </div>
        </div>
      )}

      <SaleFormModal
        isOpen={recordModal.isOpen}
        onClose={recordModal.onClose}
        editing={editing}
        sellerGstin={sellerGstin}
        sellerState={sellerState}
        onSaved={() => {
          load();
        }}
      />
    </div>
  );
}

/* ─── KPI tile ─────────────────────────────────────────────────────── */

function KpiTile({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return <div className={styles.metric} data-accent={accent || undefined}><p>{label}</p><strong>{value}</strong><span>{hint}</span></div>;
}

/* ─── row helpers ──────────────────────────────────────────────────── */

const invoiceHref = (id: string) => `/dashboard/offline-sales/${id}/invoice`;

function InvoiceBadge({ sale }: { sale: OfflineSale }) {
  const gst = sale.invoiceType === 'gst';
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${
        gst
          ? 'border-sky-200 bg-sky-50 text-sky-800'
          : 'border-default-200 bg-default-50 text-default-600'
      }`}
    >
      {gst
        ? `GST ${fmtRate(sale.gstRate || 0)}% · ${sale.supplyType === 'inter' ? 'IGST' : 'CGST+SGST'}`
        : 'No GST'}
    </span>
  );
}

type ActionKey = 'download' | 'preview' | 'edit' | 'delete';

/** Row actions behind a three-dot menu: Download · Preview · Edit · Delete.
 *  Deleted sales — and sales whose product was deleted (no stock row left
 *  to adjust) — keep Download / Preview only. */
function SaleActions({
  sale,
  busy,
  onDownload,
  onPreview,
  onEdit,
  onDelete,
}: {
  sale: OfflineSale;
  busy: boolean;
  onDownload: () => void;
  onPreview: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const deleted = Boolean(sale.deletedAt) || Boolean(sale.productDeleted);
  const items: { key: ActionKey; label: string; danger?: boolean }[] = [
    { key: 'download', label: 'Download' },
    { key: 'preview', label: 'Preview' },
    ...(deleted
      ? []
      : [
          { key: 'edit' as const, label: 'Edit' },
          { key: 'delete' as const, label: 'Delete', danger: true },
        ]),
  ];
  return (
    <Dropdown placement="bottom-end">
      <DropdownTrigger>
        <Button
          aria-label="Sale actions"
          className="h-8 w-8 min-w-8"
          isIconOnly
          isLoading={busy}
          size="sm"
          variant="light"
        >
          <svg
            aria-hidden
            className="h-5 w-5"
            fill="currentColor"
            viewBox="0 0 24 24"
          >
            <circle cx="12" cy="5" r="1.75" />
            <circle cx="12" cy="12" r="1.75" />
            <circle cx="12" cy="19" r="1.75" />
          </svg>
        </Button>
      </DropdownTrigger>
      <DropdownMenu
        aria-label="Sale actions"
        items={items}
        onAction={(key: any) => {
          if (key === 'download') onDownload();
          else if (key === 'preview') onPreview();
          else if (key === 'edit') onEdit();
          else if (key === 'delete') onDelete();
        }}
      >
        {(item: { key: ActionKey; label: string; danger?: boolean }) => (
          <DropdownItem
            className={item.danger ? 'text-danger' : undefined}
            color={item.danger ? 'danger' : 'default'}
            key={item.key}
          >
            {item.label}
          </DropdownItem>
        )}
      </DropdownMenu>
    </Dropdown>
  );
}

/* ─── one sale row (desktop table) ─────────────────────────────────── */

function SaleRow({
  sale,
  busy,
  onDownload,
  onPreview,
  onEdit,
  onDelete,
}: {
  sale: OfflineSale;
  busy: boolean;
  onDownload: () => void;
  onPreview: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const deleted = Boolean(sale.deletedAt);
  const variantBits = [sale.variant?.size || '', sale.variant?.color || '']
    .filter(Boolean)
    .join(' · ');
  return (
    <tr className={`border-t border-default-200 ${deleted || sale.productDeleted ? 'opacity-60' : ''}`}>
      <td className="px-6 py-3 whitespace-nowrap text-default-700">
        {formatDate(sale.saleDate)}
        {sale.invoiceNumber && (
          <div className="text-xs text-muted">{sale.invoiceNumber}</div>
        )}
      </td>
      <td className="px-6 py-3">
        <div className="font-semibold text-brand-black">{sale.productName || 'Untitled'}</div>
        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
          <InvoiceBadge sale={sale} />
          {variantBits && (
            <span className="inline-flex items-center rounded-full border border-default-200 bg-default-50 px-2 py-0.5 text-xs font-semibold text-default-600">
              {variantBits}
            </span>
          )}
          {deleted && (
            <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">
              Deleted
            </span>
          )}
          {sale.productDeleted && (
            <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">
              Product deleted
            </span>
          )}
        </div>
        {sale.buyer?.name && (
          <div className="text-xs text-default-600 mt-1">
            Buyer: {sale.buyer.name}
            {sale.buyer.phone ? ` · ${sale.buyer.phone}` : ''}
          </div>
        )}
        {sale.note && (
          <div className="text-xs text-muted mt-1 line-clamp-1">{sale.note}</div>
        )}
      </td>
      <td className="px-6 py-3 text-right font-semibold">{sale.quantity}</td>
      <td className="px-6 py-3 text-right">₹{inr(sale.unitPrice)}</td>
      <td className="px-6 py-3 text-right font-semibold text-brand-black">
        ₹{inr(sale.totalAmount)}
        {sale.invoiceType === 'gst' && (
          <div className="text-xs font-normal text-muted">
            incl. GST ₹{inr2(sale.gstAmount || 0)}
          </div>
        )}
      </td>
      <td className="px-6 py-3 text-right whitespace-nowrap">
        <SaleActions
          busy={busy}
          onDelete={onDelete}
          onDownload={onDownload}
          onEdit={onEdit}
          onPreview={onPreview}
          sale={sale}
        />
      </td>
    </tr>
  );
}

/* ─── mobile sale card ─────────────────────────────────────────────── */

function SaleCardMobile({
  sale,
  busy,
  onDownload,
  onPreview,
  onEdit,
  onDelete,
}: {
  sale: OfflineSale;
  busy: boolean;
  onDownload: () => void;
  onPreview: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const deleted = Boolean(sale.deletedAt);
  const variantBits = [sale.variant?.size || '', sale.variant?.color || '']
    .filter(Boolean)
    .join(' · ');
  return (
    <div className={`px-5 py-4 ${deleted || sale.productDeleted ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs text-muted">
            {formatDate(sale.saleDate)}
            {sale.invoiceNumber ? ` · ${sale.invoiceNumber}` : ''}
          </div>
          <div className="font-semibold text-brand-black truncate">
            {sale.productName || 'Untitled'}
          </div>
          {variantBits && (
            <div className="text-xs text-default-600 mt-0.5">{variantBits}</div>
          )}
          {sale.buyer?.name && (
            <div className="text-xs text-default-600 mt-0.5">Buyer: {sale.buyer.name}</div>
          )}
          {sale.note && (
            <div className="text-xs text-muted mt-1 line-clamp-2">{sale.note}</div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-lg font-extrabold text-brand-black">
            ₹{inr(sale.totalAmount)}
          </div>
          <div className="text-xs text-muted">
            {sale.quantity} × ₹{inr(sale.unitPrice)}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <InvoiceBadge sale={sale} />
          {deleted && (
            <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">
              Deleted
            </span>
          )}
          {sale.productDeleted && (
            <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">
              Product deleted
            </span>
          )}
        </div>
        <SaleActions
          busy={busy}
          onDelete={onDelete}
          onDownload={onDownload}
          onEdit={onEdit}
          onPreview={onPreview}
          sale={sale}
        />
      </div>
    </div>
  );
}

/* ─── empty states ─────────────────────────────────────────────────── */

function EmptyState({ onRecord }: { onRecord: () => void }) {
  return (
    <div className={styles.empty}>
      <div className="mx-auto w-12 h-12 rounded-full bg-white border border-default-200 grid place-items-center mb-4">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-6 h-6 text-muted"
          aria-hidden
        >
          <path d="M3 9l1.5-4h15L21 9" />
          <path d="M4 9v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9" />
          <path d="M9 13h6" />
          <path d="M9 17h6" />
        </svg>
      </div>
      <div className="text-sm font-semibold text-brand-black">
        No offline sales logged yet
      </div>
      <div className="text-xs text-muted mt-1 max-w-md mx-auto">
        Click <span className="font-semibold">Record a sale</span> to log your
        first walk-in transaction. Stock will update automatically.
      </div>
      <div className="mt-4">
        <Button size="sm" className={styles.primary} onPress={onRecord}>
          Record a sale
        </Button>
      </div>
    </div>
  );
}

function FilteredEmpty({ onClear }: { onClear: () => void }) {
  return (
    <div className={styles.empty}>
      <div className="text-sm font-semibold text-brand-black">
        No sales match these filters
      </div>
      <div className="text-xs text-muted mt-1">
        Try widening the date range or clearing the product filter.
      </div>
      <div className="mt-3">
        <Button size="sm" variant="bordered" onPress={onClear}>
          Clear filters
        </Button>
      </div>
    </div>
  );
}

/* ─── record / edit sale modal ─────────────────────────────────────── */

type BuyerForm = { name: string; phone: string; email: string; address: string };
const EMPTY_BUYER: BuyerForm = { name: '', phone: '', email: '', address: '' };
/** Exactly 10 digits — no letters, spaces or symbols. */
const PHONE_RE = /^\d{10}$/;

/** Keep digits only; drop a leading +91 / 91 / 0 from stored numbers so
 *  older sales still open with a clean 10-digit value. */
function normalizePhone(raw: string): string {
  let d = (raw || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d.slice(0, 10);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const fieldCls =
  'border border-default-300 rounded-md px-3 py-2 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-black disabled:opacity-60';

/** Local yyyy-mm-dd for a stored saleDate (for the date input). */
function isoToDateInput(iso?: string): string {
  if (!iso) return todayISO();
  const d = new Date(iso);
  if (isNaN(d.getTime())) return todayISO();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/** Dropdown styled like the page's Product filter (HeroUI Select) instead
 *  of the browser's native select element, so the modal matches the site
 *  theme. */
function ThemedSelect({
  ariaLabel,
  value,
  onChange,
  options,
  placeholder,
  isDisabled,
}: {
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  isDisabled?: boolean;
}) {
  return <SellerSelect ariaLabel={ariaLabel} value={value} onChange={onChange} options={value ? options : [{value:'',label:placeholder || 'Choose an option'}, ...options.filter(o => o.value !== '')]} disabled={isDisabled} fullWidth />;
}


function SaleFormModal({
  isOpen,
  onClose,
  onSaved,
  editing,
  sellerGstin,
  sellerState,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** null → record a new sale; a sale → edit it. */
  editing: OfflineSale | null;
  sellerGstin: string;
  sellerState: string;
}) {
  const isEdit = Boolean(editing);

  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [lookupItems, setLookupItems] = useState<LookupProduct[]>([]);
  const [lookupLoading, setLookupLoading] = useState(false);

  const [selected, setSelected] = useState<LookupProduct | null>(null);
  const [size, setSize] = useState('');
  const [color, setColor] = useState('');
  const [quantity, setQuantity] = useState<string>('1');
  const [unitPrice, setUnitPrice] = useState<string>('');
  const [note, setNote] = useState('');
  const [saleDate, setSaleDate] = useState<string>(todayISO());

  // Invoice
  const [invoiceType, setInvoiceType] = useState<InvoiceType>('non_gst');
  const [buyer, setBuyer] = useState<BuyerForm>(EMPTY_BUYER);
  const [gstRateInput, setGstRateInput] = useState(String(DEFAULT_GST_RATE));
  const [supplyType, setSupplyType] = useState<SupplyType>('intra');

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isGst = invoiceType === 'gst';
  const locked = submitting;

  // Reset / prefill on open.
  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setDebouncedQuery('');
    setLookupItems([]);
    setFormError(null);
    if (editing) {
      // The product is fixed while editing, so a minimal stand-in is
      // enough for the "selected" chip.
      setSelected({
        _id: editing.product,
        name: editing.productName,
        price: editing.unitPrice,
        stock: 0,
        variants: [],
      });
      setSize(editing.variant?.size || '');
      setColor(editing.variant?.color || '');
      setQuantity(String(editing.quantity));
      setUnitPrice(String(editing.unitPrice));
      setNote(editing.note || '');
      setSaleDate(isoToDateInput(editing.saleDate));
      const b = editing.buyer || {};
      setBuyer({
        name: b.name || '',
        phone: normalizePhone(b.phone || ''),
        email: b.email || '',
        address: b.address || '',
      });
      setInvoiceType(editing.invoiceType === 'gst' ? 'gst' : 'non_gst');
      setGstRateInput(
        String(editing.gstRate && editing.gstRate > 0 ? editing.gstRate : DEFAULT_GST_RATE),
      );
      setSupplyType(editing.supplyType === 'inter' ? 'inter' : 'intra');
    } else {
      setSelected(null);
      setSize('');
      setColor('');
      setQuantity('1');
      setUnitPrice('');
      setNote('');
      setSaleDate(todayISO());
      setBuyer(EMPTY_BUYER);
      setInvoiceType('non_gst');
      setGstRateInput(String(DEFAULT_GST_RATE));
      setSupplyType('intra');
    }
  }, [isOpen, editing]);

  // Debounce the search input — 250ms per spec.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  // Product lookup (record mode only — the product is fixed when editing).
  useEffect(() => {
    if (!isOpen || isEdit) return;
    setLookupLoading(true);
    api
      .get('/seller/offline-sales/products-lookup', {
        params: debouncedQuery ? { q: debouncedQuery } : {},
      })
      .then((r) => {
        const data = unwrap<{ items?: any[] }>(r);
        setLookupItems(Array.isArray(data?.items) ? data.items : []);
      })
      .catch(() => setLookupItems([]))
      .finally(() => setLookupLoading(false));
  }, [debouncedQuery, isOpen, isEdit]);

  const hasVariants = Boolean(!isEdit && selected && (selected.variants?.length || 0) > 0);

  const sizeOptions = useMemo(() => {
    if (!hasVariants || !selected) return [] as string[];
    const s = new Set<string>();
    for (const v of selected.variants || []) {
      if (v.size) s.add(String(v.size));
    }
    return Array.from(s);
  }, [hasVariants, selected]);

  const colorOptions = useMemo(() => {
    if (!hasVariants || !selected) return [] as string[];
    const s = new Set<string>();
    for (const v of selected.variants || []) {
      if (v.color) s.add(String(v.color));
    }
    return Array.from(s);
  }, [hasVariants, selected]);

  const variantStockMap = useMemo(() => {
    const m = new Map<string, number>();
    if (!selected || !selected.variants) return m;
    for (const v of selected.variants) {
      m.set(variantKey(String(v.size || ''), String(v.color || '')), Number(v.stock) || 0);
    }
    return m;
  }, [selected]);

  const availableStock: number = useMemo(() => {
    if (!selected) return 0;
    if (!hasVariants) return Number(selected.stock) || 0;
    if (sizeOptions.length > 0 && !size) return 0;
    if (colorOptions.length > 0 && !color) return 0;
    return variantStockMap.get(variantKey(size, color)) || 0;
  }, [selected, hasVariants, size, color, sizeOptions.length, colorOptions.length, variantStockMap]);

  const qtyNum = Math.max(0, Math.floor(Number(quantity) || 0));
  const priceNum = Number(unitPrice);
  const priceValid = unitPrice !== '' && Number.isFinite(priceNum) && priceNum >= 0;
  const computedTotal = priceValid ? Math.round(priceNum * qtyNum) : 0;
  const gstRateNum = Number(gstRateInput);
  const gstRateValid =
    gstRateInput.trim() !== '' && Number.isFinite(gstRateNum) && gstRateNum > 0 && gstRateNum <= 100;
  const gstSplit = splitGst(computedTotal, gstRateValid ? gstRateNum : 0, supplyType);

  function pickProduct(p: LookupProduct) {
    setSelected(p);
    setQuery(p.name);
    setSize('');
    setColor('');
    setUnitPrice(String(p.price ?? ''));
    setFormError(null);
  }

  function setBuyerField(key: keyof BuyerForm, value: string) {
    setBuyer((b) => ({ ...b, [key]: value }));
  }

  function canSubmit(): { ok: boolean; reason?: string } {
    if (!selected) return { ok: false, reason: 'Pick a product first.' };
    if (hasVariants) {
      if (sizeOptions.length > 0 && !size) return { ok: false, reason: 'Pick a size.' };
      if (colorOptions.length > 0 && !color) return { ok: false, reason: 'Pick a color.' };
    }
    if (!qtyNum || qtyNum < 1) return { ok: false, reason: 'Quantity must be at least 1.' };
    // While editing, the server checks stock against the quantity delta.
    if (!isEdit && qtyNum > availableStock) {
      return { ok: false, reason: `Only ${availableStock} unit(s) available.` };
    }
    if (!priceValid) return { ok: false, reason: 'Unit price must be zero or more.' };
    if (isGst && !sellerGstin && editing?.invoiceType !== 'gst') {
      return { ok: false, reason: 'Add your GSTIN in Verification to issue GST invoices.' };
    }
    if (isGst && !gstRateValid) {
      return { ok: false, reason: 'GST rate must be more than 0 and at most 100%.' };
    }
    // Buyer details are required for every invoice, GST or not.
    if (!buyer.name.trim()) return { ok: false, reason: 'Buyer name is required.' };
    if (!buyer.phone.trim()) return { ok: false, reason: 'Buyer contact number is required.' };
    if (!buyer.address.trim()) return { ok: false, reason: 'Buyer address is required.' };
    if (!PHONE_RE.test(buyer.phone.trim())) {
      return { ok: false, reason: 'Contact number must be exactly 10 digits.' };
    }
    if (saleDate && saleDate > todayISO()) {
      return { ok: false, reason: "Sale date can't be in the future." };
    }
    if (buyer.email.trim() && !EMAIL_RE.test(buyer.email.trim())) {
      return { ok: false, reason: 'Enter a valid email address.' };
    }
    return { ok: true };
  }

  async function submit() {
    const gate = canSubmit();
    if (!gate.ok) {
      setFormError(gate.reason || 'Please fix the form.');
      return;
    }
    setFormError(null);
    setSubmitting(true);
    const body: any = {
      quantity: qtyNum,
      unitPrice: priceNum,
      note: note.trim(),
      saleDate: saleDate || undefined,
      invoiceType,
      gstRate: isGst ? gstRateNum : undefined,
      supplyType: isGst ? supplyType : undefined,
      buyer: {
        name: buyer.name.trim(),
        phone: buyer.phone.trim(),
        email: buyer.email.trim(),
        address: buyer.address.trim(),
      },
    };
    try {
      if (isEdit && editing) {
        await api.patch(`/seller/offline-sales/${editing._id}`, body);
        notifySuccess(M.offlineSales.saleUpdated);
      } else {
        body.product = selected!._id;
        if (hasVariants) body.variant = { size, color };
        const data = unwrap<{ productStock?: number }>(await api.post('/seller/offline-sales', body));
        const newStock = data?.productStock;
        notifySuccess(M.offlineSales.saleRecorded);
        if (typeof newStock === 'number') {
          notifySuccess(M.offlineSales.stockNowUnit(newStock, newStock === 1 ? '' : 's'));
        }
      }
      // Refresh the list and close — the invoice is one click away on
      // the sale's row.
      onSaved();
      onClose();
    } catch (e: any) {
      setFormError(
        apiMessage(e) ||
          (isEdit ? 'Could not update the sale.' : 'Could not record the sale.'),
      );
    } finally {
      setSubmitting(false);
    }
  }

  const amountReady = priceValid && qtyNum > 0;
  const submitLabel = isEdit ? 'Save changes' : 'Record sale';
  const variantText = [size, color].filter(Boolean).join(' · ');
  const gstToggleDisabled = locked || (!sellerGstin && !isGst);

  return (
    <Modal isOpen={isOpen} onClose={onClose} placement="center" size="4xl" scrollBehavior="inside" isDismissable={!submitting} isKeyboardDismissDisabled={submitting}>
      <ModalContent className={styles.modal}>
        <ModalHeader className="flex flex-col gap-1">
          <div className="text-lg font-extrabold text-brand-black">
            {isEdit ? 'Edit offline sale' : 'Record an offline sale'}
          </div>
          <p className={styles.modalHint}>{isEdit ? 'Update the sale and invoice details below.' : 'Choose a product, then add the buyer details for the invoice.'}</p>
        </ModalHeader>
        <ModalBody className={styles.saleBody} data-selected={!!selected}>
          <div className={styles.saleColumn}>
          {/* Product — fixed while editing; picker (inline list, see
              note below) while recording. The list is rendered INLINE
              because HeroUI's Modal clips absolutely-positioned overlays. */}
          {isEdit ? (
            <div className="rounded-lg border border-default-200 bg-default-50 px-3 py-2">
              <div className="text-xs font-semibold text-default-700">Product</div>
              <div className="text-sm font-semibold text-brand-black">
                {selected?.name || 'Untitled'}
                {variantText ? ` · ${variantText}` : ''}
              </div>
              <div className="text-xs text-muted mt-0.5">
                To change the product, delete this sale and record it again.
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="sale-product-search" className={styles.productLabel}>Product</label>
              {!selected && <input
                id="sale-product-search"
                type="search"
                className={styles.productSearch}
                placeholder="Search by product name or SKU…"
                value={query}
                onChange={(event) => {
                  const value = event.target.value;
                  setQuery(value);
                }}
                autoFocus
                disabled={locked}
              />}
              {selected ? (
                <div className={styles.selectedProduct}>
                  <div className="min-w-0">
                    <div className={styles.productName}>
                      {selected.name}
                    </div>
                    <div className={styles.productMeta}>
                      {selected.stock ?? 0} in stock · ₹{inr(Number(selected.price) || 0)}
                    </div>
                  </div>
                  {!locked && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(null);
                        setQuery('');
                      }}
                      className={styles.changeProduct}
                    >
                      Change
                    </button>
                  )}
                </div>
              ) : (
                <div className={styles.productResults}>
                  {lookupLoading ? (
                    <div className="px-4 py-3 text-xs text-muted flex items-center gap-2">
                      <Spinner size="sm" /> Searching…
                    </div>
                  ) : lookupItems.length === 0 ? (
                    <div className="px-4 py-6 text-xs text-muted text-center">
                      {debouncedQuery
                        ? `No products match "${debouncedQuery}".`
                        : 'No products in your catalog yet. Add a product first.'}
                    </div>
                  ) : (
                    lookupItems.map((p) => {
                      const outOfStock = (p.stock ?? 0) <= 0;
                      return (
                        <button
                          key={p._id}
                          type="button"
                          onClick={() => pickProduct(p)}
                          className={`${styles.productResult} ${
                            outOfStock ? 'opacity-60' : ''
                          }`}
                        >
                          <div className={styles.productName}>
                            {p.name}
                          </div>
                          <div className={styles.productMeta}>
                            {p.sku && <span>SKU {p.sku}</span>}
                            {p.sku && <span className="text-default-300">·</span>}
                            <span className={outOfStock ? 'text-rose-600 font-semibold' : ''}>
                              {p.stock ?? 0} in stock
                            </span>
                            <span className="text-default-300">·</span>
                            <span>₹{inr(Number(p.price) || 0)}</span>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}

          {/* Variant selects — record mode, products with a variant matrix */}
          {selected && hasVariants && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {sizeOptions.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-default-700">Size</label>
                  <ThemedSelect
                    ariaLabel="Size"
                    isDisabled={locked}
                    onChange={setSize}
                    options={sizeOptions.map((s) => ({ value: s, label: s }))}
                    placeholder="Pick a size"
                    value={size}
                  />
                </div>
              )}
              {colorOptions.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-default-700">Color</label>
                  <ThemedSelect
                    ariaLabel="Color"
                    isDisabled={locked}
                    onChange={setColor}
                    options={colorOptions.map((c) => ({ value: c, label: c }))}
                    placeholder="Pick a color"
                    value={color}
                  />
                </div>
              )}
            </div>
          )}

          {/* Quantity + unit price */}
          {selected && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-default-700">
                  Quantity
                  <span className="ml-2 font-normal text-muted">
                    {isEdit
                      ? `Was ${editing?.quantity} · stock adjusts by the difference`
                      : `Available: ${availableStock}`}
                  </span>
                </label>
                <input
                  type="number"
                  min={1}
                  max={isEdit ? undefined : availableStock || undefined}
                  step={1}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className={fieldCls}
                  disabled={locked}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-default-700">Unit price (₹)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(e.target.value)}
                  className={fieldCls}
                  disabled={locked}
                />
              </div>
            </div>
          )}

          {/* Sale date */}
          {selected && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-default-700">Sale date</label>
              <SellerDatePicker ariaLabel="Sale date" value={saleDate} onChange={setSaleDate} disabled={locked} />
            </div>
          )}

          {/* Invoice — With / Without GST. GST is inclusive: the sale
              amount above never changes, only the invoice breakdown. */}
          {selected && (
            <div className="rounded-lg border border-default-200 p-4 flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-brand-black">Invoice</div>
                  <div className="text-xs text-muted">
                    {isGst
                      ? `Tax invoice · ${gstRateValid ? fmtRate(gstRateNum) : '—'}% GST included in the price`
                      : 'Plain invoice without GST'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-semibold ${isGst ? 'text-muted' : 'text-brand-black'}`}
                  >
                    Without GST
                  </span>
                  <Switch
                    aria-label="Issue a GST invoice"
                    size="sm"
                    isSelected={isGst}
                    isDisabled={gstToggleDisabled}
                    onValueChange={(v) => {
                      setInvoiceType(v ? 'gst' : 'non_gst');
                      setFormError(null);
                    }}
                  />
                  <span
                    className={`text-xs font-semibold ${isGst ? 'text-brand-black' : 'text-muted'}`}
                  >
                    With GST
                  </span>
                </div>
              </div>

              {!sellerGstin && !isGst && (
                <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                  To issue GST invoices, add your GSTIN in{' '}
                  <Link className="font-semibold underline" href="/dashboard/kyc">
                    Verification
                  </Link>
                  .
                </div>
              )}

              {isGst && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-default-700">
                      GST rate (%)<span className="text-rose-600"> *</span>
                    </label>
                    <input
                      className={fieldCls}
                      disabled={locked}
                      inputMode="decimal"
                      max={100}
                      min={0.01}
                      onChange={(e) => setGstRateInput(e.target.value)}
                      placeholder="e.g. 18"
                      step="0.01"
                      type="number"
                      value={gstRateInput}
                    />
                    <div className="flex flex-wrap gap-1.5">
                      {COMMON_GST_RATES.map((r) => {
                        const active = gstRateValid && gstRateNum === r;
                        return (
                          <button
                            className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold transition disabled:opacity-60 ${
                              active
                                ? 'border-brand-black bg-brand-black text-white'
                                : 'border-default-300 bg-white text-default-700 hover:bg-default-100'
                            }`}
                            disabled={locked}
                            key={r}
                            onClick={() => setGstRateInput(String(r))}
                            type="button"
                          >
                            {r}%
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-default-700">Supply type</label>
                    <ThemedSelect
                      ariaLabel="Supply type"
                      isDisabled={locked}
                      onChange={(v) => {
                        // Clicking the selected item again clears it — keep
                        // the current choice in that case.
                        if (v !== 'intra' && v !== 'inter') return;
                        setSupplyType(v);
                      }}
                      options={[
                        { value: 'intra', label: 'Within state — CGST + SGST' },
                        { value: 'inter', label: 'Other state — IGST' },
                      ]}
                      value={supplyType}
                    />
                    <div className="text-xs text-muted">
                      {sellerState
                        ? `Your state: ${sellerState}. Pick "Other state" if the buyer is outside it.`
                        : 'Pick "Other state" if the buyer is in a different state.'}
                    </div>
                  </div>
                </div>
              )}

              {isGst && amountReady && gstRateValid && (
                <div className="rounded-md bg-default-50 border border-default-200 px-3 py-2 text-xs text-default-700 grid grid-cols-2 gap-y-1">
                  <span>Taxable value</span>
                  <span className="text-right">₹{inr2(gstSplit.taxable)}</span>
                  {supplyType === 'inter' ? (
                    <>
                      <span>IGST {fmtRate(gstRateNum)}%</span>
                      <span className="text-right">₹{inr2(gstSplit.igst)}</span>
                    </>
                  ) : (
                    <>
                      <span>CGST {fmtRate(gstRateNum / 2)}%</span>
                      <span className="text-right">₹{inr2(gstSplit.cgst)}</span>
                      <span>SGST {fmtRate(gstRateNum / 2)}%</span>
                      <span className="text-right">₹{inr2(gstSplit.sgst)}</span>
                    </>
                  )}
                  <span className="font-semibold text-brand-black">Invoice total</span>
                  <span className="text-right font-semibold text-brand-black">
                    ₹{inr2(computedTotal)}
                  </span>
                  <span className="col-span-2 text-muted mt-1">
                    Sale amount stays ₹{inr(computedTotal)}. GSTIN on invoice:{' '}
                    {editing?.invoiceType === 'gst' && !sellerGstin ? 'as originally issued' : sellerGstin}
                  </span>
                </div>
              )}

            </div>
          )}
          </div>
          {selected && <div className={styles.buyerColumn}>
              <div className="flex flex-col gap-3">
                  <div className="text-xs font-semibold text-default-700">
                    Buyer details{' '}
                    <span className="font-normal text-muted">
                      (name, contact and address required)
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold text-default-700">
                        Name<span className="text-rose-600"> *</span>
                      </label>
                      <input
                        className={fieldCls}
                        disabled={locked}
                        maxLength={120}
                        onChange={(e) => setBuyerField('name', e.target.value)}
                        placeholder="Buyer's full name"
                        value={buyer.name}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-semibold text-default-700">
                        Contact no.<span className="text-rose-600"> *</span>
                      </label>
                      <input
                        className={fieldCls}
                        disabled={locked}
                        inputMode="numeric"
                        maxLength={10}
                        pattern="[0-9]{10}"
                        onChange={(e) =>
                          setBuyerField('phone', e.target.value.replace(/\D/g, '').slice(0, 10))
                        }
                        placeholder="10-digit mobile number"
                        type="tel"
                        value={buyer.phone}
                      />
                      {buyer.phone.length > 0 && buyer.phone.length < 10 && (
                        <span className="text-xs text-rose-600">
                          Enter all 10 digits ({buyer.phone.length}/10).
                        </span>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5 sm:col-span-2">
                      <label className="text-xs font-semibold text-default-700">
                        Email <span className="font-normal text-muted">(optional)</span>
                      </label>
                      <input
                        className={fieldCls}
                        disabled={locked}
                        maxLength={160}
                        onChange={(e) => setBuyerField('email', e.target.value)}
                        placeholder="buyer@example.com"
                        type="email"
                        value={buyer.email}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5 sm:col-span-2">
                      <label className="text-xs font-semibold text-default-700">
                        Address<span className="text-rose-600"> *</span>
                      </label>
                      <textarea
                        className={`${fieldCls} min-h-[64px]`}
                        disabled={locked}
                        maxLength={500}
                        onChange={(e) => setBuyerField('address', e.target.value)}
                        placeholder="House / street, city, PIN"
                        rows={2}
                        value={buyer.address}
                      />
                    </div>
                  </div>
              </div>

          {/* Note */}
          {selected && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-default-700">
                Note <span className="font-normal text-muted">(optional)</span>
              </label>
              <Textarea
                value={note}
                onValueChange={(v) => setNote(v.slice(0, 500))}
                variant="bordered"
                minRows={2}
                placeholder="Anything else about this sale…"
                isDisabled={locked}
              />
            </div>
          )}
          </div>}

          {formError && (
            <div role="alert" className={`${styles.formError} rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900`}>
              {formError}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <div className={styles.saleTotal}><span>Sale total</span><strong>{selected && amountReady ? `₹${inr2(computedTotal)}` : '—'}</strong></div>
          <Button variant="bordered" className={styles.cancelSale} onPress={onClose} isDisabled={submitting}>
            Cancel
          </Button>
          <Button
            color="primary"
            onPress={submit}
            isLoading={submitting}
            isDisabled={submitting || !selected}
            className={styles.primary}
          >
            {submitLabel}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
