'use client';

import { useEffect, useMemo, useState } from 'react';
import styles from './DashboardProducts.module.css';
import Arrow from '@/components/common/Arrow';
import SellerSelect from '@/components/common/SellerSelect';
import { Card, CardBody, CardHeader, Chip, Input, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from '@heroui/react';
import Button from '@/components/common/SellerButton';
import ProductForm from '@/components/common/ProductForm';
import { startNewProductDraft } from '@/lib/productCreateDraft';
import {
  RowActions,
  StatusChip,
  TablePagination,
  type DataTableColumn,
} from '@/components/ui';
import { api, imageUrl, API_URL, envelopeOrLegacy, unwrap } from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import { readListCache, writeListCache } from '@/lib/listCache';
import { notifyError, notifySuccess, notifyWarning, apiMessage } from '@/lib/notify';
import { M } from '@/lib/messages';
import { originForSite } from '@/lib/site';

type Product = {
  _id: string;
  // Slug is the canonical product identifier used in URLs across the
  // dashboard + storefront. Optional because older records seeded
  // before slug generation can lack it — call sites fall back to _id.
  slug?: string;
  name: string;
  category?: string | { _id: string; name: string };
  price: number;
  stock: number;
  status: 'draft' | 'active' | 'rejected' | 'out_of_stock';
  isFeatured: boolean;
  images?: string[];
  listingImage?: string;
  createdAt: string;
};

function categoryName(c: Product['category']): string {
  if (!c) return '';
  return typeof c === 'string' ? c : c.name;
}

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);

type StatusFilter = 'all' | 'active' | 'draft' | 'rejected' | 'out_of_stock';
type StockFilter = 'all' | 'in_stock' | 'low_stock' | 'out_of_stock';
type SortKey = 'newest' | 'oldest' | 'price_asc' | 'price_desc' | 'stock_asc' | 'stock_desc' | 'name';

/** Rows per page — matches the admin panel's list convention. */
const PAGE_SIZE = 15;

const CREATE_EDITOR_KEY = 'tin:products-create-open';

