'use client';

/**
 * MediaPicker — shared modal for picking an image from the library
 * OR uploading one (or many) new ones. Returns the chosen S3 key
 * via `onSelect`.
 *
 * Used by every image field across the admin so the same asset
 * never has to be re-uploaded.
 *
 * Usage:
 *   <MediaPicker
 *     isOpen={open}
 *     onClose={() => setOpen(false)}
 *     uploadEndpoint="/home-banners/upload"   // POST FormData('image')
 *     onSelect={(key) => { setImg(key); setOpen(false); }}
 *   />
 *
 * The library tab is paginated (36 per page), supports text search
 * across the filename + key, and a folder dropdown that filters by
 * the S3 prefix.
 *
 * The upload tab posts to the caller-provided endpoint — keeps the
 * existing prefix routing (banners go under banners/, etc.). Multi-
 * file uploads are sequential; on a SINGLE file pick we auto-select
 * the uploaded key and close. On a MULTI pick we record them all
 * and flip to the Library tab so the admin can pick one.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
  Button, Spinner, Tabs, Tab, Input, Select, SelectItem,
} from '@heroui/react';
import { api, unwrap, unwrapMeta, uploadedUrl, type PageMeta } from '@/lib/api';
import { notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';

type MediaItem = {
  _id: string;
  key: string;
  /** Server-rendered fetchable URL — admin's `imageUrl()` can't
   *  resolve bare S3 keys, so the backend returns this directly. */
  url: string;
  filename: string;
  mimeType: string;
  size: number;
  folder: string;
  createdAt: string;
};


const PAGE_SIZE = 36;

