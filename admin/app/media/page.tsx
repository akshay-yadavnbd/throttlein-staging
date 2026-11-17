'use client';

/**
 * Media library — every admin/staff upload, in one workspace panel: the
 * count and Upload in the header, search + folder filter in the toolbar,
 * a thumbnail grid with multi-select and bulk delete, and paging.
 *
 * Deleting here also removes the S3 object, so any banner, product or
 * page still using the image breaks — the confirms say so.
 * Data: GET /admin/media?page&limit&q&folder, GET /admin/media/folders,
 * POST /admin/media/upload (one file per request), DELETE /admin/media/:id,
 * POST /admin/media/bulk-delete.
 */
import { useEffect, useRef, useState } from 'react';
import AdminButton from '@/components/AdminButton';
import AdminSelect from '@/components/AdminSelect';
import { api, unwrap, unwrapMeta, type PageMeta } from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import { formatDate } from '@/lib/dates';
import { apiMessage, notifyError, notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';
import list from '@/components/WorkspaceList.module.css';
import styles from './media.module.css';

type MediaItem = { _id: string; key: string; url: string; filename: string; mimeType: string; size: number; folder: string; createdAt: string };
type Result = { items: MediaItem[]; total: number };
const PAGE_SIZE = 48;
const bytes = (n: number) => (!n ? '—' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const nameOf = (m: MediaItem) => m.filename || m.key.split('/').pop() || m.key;

export default function MediaLibraryPage() {
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [folder, setFolder] = useState('');
  const [folders, setFolders] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lastShown, setLastShown] = useState<Result | null>(null);
  /* Selection is remembered with the view it was made in, so a page or
     filter change drops it without an effect having to clear it. */
  const [selection, setSelection] = useState<{ view: string; ids: Set<string> }>({ view: '', ids: new Set() });
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [upload, setUpload] = useState<{ total: number; done: number }>({ total: 0, done: 0 });
  const key = `media:${page}:${folder}:${q.trim()}`;

  useEffect(() => { api.get('/admin/media/folders').then((r) => { const { folders: list } = unwrap<{ folders?: string[] }>(r); setFolders(Array.isArray(list) ? list : []); }).catch(() => setFolders([])); }, []);
  useEffect(() => { const t = setTimeout(() => { setQ(query); setPage(1); }, 250); return () => clearTimeout(t); }, [query]);
  useEffect(() => {
    const controller = new AbortController();
    api.get('/admin/media', { signal: controller.signal, params: { page, limit: PAGE_SIZE, q: q.trim() || undefined, folder: folder || undefined } })
      .then((res) => {
        const { data, meta } = unwrapMeta<{ items?: MediaItem[] }, PageMeta>(res);
        const r: Result = { items: Array.isArray(data.items) ? data.items : [], total: meta?.totalItems || 0 };
        setResults((all) => ({ ...all, [key]: r }));
        setErrors((e) => { const next = { ...e }; delete next[key]; return next; });
        setLastShown(r);
      })
      .catch((e) => { if (!controller.signal.aborted) setErrors((prev) => ({ ...prev, [key]: apiMessage(e) || 'The media library is unavailable right now.' })); });
    return () => controller.abort();
  }, [key, page, q, folder, attempt]);

  const current = results[key];
  const error = errors[key];
  const shown = current ?? lastShown;
  const updating = !current && !error && !!lastShown;
  const total = current?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = !!(q.trim() || folder);
  const refresh = () => { setResults({}); setAttempt((n) => n + 1); };
  const items = shown?.items || [];
  const selected = selection.view === key ? selection.ids : new Set<string>();
  const setSelected = (ids: Set<string>) => setSelection({ view: key, ids });
  const allSelected = items.length > 0 && selected.size === items.length;
  const uploading = upload.total > 0;

  /* Sequential uploads keep the request rate sensible and give a "n of m" count. */
  async function uploadFiles(files: File[]) {
    if (!files.length) return;
    setUpload({ total: files.length, done: 0 });
    let failed = 0;
    for (let i = 0; i < files.length; i++) {
      try { const fd = new FormData(); fd.append('files', files[i]); await api.post('/admin/media/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } }); }
      catch { failed += 1; }
      setUpload({ total: files.length, done: i + 1 });
    }
    setUpload({ total: 0, done: 0 });
    if (failed) notifyWarning(M.media.uploadsFailed(failed, files.length)); else notifySuccess(M.media.uploadedFiles(files.length));
    refresh();
  }
  async function removeOne(m: MediaItem) {
    const ok = await confirmDialog({ title: `Delete ${nameOf(m)}?`, message: 'The file is removed from storage too — anything still using this image will show a broken picture. This can’t be undone.', destructive: true, confirmLabel: 'Delete file' });
    if (!ok) return;
    try { await api.delete(`/admin/media/${m._id}`); notifySuccess(M.media.deleted); refresh(); }
    catch (e: any) { notifyError(e, M.media.couldntDelete); }
  }
  async function removeBulk() {
    const ids = [...selected];
    if (!ids.length) return;
    const ok = await confirmDialog({ title: `Delete ${ids.length} ${ids.length === 1 ? 'file' : 'files'}?`, message: 'They’re removed from storage too — anything still using them will show broken pictures. This can’t be undone.', destructive: true, confirmLabel: `Delete ${ids.length}` });
    if (!ok) return;
    try { const { deleted } = unwrap<{ deleted?: number }>(await api.post('/admin/media/bulk-delete', { ids })); notifySuccess(M.media.deleted2(deleted ?? ids.length)); setSelected(new Set()); refresh(); }
    catch (e: any) { notifyError(e, M.media.couldntDeleteTheSelectedItems); }
  }
  const toggleOne = (id: string) => { const next = new Set(selected); if (next.has(id)) next.delete(id); else next.add(id); setSelected(next); };

  return (
    <div className={list.page}>
      <section className={list.workspace} aria-labelledby="media-heading">
        <div className={list.listHeader}>
          <div>
            <h2 id="media-heading">Media library <span className={list.count}>{current ? total : '…'}</span></h2>
            <p>Every image uploaded from the admin — banners, logos, blog pictures. Deleting a file here removes it from storage, so check it isn’t still in use.</p>
          </div>
          <div className={list.headerActions}>
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" multiple className="hidden" onChange={(e) => { const files = Array.from(e.target.files || []); if (files.length) void uploadFiles(files); if (fileInput.current) fileInput.current.value = ''; }} />
            <AdminButton color="primary" isLoading={uploading} onPress={() => fileInput.current?.click()}>{uploading ? `Uploading ${upload.done} of ${upload.total}…` : <><IconUpload /> Upload images</>}</AdminButton>
          </div>
        </div>
        <div className={list.toolbar}>
          <div className={list.toolbarLeft}>
            <label className={list.search}>
              <IconSearch /><span className="sr-only">Search files</span>
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search file name" />
              {query && <button type="button" className={list.clearSearch} onClick={() => setQuery('')} aria-label="Clear search"><IconClose /></button>}
            </label>
            <AdminSelect ariaLabel="Folder" value={folder} onChange={(v) => { setFolder(v); setPage(1); }} options={[{ value: '', label: 'All folders' }, ...folders.map((f) => ({ value: f, label: f }))]} />
            {items.length > 0 && (
              <label className={styles.selectAll}><input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((m) => m._id)))} /> Select all on this page</label>
            )}
          </div>
          <div className={list.results} aria-live="polite">
            {selected.size > 0 ? (
              <>
                <span><strong className="font-semibold text-[#252c32]">{selected.size}</strong> selected</span>
                <button type="button" className={list.clearFilters} onClick={() => setSelected(new Set())}>Clear</button>
                <AdminButton color="danger" onPress={removeBulk}>Delete selected</AdminButton>
              </>
            ) : (
              <>
                {updating ? <span className={list.updating}>Updating…</span> : current && <span>{total ? `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}` : 'No results'}</span>}
                {hasFilters && <button type="button" className={list.clearFilters} onClick={() => { setQuery(''); setQ(''); setFolder(''); setPage(1); }}><IconClose /> Clear filters</button>}
              </>
            )}
          </div>
        </div>

        {error && !shown ? (
          <div className={list.state} role="alert"><span className={`${list.stateIcon} ${list.errorIcon}`}><IconAlert /></span><h3>Couldn’t load the library</h3><p>{error}</p><button type="button" className={list.stateAction} onClick={() => { setErrors({}); setAttempt((n) => n + 1); }}>Try again</button></div>
        ) : !shown ? (
          <div className={styles.gridSkeleton} role="status" aria-label="Loading images">{Array.from({ length: 12 }).map((_, i) => <span key={i} />)}</div>
        ) : items.length === 0 && !updating ? (
          <div className={list.state}>
            <span className={list.stateIcon}><IconImage /></span>
            <h3>{hasFilters ? 'No images match these filters' : 'No images yet'}</h3>
            <p>{hasFilters ? 'Try another name or folder.' : 'Upload images here, or they appear as you add them to banners, brands and posts.'}</p>
            {hasFilters ? <button type="button" className={list.stateLink} onClick={() => { setQuery(''); setQ(''); setFolder(''); }}>Clear filters</button> : <button type="button" className={list.stateAction} onClick={() => fileInput.current?.click()}>Upload images</button>}
          </div>
        ) : (
          <>
            <div className={`${styles.grid} ${updating ? list.stale : ''}`} aria-busy={updating}>
              {items.map((m) => {
                const isSelected = selected.has(m._id);
                return (
                  <figure key={m._id} className={`${styles.tile} ${isSelected ? styles.tileSelected : ''}`} title={nameOf(m)}>
                    <button type="button" className={styles.thumb} onClick={() => toggleOne(m._id)} aria-pressed={isSelected} aria-label={`${isSelected ? 'Deselect' : 'Select'} ${nameOf(m)}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={m.url} alt="" loading="lazy" />
                    </button>
                    <span className={styles.check} aria-hidden>{isSelected && <IconCheck />}</span>
                    <button type="button" className={styles.remove} onClick={() => removeOne(m)} aria-label={`Delete ${nameOf(m)}`} title="Delete"><IconTrash /></button>
                    <figcaption>
                      <strong>{nameOf(m)}</strong>
                      <small>{[m.folder, bytes(m.size), formatDate(m.createdAt)].filter(Boolean).join(' · ')}</small>
                    </figcaption>
                  </figure>
                );
              })}
            </div>
            {totalPages > 1 && (
              <div className={list.footer}>
                <span>Page {page} of {totalPages}</span>
                <div className={list.pager}>
                  <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><IconArrow flip /> Previous</button>
                  <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next <IconArrow /></button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

const svg = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
function IconArrow({ flip }: { flip?: boolean }) { return <svg {...svg} width="14" height="14" style={flip ? { transform: 'scaleX(-1)' } : undefined}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></svg>; }
function IconSearch() { return <svg {...svg}><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>; }
function IconClose() { return <svg {...svg} width="12" height="12"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>; }
function IconAlert() { return <svg {...svg}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>; }
function IconUpload() { return <svg {...svg} width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>; }
function IconImage() { return <svg {...svg}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>; }
function IconCheck() { return <svg {...svg} width="12" height="12" strokeWidth={3}><polyline points="20 6 9 17 4 12" /></svg>; }
function IconTrash() { return <svg {...svg} width="13" height="13"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /></svg>; }
