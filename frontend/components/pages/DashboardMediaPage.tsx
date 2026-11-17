'use client';

/**
 * Seller dashboard — Media / Images tab (/dashboard/media).
 *
 * ONE library, two views (UX audit S8). "Your library 1" stacked over
 * "In use in products 2,697" was two grids nobody could tell apart; now
 * a view switch — Uploads · Used in products — shows one grid at a time
 * with the filters that apply to it. The data stays separate underneath:
 *
 *   1. "Your library" — assets uploaded through THIS page. Backed by
 *      /api/seller/media. Sellers can select these tiles (checkbox
 *      overlay) and delete them individually or in bulk. Deletes are
 *      BLOCKED by the backend when the image is still referenced on
 *      a product (main gallery, per-color, or size chart) — the UI
 *      surfaces the friendly "used by N product(s)" message.
 *
 *   2. "In use in products" — read-only enumeration of every image
 *      key found on the seller's Product docs (main gallery, per-color,
 *      size chart). Backed by GET /products/media/mine (unchanged).
 *      No delete UI here: removing a product-embedded image must go
 *      through the product editor so the strict image guardrails on
 *      the backend apply.
 *
 * Visual layout mirrors the super-admin Media library at
 * `admin/app/media/page.tsx`.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import SellerSelect from '@/components/common/SellerSelect';
import styles from './DashboardMedia.module.css';
import { Card, CardBody, CardHeader } from '@heroui/react';
import Button from '@/components/common/SellerButton';
import Arrow from '@/components/common/Arrow';
import { FilterTabs, RowActions } from '@/components/ui';
import { api, imageUrl, unwrap, unwrapMeta } from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import { notifyError, notifySuccess, notifyWarning, apiMessage, serverText } from '@/lib/notify';
import { M } from '@/lib/messages';

type MediaKind = 'main' | 'color' | 'sizeChart';

type ProductMediaRow = {
  productId: string;
  productSlug: string;
  productName: string;
  updatedAt: string;
  kind: MediaKind;
  color: string | null;
  url: string;
};

type LibraryItem = {
  _id: string;
  key: string;
  url: string;
  filename: string;
  mimeType: string;
  size: number;
  folder: string;
  createdAt: string;
};

const KIND_LABEL: Record<MediaKind, string> = {
  main: 'Main gallery',
  color: 'Per-color',
  sizeChart: 'Size chart',
};

const KIND_OPTIONS: { key: 'all' | MediaKind; label: string }[] = [
  { key: 'all', label: 'All types' },
  { key: 'main', label: 'Main gallery' },
  { key: 'color', label: 'Per-color' },
  { key: 'sizeChart', label: 'Size charts' },
];

const PAGE_SIZE = 48;

function formatBytes(n: number): string {
  if (!n) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export default function DashboardMediaPage() {
  // Library (deletable) state
  const [libItems, setLibItems] = useState<LibraryItem[]>([]);
  const [libTotal, setLibTotal] = useState(0);
  const [libLoading, setLibLoading] = useState(true);
  const [libError, setLibError] = useState<string | null>(null);
  const [libPage, setLibPage] = useState(1);
  const [folders, setFolders] = useState<string[]>([]);
  const [folder, setFolder] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Selection for the "In use in products" grid — keyed by
  // `${productId}::${kind}::${color || ''}::${key}` so identical URLs
  // reused across products don't clobber each other. Cleared whenever
  // the filter set (search/kind) changes so a seller doesn't
  // accidentally delete rows they can't currently see.
  const [prodSelected, setProdSelected] = useState<Set<string>>(new Set());

  // Product-embedded (read-only) state
  const [prodRows, setProdRows] = useState<ProductMediaRow[]>([]);
  const [prodLoading, setProdLoading] = useState(true);
  const [prodError, setProdError] = useState<string | null>(null);
  const [prodPage, setProdPage] = useState(1);
  const [kind, setKind] = useState<'all' | MediaKind>('all');

  // Shared search — debounced input applied to BOTH grids
  /* Which of the two sources the single grid shows (UX audit S8). */
  const [view, setView] = useState<'uploads' | 'products'>('uploads');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  // Upload state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadQueue, setUploadQueue] = useState<{ total: number; done: number }>({
    total: 0,
    done: 0,
  });

  /* ─── debounce search ─── */
  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(searchInput);
      setLibPage(1);
      setProdPage(1);
    }, 250);
    return () => clearTimeout(id);
  }, [searchInput]);

  /* ─── library loader ─── */
  function loadLibrary() {
    setLibLoading(true);
    setLibError(null);
    const params: Record<string, string | number> = { page: libPage, limit: PAGE_SIZE };
    if (search.trim()) params.q = search.trim();
    if (folder) params.folder = folder;
    api
      .get('/seller/media', { params })
      .then((r) => {
        const { data, meta } = unwrapMeta<{ items?: any[]; folders?: string[] }>(r);
        setLibItems(Array.isArray(data?.items) ? data.items : []);
        setLibTotal(meta?.totalItems || 0);
        setFolders(Array.isArray(data?.folders) ? data.folders : []);
      })
      .catch((e: any) => {
        setLibItems([]);
        setLibTotal(0);
        setLibError(apiMessage(e) || 'Could not load library.');
      })
      .finally(() => setLibLoading(false));
  }

  useEffect(() => {
    loadLibrary();
    // Clear selection whenever the filter set / page changes so a
    // seller doesn't accidentally delete rows they can't currently see.
    setSelected(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libPage, search, folder]);

  /* ─── product-embedded loader ─── */
  function loadProdMedia() {
    setProdLoading(true);
    setProdError(null);
    return api
      .get('/products/media/mine')
      .then((r) => {
        const { items } = unwrap<{ items?: any[] }>(r);
        setProdRows(Array.isArray(items) ? items : []);
      })
      .catch((e: any) => {
        setProdError(apiMessage(e) || 'Could not load product images.');
      })
      .finally(() => {
        setProdLoading(false);
      });
  }

  useEffect(() => {
    loadProdMedia();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ─── product-embedded client-side filter + paging ─── */
  const filteredProd = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return prodRows.filter((r) => {
      if (kind !== 'all' && r.kind !== kind) return false;
      if (!needle) return true;
      if (r.productName.toLowerCase().includes(needle)) return true;
      if (r.color && r.color.toLowerCase().includes(needle)) return true;
      const filename = r.url.split('/').pop() || '';
      if (filename.toLowerCase().includes(needle)) return true;
      return false;
    });
  }, [prodRows, search, kind]);

  useEffect(() => {
    setProdPage(1);
    // Different filter set → different visible rows; drop the selection
    // so we don't delete something the seller can no longer see.
    setProdSelected(new Set());
  }, [kind]);

  // Also clear the product selection whenever the debounced search
  // changes — same reasoning as above.
  useEffect(() => {
    setProdSelected(new Set());
  }, [search]);

  const prodTotalPages = Math.max(1, Math.ceil(filteredProd.length / PAGE_SIZE));
  const prodPageItems = useMemo(
    () => filteredProd.slice((prodPage - 1) * PAGE_SIZE, prodPage * PAGE_SIZE),
    [filteredProd, prodPage],
  );

  const libTotalPages = Math.max(1, Math.ceil(libTotal / PAGE_SIZE));

  /* ─── selection helpers ─── */
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSelection() {
    setSelected(new Set());
  }
  function toggleSelectAll() {
    if (libItems.length === 0) return;
    const allSet = selected.size === libItems.length;
    setSelected(allSet ? new Set() : new Set(libItems.map((m) => m._id)));
  }

  /* ─── prod-embedded selection helpers ─── */
  function prodRowKey(row: ProductMediaRow): string {
    return `${row.productId}::${row.kind}::${row.color || ''}::${row.url}`;
  }
  function toggleProdOne(row: ProductMediaRow) {
    const id = prodRowKey(row);
    setProdSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearProdSelection() {
    setProdSelected(new Set());
  }

  /* ─── copy URL ─────────────────────────────────────────────────
   * "Copy URL" should give the seller a direct, hotlinkable S3 URL
   * they can paste into WhatsApp / marketing tools / emails — NOT
   * the internal /api/files/<key> proxy path. We hit
   * POST /seller/media/presign to mint a fresh 7-day presigned URL,
   * then drop that on the clipboard. The endpoint verifies the seller
   * actually owns the key, so this is safe even when called for a
   * product-embedded image that isn't in the library.
   * ─────────────────────────────────────────────────────────────── */
  async function copyDirectS3Url(key: string) {
    // Non-standard `clipboard.writeText` behaviour in some browsers:
    // the write must happen inside the click handler's task tick, not
    // after an awaited fetch. So we fetch first, then write.
    let signed: string | null = null;
    try {
      const data = unwrap<{ url?: string }>(await api.post('/seller/media/presign', { key }));
      signed = String(data?.url || '') || null;
    } catch (e: any) {
      notifyError(e, M.media.couldntCreateAShareableLink);
      return;
    }
    if (!signed) {
      notifyWarning(M.media.couldNotGenerateAShareableURL);
      return;
    }
    try {
      await navigator.clipboard.writeText(signed);
      notifySuccess(M.media.directURLCopiedGoodFor7Days);
    } catch {
      // Clipboard permission denied — fall back to a manual paste hint.
      notifyWarning(M.media.copyBlocked(signed.slice(0, 60)));
    }
  }

  async function copyProdUrl(row: ProductMediaRow) {
    // row.url is a bare S3 key (no /api/files prefix) coming from the
    // /products/media/mine endpoint, so pass it straight through.
    await copyDirectS3Url(row.url);
  }
  async function copyLibraryUrl(m: LibraryItem) {
    // Library items store the bare S3 key in `key` — prefer that over
    // `url` (which may already be a proxy path).
    await copyDirectS3Url(m.key || m.url);
  }

  /* ─── upload ─── */
  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    setUploadQueue({ total: files.length, done: 0 });
    let failed = 0;
    // Sequential — one bad file doesn't kill the batch, and the progress
    // chip stays accurate.
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const fd = new FormData();
        fd.append('files', file);
        await api.post('/seller/media/upload', fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      } catch (err: any) {
        failed += 1;
        // eslint-disable-next-line no-console
        console.warn('Upload failed:', file.name, err?.message);
      }
      setUploadQueue((q) => ({ ...q, done: i + 1 }));
    }
    setUploadQueue({ total: 0, done: 0 });
    if (failed > 0) {
      notifyWarning(M.media.uploadsFailed(failed, files.length));
    } else {
      notifySuccess(M.media.uploadedFiles(files.length));
    }
    loadLibrary();
  }

  /* ─── delete (single + bulk) ─── */
  async function removeOne(m: LibraryItem) {
    const label = m.filename || m.key.split('/').pop() || 'this image';
    if (
      !(await confirmDialog({
        title: 'Delete from library',
        message: `Delete "${label}"? The underlying storage object is removed too. If it's still used on a product, the delete will be blocked.`,
        destructive: true,
        confirmLabel: 'Delete',
      }))
    )
      return;
    try {
      await api.delete(`/seller/media/${m._id}`);
      notifySuccess(M.media.deleted);
      loadLibrary();
    } catch (err: any) {
      const body = err?.response?.data;
      if (body && body.code === 'IN_USE') {
        // The backend's sentence names the product to open — shown as the reason.
        notifyError(err, M.media.thisImageIsStillInUse);
        return;
      }
      notifyError(err, M.media.couldntDeleteTheImage);
    }
  }

  async function removeBulk() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (
      !(await confirmDialog({
        title: `Delete ${ids.length} item${ids.length === 1 ? '' : 's'}`,
        message: `Remove ${ids.length} asset${
          ids.length === 1 ? '' : 's'
        } from your library. Items still used on a product will be skipped — you'll see a summary after.`,
        destructive: true,
        confirmLabel: `Delete ${ids.length}`,
      }))
    )
      return;
    try {
      const data = unwrap<{ deleted?: number; blocked?: any[] }>(await api.post('/seller/media/bulk-delete', { ids }));
      const deleted = data?.deleted ?? 0;
      const blocked = Array.isArray(data?.blocked) ? data.blocked : [];
      if (deleted > 0 && blocked.length === 0) {
        notifySuccess(M.media.deleted2(deleted));
      } else if (deleted > 0 && blocked.length > 0) {
        notifySuccess(M.media.deletedSomeInUse(deleted, blocked.length));
      } else if (deleted === 0 && blocked.length > 0) {
        notifyWarning(M.media.nothingDeletedInUse(blocked.length));
      } else {
        notifyWarning(M.media.nothingDeleted);
      }
      clearSelection();
      loadLibrary();
    } catch (err: any) {
      notifyError(err, M.media.couldntDeleteTheSelectedItems);
    }
  }

  /* ─── delete product-embedded image (single) ───────────────────
   * Single-item POST to /products/media/bulk-remove so the same
   * schema-aware "don't strand the last image" logic runs. On the
   * LAST_IMAGE block the backend sends back a friendly message
   * naming the product — we surface it verbatim.
   * ─────────────────────────────────────────────────────────────── */
  async function removeProdOne(row: ProductMediaRow) {
    if (
      !(await confirmDialog({
        title: 'Delete product image',
        message: `Delete this image from ${row.productName}? It'll be removed from your storefront listing.`,
        destructive: true,
        confirmLabel: 'Delete',
      }))
    )
      return;
    try {
      const data = unwrap<{ removed?: number; blocked?: any[] }>(await api.post('/products/media/bulk-remove', {
        items: [
          { productId: row.productId, kind: row.kind, color: row.color || '', key: row.url },
        ],
      }));
      const removed = data?.removed ?? 0;
      const blocked = Array.isArray(data?.blocked) ? data.blocked : [];
      if (removed > 0) {
        notifySuccess(M.media.deleted);
      } else if (blocked.length > 0 && blocked[0]?.reason === 'LAST_IMAGE') {
        notifyWarning(M.media.lastImageOnProduct(row.productName));
      } else if (blocked.length > 0) {
        notifyWarning(serverText(blocked[0]?.message) || 'Couldn’t delete that image');
      } else {
        notifyWarning(M.media.nothingDeleted);
      }
      await loadProdMedia();
      loadLibrary();
    } catch (err: any) {
      notifyError(err, M.media.couldntDelete);
    }
  }

  /* ─── bulk delete product-embedded images ───────────────────── */
  async function bulkDeleteProdImages() {
    const rows = prodRows.filter((r) => prodSelected.has(prodRowKey(r)));
    if (rows.length === 0) return;
    if (
      !(await confirmDialog({
        title: `Delete ${rows.length} product image${rows.length === 1 ? '' : 's'}`,
        message: `Remove ${rows.length} image${
          rows.length === 1 ? '' : 's'
        } from your product listings. If removing an image would leave a product with none, that product will be skipped — you'll see a summary after.`,
        destructive: true,
        confirmLabel: `Delete ${rows.length}`,
      }))
    )
      return;
    try {
      const items = rows.map((r) => ({
        productId: r.productId,
        kind: r.kind,
        color: r.color || '',
        key: r.url,
      }));
      const data = unwrap<{ removed?: number; blocked?: any[] }>(await api.post('/products/media/bulk-remove', { items }));
      const removed = data?.removed ?? 0;
      const blocked = Array.isArray(data?.blocked) ? data.blocked : [];
      if (removed > 0 && blocked.length === 0) {
        notifySuccess(M.media.deleted3(removed));
      } else if (removed > 0 && blocked.length > 0) {
        notifySuccess(M.media.deletedSomeWouldEmpty(removed, blocked.length));
      } else if (removed === 0 && blocked.length > 0) {
        notifyWarning(M.media.nothingDeletedWouldEmpty(blocked.length));
      } else {
        notifyWarning(M.media.nothingDeleted);
      }
      clearProdSelection();
      await loadProdMedia();
      loadLibrary();
    } catch (err: any) {
      notifyError(err, M.media.couldntDeleteTheSelectedItems);
    }
  }

  const uploading = uploadQueue.total > 0;
  const allSelected = libItems.length > 0 && selected.size === libItems.length;

  return (
    <div className={styles.page}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        multiple
        className="hidden"
        onChange={(e) => {
          const list = Array.from(e.target.files || []);
          if (list.length > 0) uploadFiles(list);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }}
      />
      <h1 className="sr-only">Media</h1>
      <div className="flex flex-wrap items-center justify-end gap-3 mb-5"><Button className={styles.primary} isLoading={uploading} onPress={() => fileInputRef.current?.click()}>
          {uploading ? `Uploading ${uploadQueue.done}/${uploadQueue.total}…` : '+ Upload images'}
        </Button></div>
      <section className={styles.workspace} aria-label="Media library">
      <div className={styles.libraryHeader}><h2>Your images</h2><p>Keep your uploads and product images in one place.</p></div>
      <div className={styles.tabs}>
        <FilterTabs ariaLabel="Media view" onChange={(id) => setView(id as 'uploads' | 'products')}
          tabs={[
            { id: 'uploads', label: 'Uploads', count: libLoading ? undefined : libTotal },
            { id: 'products', label: 'Used in products', count: prodLoading ? undefined : prodRows.length },
          ]} value={view} variant="secondary" />
      </div>
      <div className={styles.filters}>
        <label className={styles.search}><span className="sr-only">Search images</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>
          <input type="search" placeholder={view === 'uploads' ? 'Search filename…' : 'Search product or colour…'} value={searchInput} onChange={event => setSearchInput(event.target.value)} />
        </label>
        <div className={styles.filterActions}>
        <div className={styles.filterSelect}>
          {view === 'uploads' ? <SellerSelect ariaLabel="Folder" value={folder} onChange={setFolder} fullWidth
            options={[{value: '', label: 'All folders'}, ...folders.filter(Boolean).map(f => ({value:f,label:f}))]} />
            : <SellerSelect ariaLabel="Image type" value={kind} onChange={value => setKind(value as typeof kind)} fullWidth
              options={KIND_OPTIONS.map(option => ({value:option.key,label:option.label}))} />}
        </div>
        {(searchInput || (view === 'uploads' ? folder : kind !== 'all')) && <button type="button" className={styles.clear} onClick={() => { setSearchInput(''); setFolder(''); setKind('all'); }}>Clear filters</button>}
        </div>
      </div>

      {/* One selection bar, for whichever view is showing. */}
      {view === 'uploads' && selected.size > 0 && (
        <div className={styles.selectionBar}>
          <div className={styles.selectionCount} role="status">
            <span className="font-semibold">{selected.size}</span> selected
          </div>
          <div className={styles.selectionActions}>
            <Button size="sm" variant="bordered" className={styles.clear} onPress={clearSelection}>Clear selection</Button>
            <Button size="sm" color="danger" onPress={removeBulk}>Delete selected</Button>
          </div>
        </div>
      )}
      {view === 'products' && prodSelected.size > 0 && (
        <div className={styles.selectionBar}>
          <div className={styles.selectionCount} role="status">
            <span className="font-semibold">{prodSelected.size}</span> product image{prodSelected.size === 1 ? '' : 's'} selected
          </div>
          <div className={styles.selectionActions}>
            <Button size="sm" variant="bordered" className={styles.clear} onPress={clearProdSelection}>Clear selection</Button>
            <Button size="sm" color="danger" onPress={bulkDeleteProdImages}>Remove from products</Button>
          </div>
        </div>
      )}

      {/* Uploads view */}
      {view === 'uploads' && (
      <Card className={styles.gridCard}>
        <CardHeader className={styles.gridHeader}>
          <label className="flex items-center gap-3 text-sm text-muted">
            {libItems.length > 0 && (
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleSelectAll}
                aria-label="Select all on this page"
                className="w-4 h-4 accent-accent cursor-pointer"
              />
            )}
            <span>{libTotal} upload{libTotal === 1 ? '' : 's'}</span>
          </label>
          {libTotalPages > 1 && (
            <div className="text-xs text-muted">
              Page {libPage} of {libTotalPages}
            </div>
          )}
        </CardHeader>

        <CardBody className={styles.gridBody}>
          {libLoading ? (
            <MediaGridSkeleton label="Loading your library" />
          ) : libError ? (
            <div className="rounded-lg border border-danger/25 bg-danger-soft p-4 text-sm text-danger-soft-foreground">
              {libError}
            </div>
          ) : libTotal === 0 ? (
            search || folder ? <div className={styles.empty}><h3>No images match your filters</h3><p>Try another filename or folder.</p><button className={styles.clear} onClick={() => { setSearchInput(''); setFolder(''); }}>Clear filters</button></div> : <LibraryEmptyState onUploadClick={() => fileInputRef.current?.click()} />
          ) : (
            <>
              <div className={styles.grid}>
                {libItems.map((m) => (
                  <LibraryTile
                    key={m._id}
                    item={m}
                    selected={selected.has(m._id)}
                    onToggle={() => toggleOne(m._id)}
                    onCopy={() => copyLibraryUrl(m)}
                    onDelete={() => removeOne(m)}
                  />
                ))}
              </div>

              {libTotalPages > 1 && (
                <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-4">
                  <Button
                    size="sm"
                    variant="bordered"
                    isDisabled={libPage <= 1}
                    onPress={() => setLibPage((p) => Math.max(1, p - 1))}
                  >
                    <Arrow dir="left" /> Prev
                  </Button>
                  <div className="text-xs text-muted">
                    Showing {(libPage - 1) * PAGE_SIZE + 1}–
                    {Math.min(libPage * PAGE_SIZE, libTotal)} of {libTotal}
                  </div>
                  <Button
                    size="sm"
                    variant="bordered"
                    isDisabled={libPage >= libTotalPages}
                    onPress={() => setLibPage((p) => Math.min(libTotalPages, p + 1))}
                  >
                    Next <Arrow />
                  </Button>
                </div>
              )}
            </>
          )}
        </CardBody>
      </Card>
      )}

      {/* Used-in-products view */}
      {view === 'products' && (
      <Card className={styles.gridCard}>
        <CardHeader className={styles.gridHeader}>
          <div className="text-sm text-muted">
            {filteredProd.length} image{filteredProd.length === 1 ? '' : 's'} on your listings
          </div>
          {prodTotalPages > 1 && (
            <div className="text-xs text-muted">
              Page {prodPage} of {prodTotalPages}
            </div>
          )}
        </CardHeader>
        <CardBody className={styles.gridBody}>
          <div className="mb-3 text-xs text-muted">
            Added through the product form or bulk import. Removing one takes it off that listing — the last image on a product is protected.
          </div>
          {prodLoading ? (
            <MediaGridSkeleton label="Loading product images" />
          ) : prodError ? (
            <div className="rounded-lg border border-danger/25 bg-danger-soft p-4 text-sm text-danger-soft-foreground">
              {prodError}
            </div>
          ) : filteredProd.length === 0 ? (
            <ProductEmptyState hasAny={prodRows.length > 0} />
          ) : (
            <>
              <div className={styles.grid}>
                {prodPageItems.map((row, i) => (
                  <ProductTile
                    key={`${row.productId}-${row.url}-${(prodPage - 1) * PAGE_SIZE + i}`}
                    row={row}
                    selected={prodSelected.has(prodRowKey(row))}
                    onToggle={() => toggleProdOne(row)}
                    onCopy={copyProdUrl}
                    onDelete={removeProdOne}
                  />
                ))}
              </div>

              {prodTotalPages > 1 && (
                <div className="mt-6 flex items-center justify-between gap-3 border-t border-border pt-4">
                  <Button
                    size="sm"
                    variant="bordered"
                    isDisabled={prodPage <= 1}
                    onPress={() => setProdPage((p) => Math.max(1, p - 1))}
                  >
                    <Arrow dir="left" /> Prev
                  </Button>
                  <div className="text-xs text-muted">
                    Showing {(prodPage - 1) * PAGE_SIZE + 1}–
                    {Math.min(prodPage * PAGE_SIZE, filteredProd.length)} of{' '}
                    {filteredProd.length}
                  </div>
                  <Button
                    size="sm"
                    variant="bordered"
                    isDisabled={prodPage >= prodTotalPages}
                    onPress={() => setProdPage((p) => Math.min(prodTotalPages, p + 1))}
                  >
                    Next <Arrow />
                  </Button>
                </div>
              )}
            </>
          )}
        </CardBody>
      </Card>
      )}
      </section>
    </div>
  );
}