export default function DashboardProductsPage() {
  /* UX audit X5: 438 products painted from the last visit while the
     fresh list loads behind them. */
  const [cached] = useState(() => readListCache<Product[]>('seller-products'));
  const [items, setItems] = useState<Product[]>(cached ?? []);
  const [loading, setLoading] = useState(!cached);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Count of currently-live seller offers, sourced from
  // /seller/offers?status=enabled. Populated alongside the products
  // fetch so the "Active offers" KPI tile renders without a spinner.

  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [stock, setStock] = useState<StockFilter>('all');
  const [category, setCategory] = useState<string>('all');
  const [featuredOnly, setFeaturedOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>('newest');

  // Bulk import / export state
  const [exporting, setExporting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importImages, setImportImages] = useState<File[]>([]);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    summary: { total: number; created: number; updated: number; failed: number };
    results: { row: number; name: string; status: 'created' | 'updated' | 'failed'; error?: string; warning?: string }[];
  } | null>(null);

  async function handleExport(format: 'csv' | 'xlsx' = 'csv') {
    setExporting(true);
    try {
      // Use a raw fetch so the browser handles the file download. axios+blob would
      // also work but this keeps headers/filename behaviour native.
      // localStorage when "Remember me" was checked at login, sessionStorage
      // otherwise — see lib/auth.ts for the full setup.
      const token =
        typeof window !== 'undefined'
          ? localStorage.getItem('seller_token') ||
          sessionStorage.getItem('seller_token')
          : '';
      const r = await fetch(`${API_URL}/products/export?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) throw new Error(`Export failed (${r.status})`);
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `throttlein-products-${new Date().toISOString().slice(0, 10)}.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notifySuccess(M.products.downloaded(format.toUpperCase()));
    } catch (e: any) {
      notifyError(e, M.products.couldntExportProducts);
    } finally {
      setExporting(false);
    }
  }

  async function downloadTemplate(format: 'csv' | 'xlsx' = 'csv') {
    try {
      // localStorage when "Remember me" was checked at login, sessionStorage
      // otherwise — see lib/auth.ts for the full setup.
      const token =
        typeof window !== 'undefined'
          ? localStorage.getItem('seller_token') ||
          sessionStorage.getItem('seller_token')
          : '';
      const r = await fetch(`${API_URL}/products/import/template?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `throttlein-products-template.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      notifyWarning(M.products.couldNotDownloadTemplate);
    }
  }

  async function runImport() {
    if (!importFile) {
      notifyWarning(M.products.pickACSVOrExcelFileFirst);
      return;
    }
    setImporting(true);
    setImportResult(null);
    try {
      const fd = new FormData();
      // Pick the multer field name from the extension: .xlsx uploads go
      // under "xlsx", everything else under "csv". Backend handles either.
      const isXlsx = /\.xlsx$/i.test(importFile.name);
      fd.append(isXlsx ? 'xlsx' : 'csv', importFile);
      // Optional: image files referenced by basename in the sheet's `images`
      // column. Backend matches by filename and uploads each to S3 / local storage.
      for (const img of importImages) fd.append('images', img);
      const data = unwrap<NonNullable<typeof importResult>>(await api.post('/products/import', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }));
      setImportResult({ summary: data.summary, results: data.results });
      if (data.summary.failed === 0) {
        notifySuccess(M.products.productSImported(data.summary.created + data.summary.updated));
      } else {
        notifySuccess(M.products.okFailed(data.summary.created + data.summary.updated, data.summary.failed));
      }
      load();
    } catch (e: any) {
      notifyError(e, M.products.couldntImport);
    } finally {
      setImporting(false);
    }
  }

  function closeImportModal() {
    if (importing) return;
    setImportOpen(false);
    setImportFile(null);
    setImportImages([]);
    setImportResult(null);
  }

  async function load(quiet = false) {
    if (!quiet) setLoading(true);
    try {
      const { items: mine } = unwrap<{ items: Product[] }>(await api.get('/products/mine'));
      setItems(mine);
      setLoadError(null);
      writeListCache('seller-products', mine);
    } catch (e: any) {
      setLoadError(apiMessage(e) || 'Failed to load products. Please try again.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  useEffect(() => { load(!!cached); }, [cached]);

  /* ── Bulk selection (UX audit S7) ──────────────────────────────────
     Rows used to offer only Edit + trash, one at a time. A seller
     re-pricing a season or unpublishing a discontinued range needs to
     act on many. Selection lives on this page only (not the API). */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<string | null>(null);
  const toggleSelected = (id: string) => setSelected((prev) => {
    const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next;
  });
  async function bulkStatus(status: 'active' | 'draft') {
    setBulkBusy(status);
    try {
      const data = unwrap<{ updated: number; skipped?: number }>(await api.post('/products/bulk-status', { ids: [...selected], status }));
      notifySuccess(M.products.bulkStatus(data.updated, status === 'active', data.skipped || 0));
      setSelected(new Set());
      load();
    } catch (e: any) {
      notifyError(e, M.products.couldntUpdateThoseProducts);
    } finally {
      setBulkBusy(null);
    }
  }
  async function bulkDelete() {
    const n = selected.size;
    if (!(await confirmDialog({
      title: `Delete ${n} product${n === 1 ? '' : 's'}?`,
      message: 'This cannot be undone. They will be permanently removed from your store.',
      destructive: true,
      confirmLabel: `Delete ${n}`,
    }))) return;
    setBulkBusy('delete');
    const results = await Promise.allSettled([...selected].map((id) => api.delete(`/products/${id}`)));
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed) notifyWarning(M.products.ofCouldNotBeDeleted(failed, n)); else notifySuccess(M.products.deleted(n));
    setSelected(new Set());
    setBulkBusy(null);
    load();
  }
  function exportSelected() {
    const rows = items.filter((p) => selected.has(p._id));
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [
      ['Name', 'SKU', 'Category', 'Price', 'MRP', 'Stock', 'Status'].join(','),
      ...rows.map((p: any) => [p.name, p.sku, categoryName(p.category), p.price, p.mrp ?? '', p.stock, p.status].map(esc).join(',')),
    ].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `products-selected-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  async function remove(id: string, name: string) {
    if (!(await confirmDialog({
      title: `Delete "${name}"?`,
      message: 'This cannot be undone. The product will be permanently removed from your store.',
      destructive: true,
      confirmLabel: 'Delete product',
    }))) return;
    try {
      await api.delete(`/products/${id}`);
      notifySuccess(M.products.deleted2);
      load();
    } catch (e: any) {
      notifyError(e, M.products.thatDidntWork);
    }
  }

  const categories = useMemo(() => {
    const set = new Set<string>();
    items.forEach((p) => {
      const n = categoryName(p.category);
      if (n) set.add(n);
    });
    return Array.from(set).sort();
  }, [items]);

  const outOfStock = useMemo(() => items.filter((p) => p.stock === 0), [items]);
  const [page, setPage] = useState(1);

  /**
   * Inline add/edit.
   *
   * `null` shows the list. Editing takes over this page so filters remain
   * in place. An open Add product form survives a refresh (see below).
   */
  const [editor, setEditor] = useState<
    { mode: 'create' } | { mode: 'edit'; product: any } | null
  >(null);

  // Reopen the Add product form after a refresh; its unsaved values come
  // back from the local draft. Leaving the page closes it for next time.
  useEffect(() => {
    let restore = false;
    try { restore = sessionStorage.getItem(CREATE_EDITOR_KEY) === '1'; } catch {}
    // The state update is deferred a tick (react-hooks/set-state-in-effect):
    // the browser session is an external store read after mount.
    let fired = false;
    const t = restore ? window.setTimeout(() => { fired = true; setEditor({ mode: 'create' }); }, 0) : 0;
    return () => {
      window.clearTimeout(t);
      // A restore still pending means this is React's dev double-mount,
      // not the seller leaving: keep the key so the second mount restores.
      if (restore && !fired) return;
      try { sessionStorage.removeItem(CREATE_EDITOR_KEY); } catch {}
    };
  }, []);
  useEffect(() => {
    try {
      if (editor?.mode === 'create') sessionStorage.setItem(CREATE_EDITOR_KEY, '1');
      else sessionStorage.removeItem(CREATE_EDITOR_KEY);
    } catch {}
  }, [editor]);

  /** Add product always starts a fresh form, discarding any old local draft. */
  function openCreate() {
    startNewProductDraft();
    setEditor({ mode: 'create' });
  }
  // Which row is currently fetching its full record, so that row's Edit
  // button can show progress instead of the page appearing to do nothing.
  const [openingId, setOpeningId] = useState<string | null>(null);

  /**
   * Open the editor for one product — after fetching the COMPLETE record.
   *
   * The table row is a projection: ten fields, no description, sku, mrp,
   * weight, dimensions, variants or per-colour galleries. Handing that to
   * ProductForm would initialise every missing field empty, and saving
   * would then write those blanks back over real data. The standalone
   * /dashboard/products/[slug] route fetches the full product for exactly
   * this reason; inline editing has to do the same.
   */
  async function openEdit(p: Product) {
    setOpeningId(p._id);
    try {
      // The seller-scoped lookup: the public one hides products until the
      // seller's KYC is approved, which left Edit/Restock failing.
      const { data } = await api.get(`/products/mine/${p._id}`).then(envelopeOrLegacy);
      setEditor({ mode: 'edit', product: data.product });
    } catch (e: any) {
      notifyError(e, M.products.couldntOpenThatProduct);
    } finally {
      setOpeningId(null);
    }
  }



  const activeFiltersCount =
    (q.trim() ? 1 : 0) +
    (status !== 'all' ? 1 : 0) +
    (stock !== 'all' ? 1 : 0) +
    (category !== 'all' ? 1 : 0) +
    (featuredOnly ? 1 : 0);

  const filtered = useMemo(() => {
    let arr = items;
    const needle = q.trim().toLowerCase();
    if (needle) {
      arr = arr.filter(
        (p) =>
          p.name.toLowerCase().includes(needle) ||
          categoryName(p.category).toLowerCase().includes(needle)
      );
    }
    if (status !== 'all') arr = arr.filter((p) => status === 'out_of_stock' ? p.stock === 0 : p.status === status);
    if (stock !== 'all') {
      if (stock === 'in_stock') arr = arr.filter((p) => p.stock > 5);
      else if (stock === 'low_stock') arr = arr.filter((p) => p.stock > 0 && p.stock <= 5);
      else if (stock === 'out_of_stock') arr = arr.filter((p) => p.stock === 0);
    }
    if (category !== 'all') arr = arr.filter((p) => categoryName(p.category) === category);
    if (featuredOnly) arr = arr.filter((p) => p.isFeatured);

    arr = [...arr].sort((a, b) => {
      switch (sort) {
        case 'oldest': return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        case 'price_asc': return a.price - b.price;
        case 'price_desc': return b.price - a.price;
        case 'stock_asc': return a.stock - b.stock;
        case 'stock_desc': return b.stock - a.stock;
        case 'name': return a.name.localeCompare(b.name);
        case 'newest':
        default: return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
    });
    return arr;
  }, [items, q, status, stock, category, featuredOnly, sort]);

  /**
   * Client-side pagination.
   *
   * The whole catalogue is already in memory (`/products/mine` returns it
   * in one call), so slicing here is enough — no extra requests. What it
   * fixes is the RENDER: every filtered row used to be mounted at once,
   * which on a 438-product catalogue meant 441 <img> tags and a page
   * 28,600px tall. PAGE_SIZE matches the admin panel's convention.
   */
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginated = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage],
  );

  // Filter handlers reset pagination; currentPage also clamps after deletions.


  function clearFilters() {
    setPage(1);
    setQ('');
    setStatus('all');
    setStock('all');
    setCategory('all');
    setFeaturedOnly(false);
    setSort('newest');
  }

  const pageIds = paginated.map((p) => p._id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const columns: DataTableColumn<Product>[] = [
    {
      id: 'select',
      header: (
        <input
          aria-label="Select all on this page"
          checked={allOnPage}
          className="size-4 accent-foreground"
          onChange={() => setSelected((prev) => {
            const next = new Set(prev);
            if (allOnPage) pageIds.forEach((id) => next.delete(id)); else pageIds.forEach((id) => next.add(id));
            return next;
          })}
          type="checkbox"
        />
      ),
      className: 'w-10',
      cell: (p) => (
        <input
          aria-label={`Select ${p.name}`}
          checked={selected.has(p._id)}
          className="size-4 accent-foreground"
          onChange={() => toggleSelected(p._id)}
          type="checkbox"
        />
      ),
    },
    {
      id: 'product',
      header: 'Product',
      isRowHeader: true,
      cell: (p) => (
        <div className="flex items-center gap-3">
          {/* Thumbnail folded into this cell — a dedicated image column
              spent width the long product names needed. */}
          {(p.listingImage || p.images?.[0]) ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt=""
              className="size-11 shrink-0 rounded-lg border border-border object-cover"
              loading="lazy"
              src={imageUrl(p.listingImage || p.images![0])}
            />
          ) : (
            <div className="size-11 shrink-0 rounded-lg border border-border bg-surface-tertiary" />
          )}
          <div className="min-w-0">
            <div className="line-clamp-2 text-sm font-medium text-foreground">{p.name}</div>
            {p.isFeatured && (
              <span className="mt-0.5 inline-block rounded bg-surface-tertiary px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-foreground">
                Featured
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      id: 'category',
      header: 'Category',
      cell: (p) => <span className="text-sm text-muted">{categoryName(p.category)}</span>,
    },
    {
      id: 'price',
      header: 'Price',
      cell: (p) => (
        // Capped and truncated: one mistyped price (₹10,00,00,…) used to run
        // across the Stock and Status columns. The full figure is in the tooltip.
        <div className="min-w-0 max-w-[11rem]">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 tabular-nums">
            <span className="max-w-full truncate text-sm font-medium text-foreground" title={`₹${inr(p.price)}`}>₹{inr(p.price)}</span>
            {(p as any).mrp && (p as any).mrp > p.price && (
              <span className="max-w-full truncate text-xs text-muted line-through" title={`₹${inr((p as any).mrp)}`}>₹{inr((p as any).mrp)}</span>
            )}
          </div>
          {(p as any).activeOffer?.title && (
            <span
              className="mt-0.5 inline-block rounded bg-surface-tertiary px-1.5 py-0.5 text-xs font-medium text-muted"
              title={`Offer: ${(p as any).activeOffer.title}`}
            >
              {(p as any).activeOffer.title}
            </span>
          )}
        </div>
      ),
    },
    {
      id: 'stock',
      header: 'Stock',
      cell: (p) => (
        /* Low stock still flagged, via the semantic warning token rather
           than a raw amber-600. */
        <span className={`text-sm tabular-nums ${p.stock <= 5 ? 'font-semibold text-warning' : 'text-muted'}`}>
          {p.stock}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (p) => <StatusChip status={p.status} />,
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      /* UX audit X4: Edit is the one primary; "View on store" and Delete
         live in the menu, Delete last and red. Row click also opens Edit. */
      cell: (p) => (
        <RowActions
          ariaLabel={`More actions for ${p.name}`}
          items={[
            { key: 'view', label: 'View on storefront', onSelect: () => window.open(`${originForSite('main')}/product/${p.slug || p._id}`, '_blank', 'noopener') },
            { key: 'delete', label: 'Delete product…', tone: 'danger', onSelect: () => remove(p._id, p.name) },
          ]}
          primary={{ label: openingId === p._id ? 'Opening…' : p.stock === 0 ? 'Restock' : 'Edit', onPress: () => openEdit(p), disabled: openingId === p._id }}
        />
      ),
    },
  ];

  /**
   * Editor view — replaces the list rather than sitting beside it.
   *
   * Returning early keeps the filters, page number and scroll position in
   * React state, so closing the form drops you back exactly where you
   * were. `key` forces a fresh form per product; without it React reuses
   * the mounted instance and the previous listing's values bleed through.
   */
  if (editor) {
    return (
      <>
        <div className={styles.editor}>
          <button
            className={styles.back}
            onClick={() => setEditor(null)}
            type="button"
          >
            <svg aria-hidden className="size-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
              <line x1="19" x2="5" y1="12" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            Back to products
          </button>

          <h1 className="sr-only">
            {editor.mode === 'edit' ? editor.product.name : 'Add a product'}
          </h1>

          <ProductForm
            id={editor.mode === 'edit' ? editor.product._id : undefined}
            initial={editor.mode === 'edit' ? editor.product : {}}
            key={editor.mode === 'edit' ? editor.product._id : 'create'}
            mode={editor.mode}
            onDone={() => {
              setEditor(null);
              // Refetch so a new or renamed listing shows immediately.
              load();
            }}
          />
        </div>
      </>
    );
  }

  return (
    <div className={styles.page}>
      <h1 className="sr-only">Products</h1>
      <div className="flex flex-wrap items-center justify-end gap-3 mb-5"><div className={styles.headerActions}>
        <Dropdown placement="bottom-end" classNames={{ content: styles.menuPopover }}>
          <DropdownTrigger>
            <Button
              variant="bordered"
              className="font-semibold border-2"
              isLoading={exporting}
              startContent={!exporting && (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              )}
              endContent={!exporting && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              )}
            >
              Export
            </Button>
          </DropdownTrigger>
          {/* Same panel, rows and hover as every other menu in the
              workspace (SellerSelect / account menu). */}
          <DropdownMenu
            aria-label="Export format"
            classNames={{ list: styles.menuList }}
            itemClasses={{ base: styles.menuItem, title: styles.menuTitle, description: styles.menuDesc }}
            onAction={(key) => handleExport(key === 'xlsx' ? 'xlsx' : 'csv')}
          >
            <DropdownItem
              key="csv"
              description="Comma-separated · opens in Sheets / Excel"
              startContent={<span className={styles.menuIcon}>CSV</span>}
            >
              Download as CSV
            </DropdownItem>
            <DropdownItem
              key="xlsx"
              description="Native Excel workbook (.xlsx)"
              startContent={<span className={styles.menuIcon}>XLS</span>}
            >
              Download as Excel
            </DropdownItem>
          </DropdownMenu>
        </Dropdown>
        <Button
          variant="bordered"
          className="font-semibold border-2"
          onPress={() => setImportOpen(true)}
          startContent={
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          }
        >
          Import
        </Button>
        {/* Add product opens the inline editor (openCreate drops any old
            local draft first), so this is a plain button, not a Link. */}
        <Button
          className="font-semibold"
          color="primary"
          onPress={openCreate}
        >
          + Add product
        </Button>
      </div>
      </div>
      {!loading && outOfStock.length > 0 && (
        <button className={styles.stockNotice} onClick={() => { clearFilters(); setStock('out_of_stock'); setPage(1); }}>
          <span><strong>{outOfStock.length} {outOfStock.length === 1 ? 'product is' : 'products are'} out of stock</strong><span>Review unavailable listings and replenish stock.</span></span>
          <span>Review stock <Arrow /></span>
        </button>
      )}
      {loadError && <div className={styles.error} role="alert"><span>{loadError}</span><button onClick={() => load()} disabled={loading}>Try again</button></div>}
      <Card className={styles.workspace} shadow="none">
        <CardHeader className={styles.listHeader}>
          <div className="flex items-center justify-between gap-3 w-full">
            <div>
              <div className="text-sm font-semibold text-foreground">
                Listings
              </div>

            </div>
            {/* Reports how many rows the FILTERS match, not how many are
                rendered — the pagination strip below states the visible
                range. Previously read "Showing 438 of 438" while the table
                rendered all 438; now that it renders 15, that wording would
                have been actively wrong. */}
            <div className="text-sm text-muted">
              {loading
                ? '—'
                : filtered.length === items.length
                  ? `${items.length} products`
                  : `${filtered.length} of ${items.length} match`}
            </div>
          </div>

          {/* Single-row toolbar — search grows to fill, filters keep their
              own width. HeroUI Select gives us consistent styling with the
              rest of the dashboard (instead of native <select> drawers). */}
          <div className={styles.toolbar}>
            <Input
              size="sm"
              aria-label="Search products"
              placeholder="Search name or category…"
              value={q}
              onChange={(e) => { setQ(e.target.value); setPage(1); }}
              startContent={<SearchIcon />}
              className={styles.productSearch}
              classNames={{ inputWrapper: styles.searchInput }}
            />
            <div className={styles.filterGroup}>
              <FilterSelect
                ariaLabel="Status"
                value={status}
                onChange={(v) => { setStatus(v as StatusFilter); setPage(1); }}
                placeholder="All statuses"
                options={[
                  { value: 'all', label: 'All statuses' },
                  { value: 'active', label: 'Active' },
                  { value: 'draft', label: 'Draft' },
                  { value: 'rejected', label: 'Rejected' },
                  { value: 'out_of_stock', label: 'Out of stock' },
                ]}
              />
              <FilterSelect
                ariaLabel="Category"
                value={category}
                onChange={(v) => { setCategory(v); setPage(1); }}
                placeholder="All categories"
                options={[
                  { value: 'all', label: 'All categories' },
                  ...categories.map((c) => ({ value: c, label: c })),
                ]}
              />
              <FilterSelect
                ariaLabel="Stock"
                value={stock}
                onChange={(v) => { setStock(v as StockFilter); setPage(1); }}
                placeholder="Any stock"
                options={[
                  { value: 'all', label: 'Any stock' },
                  { value: 'in_stock', label: 'In stock (>5)' },
                  { value: 'low_stock', label: 'Low (1–5)' },
                  { value: 'out_of_stock', label: 'Out of stock' },
                ]}
              />
              <FilterSelect
                ariaLabel="Sort"
                value={sort}
                onChange={(v) => { setSort(v as SortKey); setPage(1); }}
                placeholder="Newest first"
                options={[
                  { value: 'newest', label: 'Newest first' },
                  { value: 'oldest', label: 'Oldest first' },
                  { value: 'price_asc', label: 'Price low → high' },
                  { value: 'price_desc', label: 'Price high → low' },
                  { value: 'stock_asc', label: 'Stock low → high' },
                  { value: 'stock_desc', label: 'Stock high → low' },
                  { value: 'name', label: 'Name A → Z' },
                ]}
              />
            </div>
          </div>

          <div className="flex items-center justify-between flex-wrap gap-2 w-full">
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                aria-pressed={featuredOnly}
                onClick={() => { setFeaturedOnly((v) => !v); setPage(1); }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition ${featuredOnly
                  ? 'bg-amber-100 border-amber-300 text-amber-800'
                  : 'bg-surface border-border text-muted hover:border-foreground'
                  }`}
              >
                ★ Featured only
              </button>
              {activeFiltersCount > 0 && (
                <Chip size="sm" className="bg-surface-tertiary font-semibold" variant="flat">
                  {activeFiltersCount} filter{activeFiltersCount === 1 ? '' : 's'} active
                </Chip>
              )}
            </div>
            {activeFiltersCount > 0 && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-xs font-bold text-muted hover:text-foreground underline-offset-2 hover:underline"
              >
                Clear all filters
              </button>
            )}
          </div>
        </CardHeader>

        <CardBody className="p-0">
          {/* Bulk bar (UX audit S7) — appears only with a selection, in
              place of nothing, so the toolbar above stays calm. */}
          {selected.size > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-surface-tertiary px-3 py-2" role="region" aria-label="Bulk actions">
              <span className="text-sm font-semibold text-foreground tabular-nums">{selected.size} selected</span>
              <Button size="sm" color="primary" className="font-semibold" isLoading={bulkBusy === 'active'} onPress={() => bulkStatus('active')}>Publish</Button>
              <Button size="sm" variant="bordered" className="font-semibold border-2" isLoading={bulkBusy === 'draft'} onPress={() => bulkStatus('draft')}>Move to draft</Button>
              <Button size="sm" variant="bordered" className="font-semibold border-2" onPress={exportSelected}>Export CSV</Button>
              <Button size="sm" variant="flat" color="danger" className="font-semibold" isLoading={bulkBusy === 'delete'} onPress={bulkDelete}>Delete…</Button>
              <Button size="sm" variant="light" className="ml-auto font-semibold" onPress={() => setSelected(new Set())}>Clear</Button>
            </div>
          )}

          {loading ? <div className={styles.empty} role="status">Loading products…</div> : !paginated.length ? (
            <div className={styles.empty}><h2>{loadError ? 'Products unavailable' : items.length ? 'No products match your filters' : 'Add your first product'}</h2><p>{loadError ? 'Try again to load your catalogue.' : items.length ? 'Adjust your search or clear the filters to see more listings.' : 'Create a listing to start building your catalogue.'}</p>
              {!loadError && <Button className={styles.primaryButton} onPress={() => items.length ? clearFilters() : openCreate()}>{items.length ? 'Clear filters' : 'Add product'}</Button>}
            </div>
          ) : <>
            <div className={styles.desktopTable}>
              <table className={styles.table} aria-label="My products">
                <thead><tr>{columns.map(col => <th key={col.id} scope="col">{col.header}</th>)}</tr></thead>
                <tbody>{paginated.map(product => <tr key={product._id}>{columns.map(col => <td key={col.id}>{col.id === 'product' ? <button className={styles.productButton} onClick={() => openEdit(product)} disabled={openingId === product._id}>{col.cell(product)}</button> : col.cell(product)}</td>)}</tr>)}</tbody>
              </table>
            </div>
            <div className={styles.mobileProducts}>
              <label className={styles.selectPage}>{columns[0].header}<span>Select this page</span></label>
              {paginated.map(product => <article className={styles.mobileProduct} key={product._id}>
                <div className={styles.mobileIdentity}>{columns[0].cell(product)}<button className={styles.productButton} onClick={() => openEdit(product)} disabled={openingId === product._id}>{columns[1].cell(product)}</button></div>
                <dl>{columns.slice(2, 6).map(col => <div key={col.id}><dt>{col.header}</dt><dd>{col.cell(product)}</dd></div>)}</dl>
                <div className={styles.mobileActions}>{columns[6].cell(product)}</div>
              </article>)}
            </div>
            <div className={styles.pagination}><TablePagination noun="products" onChange={setPage} page={currentPage} pages={totalPages} pageSize={PAGE_SIZE} total={filtered.length} /></div>
          </>}
        </CardBody>
      </Card>

      {/* ─── Bulk import modal ─── */}
      <Modal
        isOpen={importOpen}
        onClose={closeImportModal}
        placement="center"
        backdrop="opaque"
        size="2xl"
        hideCloseButton
        scrollBehavior="inside"
        classNames={{ base: styles.modal, backdrop: styles.backdrop, header: styles.modalHeader, body: styles.modalBody, footer: styles.modalFooter }}
      >
        <ModalContent>
          <ModalHeader>
            <span className={styles.modalIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <h2>Import products from a spreadsheet</h2>
              <p>CSV or Excel. A row whose <code>sku</code> matches an existing product updates it; new SKUs become new products.</p>
            </div>
            <button type="button" className={styles.modalClose} onClick={closeImportModal} disabled={importing} aria-label="Close">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </ModalHeader>

          <ModalBody>
            {importResult ? (
              /* Results replace the pickers: one screen, one outcome. "Import
                 another file" below clears them and brings the pickers back. */
              <div className="flex flex-col gap-3">
                <div className={styles.results}>
                  <Stat label="Rows" value={importResult.summary.total} tone="default" />
                  <Stat label="Created" value={importResult.summary.created} tone="good" />
                  <Stat label="Updated" value={importResult.summary.updated} tone="info" />
                  <Stat label="Failed" value={importResult.summary.failed} tone={importResult.summary.failed > 0 ? 'bad' : 'default'} />
                </div>
                {importResult.summary.failed > 0 && (
                  <div className={styles.issues}>
                    <div>{importResult.summary.failed} row{importResult.summary.failed === 1 ? '' : 's'} not imported</div>
                    <ul>
                      {importResult.results.filter((r) => r.status === 'failed').map((r) => (
                        <li key={r.row}><span>Row {r.row}</span><span><strong>{r.name}</strong> — {r.error}</span></li>
                      ))}
                    </ul>
                  </div>
                )}
                {/* Soft warnings — row imported, but some referenced images couldn't be matched. */}
                {importResult.results.some((r) => r.warning) && (
                  <div className={`${styles.issues} ${styles.issuesWarn}`}>
                    <div>Imported, but some images were not matched</div>
                    <ul>
                      {importResult.results.filter((r) => r.warning).map((r) => (
                        <li key={`w-${r.row}`}><span>Row {r.row}</span><span>{r.warning}</span></li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <>
                {/* Template first: the quickest way to get the columns right. */}
                <div className={styles.tip}>
                  <span>New to this? Start from the template, which has two example rows:</span>
                  <button type="button" className={styles.tipBtn} onClick={() => downloadTemplate('csv')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                    CSV
                  </button>
                  <button type="button" className={styles.tipBtn} onClick={() => downloadTemplate('xlsx')}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                    Excel (.xlsx)
                  </button>
                  <small>Required columns: <code>name</code>, <code>category</code>, <code>price</code>. Separate several <code>sizes</code> or <code>images</code> with <code>|</code>, <code>;</code> or commas.</small>
                </div>

                {/* Step 1 — the spreadsheet */}
                <div className={styles.step}>
                  <div className={styles.stepHead}><span className={styles.stepNum} aria-hidden="true">1</span><strong>Spreadsheet</strong><span>CSV or .xlsx</span></div>
                  <input
                    id="csv-file"
                    type="file"
                    accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    className="hidden"
                    onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                  />
                  <label htmlFor="csv-file" className={`${styles.drop} ${importFile ? styles.dropDone : ''}`}>
                    <span className={styles.dropIcon} aria-hidden="true">
                      {importFile ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                      )}
                    </span>
                    <span className={styles.dropText}>
                      <strong>{importFile ? importFile.name : 'Choose a CSV or Excel file'}</strong>
                      <span>{importFile ? `${(importFile.size / 1024).toFixed(1)} KB · click to replace` : 'Click to browse, or drop the file here'}</span>
                    </span>
                  </label>
                </div>

                {/* Step 2 — the photos named in the sheet */}
                <div className={styles.step}>
                  <div className={styles.stepHead}><span className={styles.stepNum} aria-hidden="true">2</span><strong>Product images</strong><span>Optional</span></div>
                  <input
                    id="img-files"
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      setImportImages(files);
                    }}
                  />
                  {/* Hidden directory picker — Chromium/Edge/Safari support webkitdirectory. */}
                  <input
                    id="img-folder"
                    type="file"
                    // @ts-expect-error — webkitdirectory is not in TS DOM types
                    webkitdirectory=""
                    directory=""
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []).filter(
                        (f) => /^image\/(png|jpe?g|webp|gif)$/.test(f.type)
                      );
                      setImportImages(files);
                    }}
                  />
                  <div className={`${styles.drop} ${importImages.length > 0 ? styles.dropDone : ''}`}>
                    <span className={styles.dropIcon} aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
                    </span>
                    <div className={styles.dropText}>
                      <strong>
                        {importImages.length > 0
                          ? `${importImages.length} image${importImages.length === 1 ? '' : 's'} selected`
                          : 'Attach the photos named in the sheet'}
                      </strong>
                      <span>Write just the file name in the <code>images</code> column (e.g. <code>jacket.jpg|jacket-back.jpg</code>) and pick the same files here. Browsers can&rsquo;t read paths from your disk on their own.</span>
                      <div className={styles.dropActions}>
                        <label htmlFor="img-files">Pick files</label>
                        <label htmlFor="img-folder">Pick folder</label>
                        {importImages.length > 0 && (
                          <button type="button" onClick={() => setImportImages([])}>Clear</button>
                        )}
                      </div>
                      {importImages.length > 0 && (
                        <div className={styles.fileList}>
                          {importImages.slice(0, 8).map((f) => f.name).join(' · ')}
                          {importImages.length > 8 ? ` … +${importImages.length - 8} more` : ''}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </ModalBody>

          <ModalFooter>
            {!importResult && (
              <span>{importFile ? `Ready to import ${importFile.name}.` : 'Pick a spreadsheet to continue.'}</span>
            )}
            {importResult ? (
              <>
                <Button variant="bordered" onPress={() => { setImportFile(null); setImportImages([]); setImportResult(null); }}>
                  Import another file
                </Button>
                <Button color="primary" onPress={closeImportModal}>Done</Button>
              </>
            ) : (
              <>
                <Button variant="bordered" onPress={closeImportModal} isDisabled={importing}>Cancel</Button>
                <Button color="primary" onPress={runImport} isLoading={importing} isDisabled={!importFile}>
                  Import products
                </Button>
              </>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'default' | 'good' | 'info' | 'bad' }) {
  const toneClass = { default: '', good: styles.statGood, info: styles.statInfo, bad: styles.statBad }[tone];
  return (
    <div className={`${styles.stat} ${toneClass}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}


/**
 * Compact filter dropdown built on HeroUI Select so it matches the rest of
 * the seller dashboard's design language (instead of the native browser
 * <select> which varied wildly across OSes and felt out of place).
 *
 * - No floating label — the placeholder text inside the trigger already
 *   says "All statuses" / "Any stock" / etc., which is enough to tell the
 *   seller what the dropdown filters.
 * - Fixed width so all four selects align cleanly in the toolbar row.
 * - `selectedKeys` is the controlled value; we re-emit via onSelectionChange.
 */
function FilterSelect({
  ariaLabel, value, onChange, options,
}: {
  ariaLabel: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return <SellerSelect ariaLabel={ariaLabel} value={value} onChange={onChange} options={options} />;
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="text-muted">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
