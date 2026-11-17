'use client';

/**
 * MediaPickerModal — shared media picker for the seller product form.
 *
 * Every "+ Add images" / "Click to upload" surface on the product form
 * opens THIS modal instead of the native file picker. The modal has
 * two tabs:
 *
 *   1) "Your library" (default) — paginated grid of the seller's own
 *      SellerMedia items. Multi-select via checkbox overlays. Users
 *      can pick previously-uploaded assets without re-uploading them.
 *
 *   2) "Upload new" — dashed dropzone + file input. On submit, POSTs
 *      each file to /api/seller/media/upload (existing endpoint —
 *      creates SellerMedia rows and returns the new items). Newly
 *      uploaded items are auto-selected, then the tab flips back to
 *      "Your library" so the user sees them highlighted before
 *      confirming.
 *
 * The picker returns S3 KEYS (not ids) via onInsert(keys). The parent
 * form maps those keys onto its own ImageItem/ColorImageItem/APlusItem
 * shapes as `kind: 'kept'` tiles — same code path a re-opened edit
 * form uses for images already on the product.
 *
 * Per-surface constraints (main gallery / per-color / size chart /
 * A+ slot) collapse to a single `maxSelect` prop. When maxSelect is
 * 1 the picker enforces single-select semantics: picking a new tile
 * replaces the current selection instead of adding to it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  Input,
  Spinner,
} from '@heroui/react';
import toast from 'react-hot-toast';
import { api, imageUrl, unwrap, unwrapMeta } from '@/lib/api';
import { notifySuccess, notifyWarning, apiMessage } from '@/lib/notify';
import { M } from '@/lib/messages';

// Matches the shape the backend returns from GET /seller/media and
// POST /seller/media/upload. We only care about the id + key + url +
// filename for the picker UI.
type SellerMediaItem = {
  _id: string;
  key: string;
  url: string;
  filename: string;
  size?: number;
  mimeType?: string;
};

const PAGE_SIZE = 24;

type Props = {
  open: boolean;
  onClose: () => void;
  onInsert: (keys: string[]) => void;
  /** Cap on how many tiles can be selected at once. Default = Infinity. */
  maxSelect?: number;
  /** Shortcut for maxSelect = 1. When true, picking a tile replaces
   *  the current selection instead of adding to it. */
  singleSelect?: boolean;
  /** Displayed in the modal header. */
  title?: string;
};