/* ─── grid skeleton ────────────────────────────────────────────────
   Tile-shaped loading state for both grids. A centred spinner reserved
   no height, so the whole page jumped when 48 tiles landed; this keeps
   the grid's footprint and reads as "images coming". One shimmer sweep
   across the block (see themes/nude.css), announced once for screen
   readers. */
function MediaGridSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="skeleton--shimmer relative overflow-hidden">
      <span className="sr-only">{label}</span>
      <div aria-hidden className={styles.grid}>
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-border overflow-hidden">
            <div className="aspect-square bg-surface-secondary" />
            <div className="p-2">
              <div className="h-3 w-3/4 rounded bg-surface-secondary" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── library tile (deletable) ─────────────────────────────────── */

function LibraryTile({
  item,
  selected,
  onToggle,
  onCopy,
  onDelete,
}: {
  item: LibraryItem;
  selected: boolean;
  onToggle: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const filename =
    (item.filename || item.key.split('/').pop() || item.key).slice(0, 80);
  return (
    <div
      className={`group relative rounded-lg border overflow-hidden bg-white flex flex-col transition ${
        selected
          ? 'border-slate-600 ring-1 ring-slate-600'
          : 'border-border'
      }`}
      title={filename}
    >
      {/* Checkbox overlay */}
      <button
        type="button"
        onClick={onToggle}
        className="absolute top-1.5 left-1.5 z-10 w-6 h-6 rounded-md bg-white/95 border border-border grid place-items-center shadow-sm"
        aria-label={`${selected ? 'Deselect' : 'Select'} ${filename}`}
        aria-pressed={selected}
      >
        {selected ? (
          <span className="text-foreground text-sm leading-none">✓</span>
        ) : (
          <span className="block w-3 h-3 rounded-sm" />
        )}
      </button>
      <button
        type="button"
        onClick={onToggle}
        className="relative aspect-square bg-surface-secondary block w-full"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.url}
          alt={item.filename || ''}
          className={styles.image}
          loading="lazy"
        />
      </button>
      <div className={styles.tileInfo}>
        <div className="truncate font-medium text-foreground" title={filename}>
          {filename}
        </div>
        <div className="text-muted truncate">
          {item.folder || '—'} · {formatBytes(item.size)}
        </div>
      </div>
      {/* Actions behind a ⋯ that appears on hover / focus (UX audit S8):
          the two flat buttons crushed to "Co…" / "D" at tile width. */}
      <div className="absolute right-1.5 top-1.5 z-10">
        <RowActions
          ariaLabel={`Actions for ${filename}`}
          items={[
            { key: 'copy', label: 'Copy image URL', onSelect: onCopy },
            { key: 'delete', label: 'Delete…', hint: 'Blocked while a product uses it', tone: 'danger', onSelect: onDelete },
          ]}
        />
      </div>
    </div>
  );
}

