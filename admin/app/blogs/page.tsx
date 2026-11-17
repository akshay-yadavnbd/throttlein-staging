'use client';

/**
 * Admin — blog posts, in the workspace list layout: status tabs with
 * counts over every post (not just the page), search, "Write a post" in
 * the header, and a table that turns into cards on narrow panels. Rows
 * open the editor; Delete is in the row menu.
 *
 * Server-paginated at 15 (`/admin/blog?q&status&page&limit`, `total` is
 * the count for the active filter). Counts come from one generous page
 * (COUNTS_LIMIT) counted locally; past that a counts endpoint is the fix.
 * Scoped to the sidebar's active site.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AdminButton from '@/components/AdminButton';
import ModuleTabs from '@/components/ModuleTabs';
import { RowActions, StatusChip } from '@/components/ui';
import { api, imageUrl, unwrapMeta } from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import { formatDate } from '@/lib/dates';
import { useActiveSite } from '@/lib/useActiveSite';
import { apiMessage, notifyError, notifySuccess } from '@/lib/notify';
import { M } from '@/lib/messages';
import list from '@/components/WorkspaceList.module.css';

type PostStatus = 'draft' | 'published' | 'scheduled' | 'archived';
type Post = {
  _id: string; title: string; slug: string; featuredImage?: string;
  category?: { _id: string; name: string } | null;
  status: PostStatus; readingMinutes: number; viewCount: number; isFeatured: boolean;
  updatedAt: string; contentUpdatedAt?: string | null; publishedAt?: string | null;
};
type Result = { items: Post[]; total: number };
const STATUS_TABS: [string, string][] = [['', 'All'], ['published', 'Published'], ['draft', 'Drafts'], ['scheduled', 'Scheduled'], ['archived', 'Archived']];
const PAGE_SIZE = 15;
const COUNTS_LIMIT = 1000;

/** Last real edit, else the publish date (`updatedAt` also moves on view counts). */
function lastChange(p: Post): { value: string | null; label: string } {
  if (p.contentUpdatedAt) return { value: p.contentUpdatedAt, label: 'Edited' };
  if (p.publishedAt) return { value: p.publishedAt, label: 'Published' };
  return { value: p.updatedAt || null, label: 'Edited' };
}