export default function MediaPickerModal({
  open,
  onClose,
  onInsert,
  maxSelect,
  singleSelect,
  title = 'Add images',
}: Props) {
  const effectiveMax =
    singleSelect || maxSelect === 1
      ? 1
      : typeof maxSelect === 'number' && maxSelect > 0
      ? maxSelect
      : Infinity;
  const isSingle = effectiveMax === 1;

  const [activeTab, setActiveTab] = useState<'library' | 'upload'>('library');

  // Library state
  const [libItems, setLibItems] = useState<SellerMediaItem[]>([]);
  const [libTotal, setLibTotal] = useState(0);
  // Total number of paginated SellerMedia rows only — drives
  // pagination. `libTotal` above includes the extra product-embedded
  // items shown on page 1, so it must NOT be used for page math.
  const [libMediaTotal, setLibMediaTotal] = useState(0);
  const [libLoading, setLibLoading] = useState(false);
  const [libError, setLibError] = useState<string | null>(null);
  const [libPage, setLibPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');

  // Selection is keyed by SellerMedia _id — every tile (library or
  // freshly-uploaded) has one. On Insert we resolve ids -> keys by
  // looking each id up in libItems.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Upload state
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadQueue, setUploadQueue] = useState<{ total: number; done: number }>({
    total: 0,
    done: 0,
  });
  const [isDragging, setIsDragging] = useState(false);

  const totalPages = Math.max(1, Math.ceil(libMediaTotal / PAGE_SIZE));

  /* ─── Reset when the modal opens ─── */
  useEffect(() => {
    if (!open) return;
    setActiveTab('library');
    setSelected(new Set());
    setSearchInput('');
    setSearch('');
    setLibPage(1);
    // libItems reload is driven by the loader effect below.
  }, [open]);

  /* ─── Debounce the search input ─── */
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => {
      setSearch(searchInput.trim());
      setLibPage(1);
    }, 250);
    return () => clearTimeout(id);
  }, [searchInput, open]);

  /* ─── Library loader — fires on open / page / search change ─────
   *
   * Loads TWO sources in parallel and merges them into a single list:
   *
   *   A) /seller/media                 — SellerMedia rows (uploaded via
   *                                      this picker or the Media tab)
   *   B) /products/media/mine          — every image key currently
   *                                      referenced by the seller's
   *                                      product docs (main gallery,
   *                                      per-color, size chart)
   *
   * Why merge: a seller's mental model is "any image I've ever
   * uploaded should be pickable here." Historically, images added
   * through the product form landed only in Product.images and never
   * in SellerMedia, so the library felt empty. By merging both
   * sources at read time we surface every image the seller owns
   * without a data migration.
   *
   * Dedup key = S3 key. When the same key appears in both feeds
   * (SellerMedia row exists AND a product references it), the
   * SellerMedia version wins because it has a real _id we can use
   * for delete/edit later.
   *
   * Pagination stays server-side for /seller/media only. The
   * product-embedded feed is small and returned in one shot, so we
   * merge it AFTER paging the library rows — a rough but pragmatic
   * approximation. Any duplicates trim the library page's visible
   * count; acceptable for the picker's UX. */
  const loadLibrary = useCallback(() => {
    setLibLoading(true);
    setLibError(null);
    const params: Record<string, string | number> = {
      page: libPage,
      limit: PAGE_SIZE,
    };
    if (search) params.q = search;

    Promise.all([
      api.get('/seller/media', { params })
        .then((r) => { const { data, meta } = unwrapMeta<{ items?: SellerMediaItem[] }>(r); return { data: { items: data.items || [], total: meta?.totalItems || 0 } }; })
        .catch(() => ({ data: { items: [], total: 0 } })),
      // Only fetch product-embedded images on the first page so the
      // list doesn't repeat them across pages. A seller can search to
      // find one, but scrolling paged results keeps to library items.
      libPage === 1
        ? api.get('/products/media/mine')
          .then((r) => ({ data: { items: unwrap<{ items?: any[] }>(r).items || [] } }))
          .catch(() => ({ data: { items: [] } }))
        : Promise.resolve({ data: { items: [] } }),
    ])
      .then(([libRes, prodRes]) => {
        const libItemsRaw: SellerMediaItem[] = Array.isArray((libRes as any).data?.items)
          ? (libRes as any).data.items
          : [];
        const total = typeof (libRes as any).data?.total === 'number'
          ? (libRes as any).data.total
          : 0;

        // Convert product-embedded rows to SellerMediaItem shape so
        // they render through the same tile component.
        const prodRowsRaw: Array<{
          productId: string;
          productName?: string;
          url: string;
          kind: 'main' | 'color' | 'sizeChart';
          color?: string | null;
        }> = Array.isArray((prodRes as any).data?.items)
          ? (prodRes as any).data.items
          : [];
        const needle = search.toLowerCase();
        const prodItems: SellerMediaItem[] = prodRowsRaw
          .filter((r) => {
            if (!needle) return true;
            const filename = (r.url.split('/').pop() || '').toLowerCase();
            const name = (r.productName || '').toLowerCase();
            const color = (r.color || '').toLowerCase();
            return (
              filename.includes(needle) ||
              name.includes(needle) ||
              color.includes(needle)
            );
          })
          .map((r) => {
            const filename = r.url.split('/').pop() || r.url;
            // Synthetic id — the key itself. Not a real SellerMedia
            // doc, so any delete/edit path that needs an _id will
            // no-op cleanly (the picker only uses the id for
            // selection state). Prefix so it can never collide with
            // an ObjectId string.
            return {
              _id: `p:${r.url}`,
              key: r.url,
              url: imageUrl(r.url),
              filename,
              size: 0,
              mimeType: '',
            } as SellerMediaItem;
          });

        // Merge + dedup by key. Library items win.
        const byKey = new Map<string, SellerMediaItem>();
        for (const item of libItemsRaw) byKey.set(item.key, item);
        for (const item of prodItems) {
          if (!byKey.has(item.key)) byKey.set(item.key, item);
        }

        setLibItems(Array.from(byKey.values()));
        setLibTotal(total + prodItems.length);
        setLibMediaTotal(total);
      })
      .catch((e: any) => {
        setLibItems([]);
        setLibTotal(0);
        setLibMediaTotal(0);
        setLibError(
          apiMessage(e) || 'Could not load your library. Try again.',
        );
      })
      .finally(() => setLibLoading(false));
  }, [libPage, search]);

  useEffect(() => {
    if (!open) return;
    loadLibrary();
  }, [open, loadLibrary]);

  /* ─── Selection helpers ─── */
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      if (isSingle) {
        // Single-select mode: replace whatever was picked before.
        return new Set([id]);
      }
      if (next.size >= effectiveMax) {
        notifyWarning(M.mediaPickerModal.pickLimit(effectiveMax));
        return prev;
      }
      next.add(id);
      return next;
    });
  }

  /* ─── Upload handler ───────────────────────────────────────────
   * Sequential POSTs so one bad file doesn't take down the batch.
   * On success we merge the returned SellerMedia items into the
   * front of libItems (they're the newest, and the library sorts
   * by createdAt desc), auto-select them (respecting maxSelect), and
   * flip back to the Library tab so the user sees them highlighted.
   * ─────────────────────────────────────────────────────────────── */
  const uploadFiles = useCallback(
    async (files: File[]) => {
      const list = files.filter((f) => f && f.size > 0);
      if (list.length === 0) return;
      if (isSingle && list.length > 1) {
        toast('This slot only takes one image — uploading just the first.');
      }
      const toUpload = isSingle ? list.slice(0, 1) : list;
      setUploadQueue({ total: toUpload.length, done: 0 });

      const uploaded: SellerMediaItem[] = [];
      let failed = 0;
      for (let i = 0; i < toUpload.length; i++) {
        const file = toUpload[i];
        try {
          const fd = new FormData();
          fd.append('files', file);
          const data = unwrap<{ items?: SellerMediaItem[] }>(await api.post('/seller/media/upload', fd, {
            headers: { 'Content-Type': 'multipart/form-data' },
          }));
          const items: SellerMediaItem[] = Array.isArray(data?.items) ? data.items : [];
          uploaded.push(...items);
        } catch (err: any) {
          failed += 1;
          // eslint-disable-next-line no-console
          console.warn('[MediaPicker] upload failed', file.name, err?.message);
        }
        setUploadQueue((q) => ({ ...q, done: i + 1 }));
      }
      setUploadQueue({ total: 0, done: 0 });

      if (uploaded.length > 0) {
        // Merge newest first, deduped by _id in case the same key was
        // re-uploaded (backend upserts to the same row).
        setLibItems((prev) => {
          const seen = new Set(uploaded.map((u) => u._id));
          const kept = prev.filter((p) => !seen.has(p._id));
          return [...uploaded, ...kept];
        });
        // Bump the recorded total so the "N items" counter tracks reality
        // until the next server refresh.
        setLibTotal((n) => n + uploaded.length);
        setLibMediaTotal((n) => n + uploaded.length);

        // Auto-select the fresh uploads, respecting maxSelect. In
        // single-select mode take just the first, replacing whatever
        // was picked before.
        setSelected((prev) => {
          if (isSingle) return new Set([uploaded[0]._id]);
          const next = new Set(prev);
          for (const u of uploaded) {
            if (next.size >= effectiveMax) break;
            next.add(u._id);
          }
          return next;
        });
        setActiveTab('library');
        notifySuccess(M.mediaPickerModal.uploadedAndSelected(uploaded.length));
      }
      if (failed > 0) {
        notifyWarning(M.mediaPickerModal.uploadsFailed(failed, toUpload.length));
      }
    },
    [effectiveMax, isSingle],
  );

  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files || []);
    if (list.length > 0) uploadFiles(list);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const list = Array.from(e.dataTransfer.files || []).filter((f) =>
      f.type.startsWith('image/'),
    );
    if (list.length > 0) uploadFiles(list);
  }

  /* ─── Insert / confirm ───
   * Resolve selected ids -> S3 keys by looking each id up in libItems.
   * Freshly-uploaded items always exist in libItems because uploadFiles
   * merges them in before flipping the tab.
   */
  function handleInsert() {
    if (selected.size === 0) return;
    const byId = new Map(libItems.map((m) => [m._id, m]));
    const keys: string[] = [];
    for (const id of selected) {
      const item = byId.get(id);
      if (item?.key) keys.push(item.key);
    }
    if (keys.length === 0) {
      notifyWarning(M.mediaPickerModal.somethingWentWrongResolvingThoseImagesTry);
      return;
    }
    onInsert(keys);
  }

  const uploading = uploadQueue.total > 0;
  const libraryCountLabel = libTotal > 0 ? ` (${libTotal})` : '';

  return (
    <Modal
      isOpen={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      size="4xl"
      scrollBehavior="inside"
      backdrop="opaque"
    >
      <ModalContent>
        {() => (
          <>
            <ModalHeader className="flex flex-col gap-1 pb-2">
              <div className="text-lg font-semibold text-brand-black">{title}</div>
              <div className="text-xs font-normal text-default-500">
                {isSingle
                  ? 'Pick one image from your library, or upload a new one.'
                  : effectiveMax === Infinity
                  ? 'Pick from your library, or upload new images.'
                  : `Pick up to ${effectiveMax} image${effectiveMax === 1 ? '' : 's'} from your library, or upload new ones.`}
              </div>
            </ModalHeader>

            <ModalBody className="pt-0">
              {/* Tab pills */}
              <div
                role="tablist"
                aria-label="Media source"
                className="flex items-center gap-1 rounded-full bg-default-100 p-1 w-fit mb-4"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'library'}
                  onClick={() => setActiveTab('library')}
                  className={`px-4 h-8 rounded-full text-xs font-semibold transition ${
                    activeTab === 'library'
                      ? 'bg-white text-brand-black shadow-sm'
                      : 'text-default-500 hover:text-brand-black'
                  }`}
                >
                  Your library{libraryCountLabel}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'upload'}
                  onClick={() => setActiveTab('upload')}
                  className={`px-4 h-8 rounded-full text-xs font-semibold transition ${
                    activeTab === 'upload'
                      ? 'bg-white text-brand-black shadow-sm'
                      : 'text-default-500 hover:text-brand-black'
                  }`}
                >
                  Upload new
                </button>
              </div>

              {activeTab === 'library' ? (
                <LibraryPanel
                  items={libItems}
                  loading={libLoading}
                  error={libError}
                  page={libPage}
                  totalPages={totalPages}
                  total={libTotal}
                  searchInput={searchInput}
                  setSearchInput={setSearchInput}
                  selected={selected}
                  onToggle={toggleOne}
                  onPrev={() => setLibPage((p) => Math.max(1, p - 1))}
                  onNext={() => setLibPage((p) => Math.min(totalPages, p + 1))}
                  onSwitchToUpload={() => setActiveTab('upload')}
                />
              ) : (
                <UploadPanel
                  fileInputRef={fileInputRef}
                  onFileInputChange={onFileInputChange}
                  onDrop={onDrop}
                  isDragging={isDragging}
                  setIsDragging={setIsDragging}
                  uploading={uploading}
                  uploadQueue={uploadQueue}
                  isSingle={isSingle}
                />
              )}
            </ModalBody>

            <ModalFooter className="flex items-center justify-between gap-3 border-t border-default-200">
              <div className="text-[11px] text-default-500">
                {effectiveMax === Infinity
                  ? `${selected.size} selected`
                  : `${selected.size} / ${effectiveMax} selected`}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="bordered"
                  onPress={onClose}
                  isDisabled={uploading}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  color="primary"
                  className="font-semibold"
                  onPress={handleInsert}
                  isDisabled={selected.size === 0 || uploading}
                >
                  Insert selected
                  {selected.size > 0 ? ` (${selected.size})` : ''}
                </Button>
              </div>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

/* ─── Library panel ─────────────────────────────────────────────── */

function LibraryPanel({
  items,
  loading,
  error,
  page,
  totalPages,
  total,
  searchInput,
  setSearchInput,
  selected,
  onToggle,
  onPrev,
  onNext,
  onSwitchToUpload,
}: {
  items: SellerMediaItem[];
  loading: boolean;
  error: string | null;
  page: number;
  totalPages: number;
  total: number;
  searchInput: string;
  setSearchInput: (v: string) => void;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onSwitchToUpload: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 min-h-[380px]">
      <Input
        type="search"
        placeholder="Search filename…"
        value={searchInput}
        onValueChange={setSearchInput}
        variant="bordered"
        size="sm"
      />

      {loading ? (
        <div className="flex items-center gap-2 text-default-500 py-16 justify-center">
          <Spinner size="sm" /> Loading your library…
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          {error}
        </div>
      ) : items.length === 0 ? (
        <div className="border border-dashed border-default-300 rounded-xl bg-default-50 py-14 px-6 text-center">
          <div className="text-sm font-semibold text-brand-black">
            {total === 0 && !searchInput
              ? 'Your library is empty'
              : 'No matches'}
          </div>
          <div className="text-xs text-default-500 mt-1 max-w-md mx-auto">
            {total === 0 && !searchInput
              ? 'Upload your first images to reuse them across product listings.'
              : 'Try a different search, or upload a new image.'}
          </div>
          <div className="mt-4">
            <Button
              size="sm"
              onPress={onSwitchToUpload}
              className="bg-brand-black text-white font-semibold"
            >
              Upload new
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {items.map((m) => {
              const isSel = selected.has(m._id);
              const src = m.url || imageUrl(m.key);
              const filename = (m.filename || m.key.split('/').pop() || '').slice(
                0,
                60,
              );
              return (
                <button
                  type="button"
                  key={m._id}
                  onClick={() => onToggle(m._id)}
                  aria-pressed={isSel}
                  className={`group relative rounded-lg border overflow-hidden bg-white text-left transition ${
                    isSel
                      ? 'border-brand-black ring-2 ring-brand-black'
                      : 'border-default-200 hover:border-default-400'
                  }`}
                  title={filename}
                >
                  <div className="relative aspect-square bg-default-50">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt={filename}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    {/* Checkbox overlay top-left */}
                    <span
                      className={`absolute top-1.5 left-1.5 w-6 h-6 rounded-md grid place-items-center shadow-sm border ${
                        isSel
                          ? 'bg-brand-black border-brand-black text-white'
                          : 'bg-white/95 border-default-300 text-transparent'
                      }`}
                      aria-hidden
                    >
                      <span className="text-sm leading-none">✓</span>
                    </span>
                  </div>
                  <div className="px-2 py-1.5 text-[11px] font-medium text-brand-black truncate">
                    {filename || 'Untitled'}
                  </div>
                </button>
              );
            })}
          </div>
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-default-200 pt-3">
              <Button size="sm" variant="bordered" isDisabled={page <= 1} onPress={onPrev}>
                ← Prev
              </Button>
              <div className="text-xs text-default-500">Page {page} of {totalPages}</div>
              <Button size="sm" variant="bordered" isDisabled={page >= totalPages} onPress={onNext}>
                Next →
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ─── Upload panel ─────────────────────────────────────────────── */

function UploadPanel({
  fileInputRef,
  onFileInputChange,
  onDrop,
  isDragging,
  setIsDragging,
  uploading,
  uploadQueue,
  isSingle,
}: {
  fileInputRef: React.MutableRefObject<HTMLInputElement | null>;
  onFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  isDragging: boolean;
  setIsDragging: (v: boolean) => void;
  uploading: boolean;
  uploadQueue: { total: number; done: number };
  isSingle: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 min-h-[380px]">
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDragging(false);
        }}
        onDrop={onDrop}
        className={`relative rounded-xl border-2 border-dashed ${
          isDragging ? 'border-brand-black bg-default-100' : 'border-default-300 bg-default-50'
        } py-14 px-6 text-center transition-colors`}
      >
        <div className="mx-auto w-12 h-12 rounded-full bg-white border border-default-200 grid place-items-center mb-3">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-default-500" aria-hidden>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
        </div>
        <div className="text-sm font-semibold text-brand-black">
          {isDragging ? 'Drop to upload' : 'Drag files here, or click to pick'}
        </div>
        <div className="text-xs text-default-500 mt-1">
          PNG or JPG. {isSingle ? 'One file at a time.' : 'Pick multiple to upload in a batch.'}
        </div>
        <div className="mt-4">
          <Button
            size="sm"
            onPress={() => fileInputRef.current?.click()}
            className="bg-brand-black text-white font-semibold"
            isDisabled={uploading}
          >
            {uploading ? `Uploading ${uploadQueue.done}/${uploadQueue.total}…` : 'Choose files'}
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple={!isSingle}
          onChange={onFileInputChange}
          className="hidden"
        />
      </div>
    </div>
  );
}