/* ─── product-embedded tile (read-only) ────────────────────────── */

function ProductTile({
  row,
  selected,
  onToggle,
  onCopy,
  onDelete,
}: {
  row: ProductMediaRow;
  selected: boolean;
  onToggle: () => void;
  onCopy: (row: ProductMediaRow) => void;
  onDelete: (row: ProductMediaRow) => void;
}) {
  const router = useRouter();
  const filename = (row.url.split('/').pop() || row.url).slice(0, 80);
  const kindTag =
    row.kind === 'main'
      ? 'Main'
      : row.kind === 'color'
      ? `Color · ${row.color || '—'}`
      : 'Size chart';

  const src = imageUrl(row.url);

  return (
    <div
      className={`group relative rounded-lg border overflow-hidden bg-white flex flex-col transition ${
        selected
          ? 'border-slate-600 ring-1 ring-slate-600'
          : 'border-border'
      }`}
      title={`${row.productName} — ${filename}`}
    >
      {/* Checkbox overlay — select for bulk delete */}
      <button
        type="button"
        onClick={onToggle}
        className="absolute top-1.5 left-1.5 z-10 w-6 h-6 rounded-md bg-white/95 border border-border grid place-items-center shadow-sm"
        aria-label={`${selected ? 'Deselect' : 'Select'} ${filename}`}
        aria-pressed={selected}
        title={KIND_LABEL[row.kind]}
      >
        {selected ? (
          <span className="text-foreground text-sm leading-none">✓</span>
        ) : (
          <span className="block w-3 h-3 rounded-sm" />
        )}
      </button>

      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        className="relative aspect-square bg-surface-secondary block w-full group"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={row.productName}
          className={styles.image}
          loading="lazy"
        />
      </a>

      <div className={styles.tileInfo}>
        <div className="truncate font-medium text-foreground" title={filename}>
          {filename}
        </div>
        <div className="text-muted truncate" title={`${row.productName} · ${kindTag}`}>
          <Link
            href={`/dashboard/products/${row.productSlug}`}
            className="hover:text-foreground hover:underline"
          >
            {row.productName}
          </Link>
          {' · '}
          {kindTag}
        </div>
      </div>
      <div className="absolute right-1.5 top-1.5 z-10">
        <RowActions
          ariaLabel={`Actions for ${filename}`}
          items={[
            { key: 'copy', label: 'Copy image URL', onSelect: () => onCopy(row) },
            { key: 'edit', label: 'Edit product', hint: row.productName, onSelect: () => router.push(`/dashboard/products/${row.productSlug}`) },
            { key: 'delete', label: 'Remove from product…', hint: 'The last image on a product is kept', tone: 'danger', onSelect: () => onDelete(row) },
          ]}
        />
      </div>
    </div>
  );
}

/* ─── empty states ─────────────────────────────────────────────── */

function LibraryEmptyState({ onUploadClick }: { onUploadClick: () => void }) {
  return (
    <div className={styles.empty}>
      <div className="mx-auto w-12 h-12 rounded-full bg-surface border border-border grid place-items-center mb-4">
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
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      </div>
      <div className="text-sm font-semibold text-foreground">Your library is empty</div>
      <div className="text-xs text-muted mt-1 max-w-md mx-auto">
        Upload images here to reuse them across your product listings.
      </div>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Button
          size="sm"
          onPress={onUploadClick}
          className={styles.primary}
        >
          Upload files
        </Button>
      </div>
    </div>
  );
}


function ProductEmptyState({ hasAny }: { hasAny: boolean }) {
  return (
    <div className={styles.empty}>
      <div className="text-sm font-semibold text-foreground">
        {hasAny ? 'No matches for this filter' : 'No product images yet'}
      </div>
      <div className="text-xs text-muted mt-1 max-w-md mx-auto">
        {hasAny
          ? 'Try clearing the search or the type filter to see the rest of your images.'
          : 'Images uploaded through the product form or bulk import will show up here.'}
      </div>
    </div>
  );
}