export default function MediaPicker({
  isOpen,
  onClose,
  onSelect,
  uploadEndpoint = '/home-banners/upload',
  uploadField = 'image',
  acceptedTypes = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml',
}: {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the chosen S3 key. */
  onSelect: (key: string) => void;
  /** POST endpoint for new uploads. Must accept multipart with
   *  field name "image" and return `{ url: <key> }`. */
  uploadEndpoint?: string;
  /** Multipart field name the upload endpoint expects (brands use
   *  'logo', categories 'icon'; everything else 'image'). */
  uploadField?: string;
  /** Comma-separated accept attribute for the file input. */
  acceptedTypes?: string;
}) {
  const [tab, setTab] = useState<'library' | 'upload'>('library');
  // Library state
  const [items, setItems] = useState<MediaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [folder, setFolder] = useState<string>('');
  const [folders, setFolders] = useState<string[]>([]);
  // "loading" is derived: the list is stale whenever the filters that
  // produced it differ from the current ones.
  const [loadedKey, setLoadedKey] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Upload state
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<{ total: number; done: number }>({
    total: 0,
    done: 0,
  });

  // Debounced search input
  const [searchInput, setSearchInput] = useState('');
  useEffect(() => {
    const id = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 250);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Reset whenever the modal reopens so it doesn't show stale data —
  // state adjusted during render on the prop change, not in an effect.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setTab('library');
      setSearch('');
      setSearchInput('');
      setFolder('');
      setPage(1);
      setSelectedKey(null);
    }
  }

  // Load folders once per open
  useEffect(() => {
    if (!isOpen) return;
    api
      .get('/admin/media/folders')
      .then((r) => { const { folders: list } = unwrap<{ folders?: string[] }>(r); setFolders(Array.isArray(list) ? list : []); })
      .catch(() => setFolders([]));
  }, [isOpen]);

  // Load library list whenever filters change
  const listKey = JSON.stringify({ page, search: search.trim(), folder });
  const loading = isOpen && tab === 'library' && loadedKey !== listKey;
  useEffect(() => {
    if (!isOpen || tab !== 'library') return;
    let cancelled = false;
    const params: Record<string, string | number> = {
      page,
      limit: PAGE_SIZE,
    };
    if (search.trim()) params.q = search.trim();
    if (folder) params.folder = folder;
    api
      .get('/admin/media', { params })
      .then((r) => {
        if (cancelled) return;
        const { data, meta } = unwrapMeta<{ items?: MediaItem[] }, PageMeta>(r);
        setItems(data.items || []);
        setTotal(meta?.totalItems || 0);
      })
      .catch(() => {
        if (!cancelled) {
          setItems([]);
          setTotal(0);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadedKey(listKey);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, tab, page, search, folder, listKey]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / PAGE_SIZE)),
    [total],
  );

  /** Upload one OR many files sequentially. */
  async function handleUpload(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    setUploadQueue({ total: files.length, done: 0 });
    let lastKey: string | null = null;
    let failed = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const fd = new FormData();
        fd.append(uploadField || 'image', file);
        const { data: body } = await api.post(uploadEndpoint, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        const url = uploadedUrl(body);
        if (url) lastKey = url;
      } catch (err: any) {
        failed += 1;
        console.warn('MediaPicker upload failed:', file.name, err?.message);
      }
      setUploadQueue((q) => ({ ...q, done: i + 1 }));
    }
    setUploadQueue({ total: 0, done: 0 });
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';

    if (failed === files.length) {
      notifyWarning(M.media.allUploadsFailed);
      return;
    }
    if (failed > 0) {
      notifyWarning(M.media.uploadedFailed(files.length - failed, failed));
    } else {
      notifySuccess(M.media.uploadedFiles(files.length));
    }

    if (files.length === 1 && lastKey) {
      // Single-file path — keep the "select and close" UX.
      onSelect(lastKey);
      onClose();
    } else {
      // Multi-file path — flip to Library so the admin can pick
      // which of the uploads they want to use.
      setTab('library');
      setPage(1);
    }
  }

  function commitSelection() {
    if (!selectedKey) return;
    onSelect(selectedKey);
    onClose();
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="5xl"
      scrollBehavior="inside"
    >
      <ModalContent>
        <ModalHeader>Media library</ModalHeader>
        <ModalBody className="pb-4">
          <Tabs
            aria-label="Media tabs"
            selectedKey={tab}
            onSelectionChange={(k) => setTab(k as 'library' | 'upload')}
            variant="underlined"
            className="mb-2"
          >
            {/* ─────────── LIBRARY ─────────── */}
            <Tab key="library" title="Library">
              <div className="flex flex-col gap-3">
                {/* Filters */}
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    type="search"
                    placeholder="Search filename or key…"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    variant="bordered"
                    className="flex-1"
                  />
                  <Select
                    aria-label="Folder filter"
                    placeholder="All folders"
                    selectedKeys={folder ? new Set([folder]) : new Set()}
                    onSelectionChange={(keys) => {
                      const v = Array.from(keys)[0];
                      setFolder(typeof v === 'string' ? v : '');
                      setPage(1);
                    }}
                    variant="bordered"
                    className="w-full sm:w-56"
                  >
                    {folders.map((f) => (
                      <SelectItem key={f}>{f}</SelectItem>
                    ))}
                  </Select>
                </div>

                {/* Grid */}
                {loading ? (
                  <div className="py-14 grid place-items-center">
                    <Spinner size="lg" />
                  </div>
                ) : items.length === 0 ? (
                  <div className="py-14 text-center text-default-500">
                    <div className="text-sm font-medium text-default-700">
                      No assets match those filters
                    </div>
                    <div className="text-xs mt-1">
                      Switch to the Upload tab to add a new one.
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                    {items.map((m) => {
                      const isSelected = selectedKey === m.key;
                      return (
                        <button
                          key={m._id}
                          type="button"
                          onClick={() => setSelectedKey(m.key)}
                          onDoubleClick={() => {
                            setSelectedKey(m.key);
                            onSelect(m.key);
                            onClose();
                          }}
                          className={`relative group aspect-square rounded-lg overflow-hidden border-2 transition ${
                            isSelected
                              ? 'border-brand-black ring-2 ring-brand-black/30'
                              : 'border-default-200 hover:border-default-400'
                          }`}
                          title={m.filename || m.key}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={m.url}
                            alt={m.filename || ''}
                            className="w-full h-full object-cover bg-default-50"
                            loading="lazy"
                          />
                          <span className="absolute bottom-0 inset-x-0 px-2 py-1 text-[10px] truncate bg-black/60 text-white">
                            {m.filename || m.key.split('/').pop()}
                          </span>
                          {isSelected && (
                            <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-brand-black text-white grid place-items-center text-[12px]">
                              ✓
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 pt-2">
                    <Button
                      size="sm"
                      variant="bordered"
                      isDisabled={page <= 1}
                      onPress={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      ← Prev
                    </Button>
                    <span className="text-xs text-default-600 px-2">
                      Page {page} of {totalPages} · {total} total
                    </span>
                    <Button
                      size="sm"
                      variant="bordered"
                      isDisabled={page >= totalPages}
                      onPress={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                      Next →
                    </Button>
                  </div>
                )}
              </div>
            </Tab>

            {/* ─────────── UPLOAD ─────────── */}
            <Tab key="upload" title="Upload new">
              <div className="py-10 flex flex-col items-center gap-4">
                <div className="text-sm text-default-700 text-center max-w-md">
                  Upload one OR many images — they all land in the library
                  automatically. Pick a single file to auto-select it for
                  this field, or pick multiple to add them all and choose
                  one from the Library tab.
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept={acceptedTypes}
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const list = Array.from(e.target.files || []);
                    if (list.length > 0) handleUpload(list);
                  }}
                />
                <Button
                  color="primary"
                  className="font-semibold"
                  isLoading={uploading}
                  onPress={() => fileRef.current?.click()}
                >
                  {uploadQueue.total > 0
                    ? `Uploading ${uploadQueue.done}/${uploadQueue.total}…`
                    : 'Choose file(s)…'}
                </Button>
                <div className="text-xs text-default-500">
                  PNG · JPG · WEBP · GIF · SVG · up to 5 MB each
                </div>
              </div>
            </Tab>
          </Tabs>
        </ModalBody>
        <ModalFooter>
          <Button variant="light" onPress={onClose}>
            Cancel
          </Button>
          {tab === 'library' && (
            <Button
              color="primary"
              className="font-semibold"
              isDisabled={!selectedKey}
              onPress={commitSelection}
            >
              Use selected
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