export default function BlogListPage() {
  const router = useRouter();
  const site = useActiveSite();
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lastShown, setLastShown] = useState<Result | null>(null);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const key = `blog:${site}:${page}:${status}:${q.trim()}`;

  useEffect(() => {
    const t = setTimeout(() => { setQ(query); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const request = (signal?: AbortSignal) =>
    api.get('/admin/blog', { signal, params: { q: q.trim() || undefined, status: status || undefined, page, limit: PAGE_SIZE } })
      .then((r): Result => {
        const { data, meta } = unwrapMeta<{ items?: Post[] }, { totalItems: number }>(r);
        return { items: data.items || [], total: meta?.totalItems ?? (data.items || []).length };
      });
  const loadCounts = () =>
    api.get('/admin/blog', { params: { limit: COUNTS_LIMIT } }).then((r) => {
      const { data, meta } = unwrapMeta<{ items?: Post[] }, { totalItems: number }>(r);
      const all: Post[] = data.items || [];
      const by = (s: PostStatus) => all.filter((p) => p.status === s).length;
      setCounts({ '': meta?.totalItems ?? all.length, published: by('published'), draft: by('draft'), scheduled: by('scheduled'), archived: by('archived') });
    }).catch(() => { /* counts are decoration */ });
  useEffect(() => { void loadCounts(); }, [site, attempt]);
  useEffect(() => {
    const controller = new AbortController();
    request(controller.signal).then((r) => {
      setResults((all) => ({ ...all, [key]: r }));
      setErrors((e) => { const next = { ...e }; delete next[key]; return next; });
      setLastShown(r);
    }).catch((e) => { if (!controller.signal.aborted) setErrors((prev) => ({ ...prev, [key]: apiMessage(e) || 'The posts list is unavailable right now.' })); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const current = results[key];
  const error = errors[key];
  const shown = current ?? lastShown;
  const updating = !current && !error && !!lastShown;
  const total = current?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = !!(q.trim() || status);
  const retry = () => { setErrors((e) => { const next = { ...e }; delete next[key]; return next; }); setAttempt((n) => n + 1); };
  const refresh = () => { setResults({}); setAttempt((n) => n + 1); };
  const tabLabel = useMemo(() => Object.fromEntries(STATUS_TABS), []);

  async function remove(p: Post) {
    const ok = await confirmDialog({ title: `Delete “${p.title}”?`, message: 'Its comments go with it. This can’t be undone.', destructive: true, confirmLabel: 'Delete post' });
    if (!ok) return;
    try { await api.delete(`/admin/blog/${p._id}`); notifySuccess(M.blogs.postDeleted); refresh(); }
    catch (e: any) { notifyError(e, M.blogs.couldntDelete); }
  }
  const onRowClick = (e: React.MouseEvent, p: Post) => { if ((e.target as HTMLElement).closest('a,button')) return; router.push(`/blogs/${p._id}`); };

  return (
    <div className={list.page}>
      <ModuleTabs moduleKey="blogs" />
      <section className={list.workspace} aria-labelledby="posts-heading">
        <div className={list.listHeader}>
          <div>
            <h2 id="posts-heading">Posts <span className={list.count}>{counts ? counts[''] : '…'}</span></h2>
            <p>Articles on the {site === 'seller' ? 'seller' : 'main'} site’s blog. Scheduled posts go live on their date; archived ones stay reachable by link but leave the listings.</p>
          </div>
          <div className={list.headerActions}><AdminButton color="primary" onPress={() => router.push('/blogs/new')}><IconPlus /> Write a post</AdminButton></div>
        </div>
        <div className={list.stageFilters} role="group" aria-label="Filter posts by status">
          {STATUS_TABS.map(([id, label]) => <button key={id || 'all'} type="button" aria-pressed={status === id} onClick={() => { setStatus(id); setPage(1); }}>{label}<span>{counts ? counts[id] ?? 0 : '…'}</span></button>)}
        </div>
        <div className={list.toolbar}>
          <div className={list.toolbarLeft}>
            <label className={list.search}>
              <IconSearch /><span className="sr-only">Search posts</span>
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by title" />
              {query && <button type="button" className={list.clearSearch} onClick={() => setQuery('')} aria-label="Clear search"><IconClose /></button>}
            </label>
          </div>
          <div className={list.results} aria-live="polite">
            {updating ? <span className={list.updating}>Updating…</span> : current && <span>{total ? `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}` : 'No results'}</span>}
            {hasFilters && <button type="button" className={list.clearFilters} onClick={() => { setQuery(''); setQ(''); setStatus(''); setPage(1); }}><IconClose /> Clear filters</button>}
          </div>
        </div>

        {error && !shown ? (
          <div className={list.state} role="alert"><span className={`${list.stateIcon} ${list.errorIcon}`}><IconAlert /></span><h3>Couldn’t load posts</h3><p>{error}</p><button type="button" className={list.stateAction} onClick={retry}>Try again</button></div>
        ) : !shown ? (
          <div className={list.skeleton} role="status" aria-label="Loading posts"><span /><span /><span /><span /></div>
        ) : shown.items.length === 0 && !updating ? (
          <div className={list.state}>
            <span className={list.stateIcon}><IconPen /></span>
            <h3>{q.trim() ? `No posts match “${q.trim()}”` : status ? `No ${tabLabel[status].toLowerCase()}` : 'No posts yet'}</h3>
            <p>{hasFilters ? 'Try another title or status.' : 'Write the first article for the blog.'}</p>
            {hasFilters ? <button type="button" className={list.stateLink} onClick={() => { setQuery(''); setQ(''); setStatus(''); }}>Clear filters</button> : <Link className={list.stateAction} href="/blogs/new">Write a post</Link>}
          </div>
        ) : (
          <>
            {error && <p className="px-[22px] pb-3 text-[11px] text-[#a3413b]" role="status">Couldn’t refresh — showing the last loaded list. <button type="button" className="underline" onClick={retry}>Retry</button></p>}
            <div className={`${list.tableWrap} ${updating ? list.stale : ''}`} aria-busy={updating}>
              <table className={list.table}>
                <caption className="sr-only">Blog posts</caption>
                <thead><tr><th scope="col">Post</th><th scope="col">Category</th><th scope="col">Status</th><th scope="col">Views</th><th scope="col">Last change</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {shown.items.map((p) => {
                    const lc = lastChange(p);
                    return (
                      <tr key={p._id} onClick={(e) => onRowClick(e, p)}>
                        <td>
                          <div className="flex items-center gap-3">
                            {p.featuredImage
                              // eslint-disable-next-line @next/next/no-img-element
                              ? <img alt="" className="h-11 w-11 flex-none rounded-lg border border-[#edf0f2] object-cover" src={imageUrl(p.featuredImage)} />
                              : <span aria-hidden className="grid h-11 w-11 flex-none place-items-center rounded-lg border border-[#edf0f2] bg-[#f6f7f9] text-[#8a939b]"><IconImage /></span>}
                            <div className="min-w-0">
                              <Link className={list.primary} href={`/blogs/${p._id}`}>{p.title}</Link>
                              <span className={list.sub}>/{p.slug} · {p.readingMinutes} min read{p.isFeatured ? ' · Featured' : ''}</span>
                            </div>
                          </div>
                        </td>
                        <td>{p.category?.name || <span className="text-[#8a939b]">—</span>}</td>
                        <td><StatusChip status={p.status} /></td>
                        <td className={p.viewCount ? '' : 'text-[#8a939b]'}>{p.viewCount}</td>
                        <td>{lc.value ? <>{formatDate(lc.value)}<span className={list.sub}>{lc.label}</span></> : '—'}</td>
                        <td>
                          <div className="flex items-center justify-end gap-1.5">
                            <RowActions ariaLabel={`More actions for ${p.title}`} items={[{ key: 'delete', label: 'Delete post…', hint: 'Comments go with it', tone: 'danger', onSelect: () => remove(p) }]} />
                            <Link className={list.openLink} href={`/blogs/${p._id}`} aria-label={`Edit ${p.title}`} title="Edit post"><IconArrow /></Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className={`${list.cards} ${updating ? list.stale : ''}`}>
              {shown.items.map((p) => (
                <Link key={p._id} className={list.card} href={`/blogs/${p._id}`}>
                  <div className={list.cardTop}>
                    <div className="min-w-0"><span className={list.primary}>{p.title}</span><span className={list.sub}>{p.category?.name || 'No category'} · {p.viewCount} views</span></div>
                    <StatusChip status={p.status} />
                  </div>
                </Link>
              ))}
            </div>
            {pages > 1 && (
              <div className={list.footer}>
                <span>Page {page} of {pages}</span>
                <div className={list.pager}>
                  <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><IconArrow flip /> Previous</button>
                  <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next <IconArrow /></button>
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
function IconPlus() { return <svg {...svg} width="14" height="14"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>; }
function IconSearch() { return <svg {...svg}><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>; }
function IconClose() { return <svg {...svg} width="12" height="12"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>; }
function IconAlert() { return <svg {...svg}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>; }
function IconPen() { return <svg {...svg}><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>; }
function IconImage() { return <svg {...svg} width="18" height="18"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>; }
