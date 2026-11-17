'use client';

/**
 * Pages — every storefront page in one workspace list (same family as
 * Orders and Sellers): tabs with counts (All / Static / Dynamic / Prose),
 * search, "Create page" in the header, and a table that turns into cards
 * on narrow panels.
 *
 * Three buckets render through one row model:
 *   1. STATIC routes (Home, /products, /sell, /blog…) from the manifest +
 *      the backend's auto-discovered routes. Their SEO text is overridden
 *      by a Page record of type 'static-meta'; rows without one say so.
 *   2. DYNAMIC pages (type 'dynamic') — admin-built landing pages backed
 *      by a saved filter + template.
 *   3. PROSE pages (type 'prose') — long-form pages at /page/<slug>.
 *
 * The list is scoped to the sidebar's active site (api.ts sends the
 * header); the static manifest differs per site (see mergedStaticPages).
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AdminSwitch from '@/components/AdminSwitch';
import AdminButton from '@/components/AdminButton';
import ModuleTabs from '@/components/ModuleTabs';
import { RowActions, StatusChip } from '@/components/ui';
import { api, unwrap, envelopeOrLegacy } from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import { formatDate } from '@/lib/dates';
import { STATIC_PAGES, type StaticPageEntry } from '@/lib/staticPages';
import { SELLER_STATIC_PAGES } from '@/lib/sellerStaticPages';
import { useActiveSite } from '@/lib/useActiveSite';
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';
import list from '@/components/WorkspaceList.module.css';

type PageDoc = {
  _id: string; slug: string; title: string;
  type: 'home' | 'prose' | 'dynamic' | 'static-meta';
  template?: 'products-list' | 'brands-list' | 'categories-list' | 'seller-category' | 'seller-category-2';
  parentCategory?: { _id: string; name: string; slug: string } | null;
  staticRoute?: string;
  filter?: { category?: { slug: string } | null; brand?: { slug: string } | null };
  isPublished: boolean;
  updatedAt?: string;
};
type Tab = 'all' | 'static' | 'dynamic' | 'prose';
const TEMPLATE_LABELS: Record<NonNullable<PageDoc['template']>, string> = {
  'products-list': 'Products list', 'brands-list': 'Brands list', 'categories-list': 'Categories list',
  'seller-category': 'Seller category template', 'seller-category-2': 'Seller category template 2',
};
const PAGE_SIZE = 15;

/** Storefront URL for a Page, mirroring pageToRoute() on the backend. */
function urlFor(p: PageDoc): string {
  if (p.type === 'home') return '/';
  if (p.type === 'prose') return `/page/${p.slug}`;
  if (p.type === 'static-meta') return p.staticRoute || `/${p.slug}`;
  if (p.template === 'seller-category' || p.template === 'seller-category-2') return `/sell-online/${p.slug}`;
  const catSlug = p.parentCategory?.slug || '';
  if (!catSlug) return `/${p.slug}`;
  const brandSlug = p.filter?.brand?.slug;
  if (brandSlug) return `/${catSlug}/${brandSlug}/${p.slug}`;
  if (p.slug && p.slug === catSlug) return `/${catSlug}`;
  return `/${catSlug}/${p.slug}`;
}
function editHrefFor(p: PageDoc): string {
  if (p.type === 'home') return '/pages/home';
  if (p.type === 'prose') return `/pages/prose/${p._id}`;
  if (p.type === 'static-meta') return `/pages/static-meta/${p._id}`;
  return `/pages/dynamic/${p._id}`;
}

/** One row model for every bucket. */
type Row = {
  key: string; title: string; subtitle?: string; editHref: string; editLabel: string;
  kind: 'home' | 'static' | 'dynamic' | 'prose'; url: string; live: boolean;
  seoCustomised?: boolean; publishDoc?: PageDoc; deleteDoc?: PageDoc; updatedAt?: string;
};
const KIND_LABEL: Record<Row['kind'], string> = { home: 'Home', static: 'Static', dynamic: 'Dynamic', prose: 'Prose' };

export default function PagesAdminPage() {
  const router = useRouter();
  const site = useActiveSite();
  const [items, setItems] = useState<PageDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [autoDiscovered, setAutoDiscovered] = useState<StaticPageEntry[]>([]);
  const [tab, setTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const load = () => api.get('/pages', { params: { all: 1 } }).then(envelopeOrLegacy)
    .then(({ data }) => { setItems(data.items || []); setError(null); })
    .catch((e) => setError(e?.response?.status >= 500 || !e?.response ? 'The pages list is unavailable right now.' : 'Pages couldn’t be loaded.'));
  useEffect(() => { void load(); }, [site, attempt]);
  // Auto-discovered static routes (any storefront page.tsx) — silent fallback to the manifest alone.
  useEffect(() => {
    api.get('/admin/static-pages').then((r) => { const data = unwrap<{ items?: any[] }>(r); setAutoDiscovered(Array.isArray(data?.items) ? data.items : []); }).catch(() => setAutoDiscovered([]));
  }, [site]);

  const docs = useMemo(() => items || [], [items]);
  const overrideByRoute = useMemo(() => new Map(docs.filter((p) => p.type === 'static-meta' && p.staticRoute).map((p) => [p.staticRoute!, p])), [docs]);
  /* Each property has its own static manifest; the seller site edits them all from the Seller home tab. */
  const staticEntries = useMemo<StaticPageEntry[]>(() => {
    if (site !== 'main') return [...SELLER_STATIC_PAGES].sort((a, b) => a.route.localeCompare(b.route));
    const byRoute = new Map<string, StaticPageEntry>();
    for (const s of autoDiscovered) byRoute.set(s.route, s);
    for (const s of STATIC_PAGES) byRoute.set(s.route, s);
    byRoute.delete('/');
    return [...byRoute.values()].sort((a, b) => a.route.localeCompare(b.route));
  }, [autoDiscovered, site]);

  const rows = useMemo<Row[]>(() => {
    const home = docs.filter((p) => p.type === 'home').map((p): Row => ({ key: p._id, title: p.title, editHref: editHrefFor(p), editLabel: 'Edit', kind: 'home', url: '/', live: p.isPublished, updatedAt: p.updatedAt }));
    const statics = staticEntries.map((s): Row => {
      const override = overrideByRoute.get(s.route) || null;
      const sellerHome = site === 'seller' && s.route === '/';
      return {
        key: `static-${s.route}`, title: s.title, subtitle: s.description || undefined, kind: 'static', url: s.route, live: true,
        editHref: sellerHome ? '/pages/sell' : s.editHref ? s.editHref : override ? `/pages/static-meta/${override._id}` : `/pages/static-meta/new?route=${encodeURIComponent(s.route)}&title=${encodeURIComponent(s.title)}`,
        editLabel: sellerHome || s.editHref ? 'Edit' : override ? 'Edit SEO text' : 'Set SEO text',
        seoCustomised: !!override, updatedAt: override?.updatedAt,
      };
    });
    const dyn = docs.filter((p) => p.type === 'dynamic').map((p): Row => ({ key: p._id, title: p.title, subtitle: p.template ? TEMPLATE_LABELS[p.template] : undefined, editHref: editHrefFor(p), editLabel: 'Edit', kind: 'dynamic', url: urlFor(p), live: p.isPublished, publishDoc: p, deleteDoc: p, updatedAt: p.updatedAt }));
    const prose = docs.filter((p) => p.type === 'prose').map((p): Row => ({ key: p._id, title: p.title, editHref: editHrefFor(p), editLabel: 'Edit', kind: 'prose', url: urlFor(p), live: p.isPublished, publishDoc: p, deleteDoc: p, updatedAt: p.updatedAt }));
    return [...home, ...statics, ...dyn, ...prose];
  }, [docs, staticEntries, overrideByRoute, site]);

  const counts = useMemo(() => ({
    all: rows.length,
    static: rows.filter((r) => r.kind === 'static' || r.kind === 'home').length,
    dynamic: rows.filter((r) => r.kind === 'dynamic').length,
    prose: rows.filter((r) => r.kind === 'prose').length,
  }), [rows]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => (tab === 'all' || (tab === 'static' ? r.kind === 'static' || r.kind === 'home' : r.kind === tab))
      && (!q || r.title.toLowerCase().includes(q) || r.url.toLowerCase().includes(q) || (r.subtitle || '').toLowerCase().includes(q)));
  }, [rows, tab, search]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const shown = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const hasFilters = !!search.trim() || tab !== 'all';

  async function togglePublish(p: PageDoc, next: boolean) {
    setItems((prev) => (prev || []).map((x) => (x._id === p._id ? { ...x, isPublished: next } : x)));
    try { await api.put(`/pages/${p._id}`, { isPublished: next }); }
    catch (e: any) { setItems((prev) => (prev || []).map((x) => (x._id === p._id ? { ...x, isPublished: !next } : x))); notifyError(e, M.pages.couldntUpdate); }
  }
  async function removePage(p: PageDoc) {
    if (p.type === 'home') { notifyWarning(M.pages.systemPagesCannotBeDeleted); return; }
    const ok = await confirmDialog({ title: `Delete “${p.title}”?`, message: `${urlFor(p)} stops working and anyone with the link sees a not-found page. This can’t be undone.`, destructive: true, confirmLabel: 'Delete page' });
    if (!ok) return;
    try { await api.delete(`/pages/${p._id}`); notifySuccess(M.pages.deleted); await load(); }
    catch (e: any) { notifyError(e, M.pages.couldntDelete); }
  }
  const onRowClick = (e: React.MouseEvent, r: Row) => { if ((e.target as HTMLElement).closest('a,button,label,input')) return; router.push(r.editHref); };

  return (
    <div className={list.page}>
      <ModuleTabs moduleKey="pages" />
      <section className={list.workspace} aria-labelledby="pages-heading">
        <div className={list.listHeader}>
          <div>
            <h2 id="pages-heading">All pages <span className={list.count}>{items ? counts.all : '…'}</span></h2>
            <p>Every page on the {site === 'seller' ? 'seller' : 'main'} site: built-in routes with their search text, plus the landing and long-form pages you create.</p>
          </div>
          <div className={list.headerActions}><AdminButton color="primary" onPress={() => router.push('/pages/new')}><IconPlus /> Create page</AdminButton></div>
        </div>
        <div className={list.stageFilters} role="group" aria-label="Filter pages by type">
          {([['all', 'All'], ['static', 'Static'], ['dynamic', 'Dynamic'], ['prose', 'Prose']] as [Tab, string][]).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={tab === id} onClick={() => { setTab(id); setPage(1); }}>{label}<span>{items ? counts[id] : '…'}</span></button>
          ))}
        </div>
        <div className={list.toolbar}>
          <div className={list.toolbarLeft}>
            <label className={list.search}>
              <IconSearch /><span className="sr-only">Search pages</span>
              <input type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search title, URL or description" />
              {search && <button type="button" className={list.clearSearch} onClick={() => setSearch('')} aria-label="Clear search"><IconClose /></button>}
            </label>
          </div>
          <div className={list.results}>
            {items && <span>{filtered.length ? `Showing ${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, filtered.length)} of ${filtered.length}` : 'No results'}</span>}
            {hasFilters && <button type="button" className={list.clearFilters} onClick={() => { setSearch(''); setTab('all'); }}><IconClose /> Clear filters</button>}
          </div>
        </div>

        {error && !items ? (
          <div className={list.state} role="alert"><span className={`${list.stateIcon} ${list.errorIcon}`}><IconAlert /></span><h3>Couldn’t load pages</h3><p>{error}</p><button type="button" className={list.stateAction} onClick={() => { setError(null); setAttempt((n) => n + 1); }}>Try again</button></div>
        ) : !items ? (
          <div className={list.skeleton} role="status" aria-label="Loading pages"><span /><span /><span /><span /><span /></div>
        ) : filtered.length === 0 ? (
          <div className={list.state}>
            <span className={list.stateIcon}><IconPage /></span>
            <h3>{search.trim() ? `No pages match “${search.trim()}”` : 'No pages in this view'}</h3>
            <p>{hasFilters ? 'Try another search or type.' : 'Create a page to get started.'}</p>
            {hasFilters ? <button type="button" className={list.stateLink} onClick={() => { setSearch(''); setTab('all'); }}>Clear filters</button> : <Link className={list.stateAction} href="/pages/new">Create page</Link>}
          </div>
        ) : (
          <>
            <div className={list.tableWrap}>
              <table className={list.table}>
                <caption className="sr-only">Pages</caption>
                <thead><tr><th scope="col">Page</th><th scope="col">Type</th><th scope="col">URL</th><th scope="col">Status</th><th scope="col">Updated</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.key} onClick={(e) => onRowClick(e, r)}>
                      <td><Link className={list.primary} href={r.editHref}>{r.title}</Link>{r.subtitle && <span className={list.sub}>{r.subtitle}</span>}</td>
                      <td><span className={list.chip}>{KIND_LABEL[r.kind]}</span></td>
                      <td><span className="text-[12px] text-[#55616b]" style={{ fontVariantNumeric: 'tabular-nums' }}>{r.url}</span></td>
                      <td>
                        <span className="inline-flex items-center gap-2">
                          {r.publishDoc && <AdminSwitch isSelected={r.publishDoc.isPublished} onValueChange={(v) => togglePublish(r.publishDoc!, v)} aria-label={`${r.title} published`} />}
                          <StatusChip status={r.live ? 'live' : 'draft'} />
                          {r.kind === 'static' && <span className={list.sub} style={{ marginTop: 0 }}>{r.seoCustomised ? 'Search text set' : 'Default search text'}</span>}
                        </span>
                      </td>
                      <td className="text-[#8a939b]">{r.updatedAt ? formatDate(r.updatedAt) : '—'}</td>
                      <td>
                        <div className="flex items-center justify-end gap-1.5">
                          {r.deleteDoc && <RowActions ariaLabel={`More actions for ${r.title}`} items={[{ key: 'delete', label: 'Delete page…', hint: 'Its address stops working', tone: 'danger', onSelect: () => removePage(r.deleteDoc!) }]} />}
                          <Link className={list.openLink} href={r.editHref} aria-label={`${r.editLabel} ${r.title}`} title={r.editLabel}><IconArrow /></Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={list.cards}>
              {shown.map((r) => (
                <Link key={r.key} className={list.card} href={r.editHref}>
                  <div className={list.cardTop}>
                    <div className="min-w-0"><span className={list.primary}>{r.title}</span><span className={list.sub}>{KIND_LABEL[r.kind]} · {r.url}</span></div>
                    <StatusChip status={r.live ? 'live' : 'draft'} />
                  </div>
                </Link>
              ))}
            </div>
            {totalPages > 1 && (
              <div className={list.footer}>
                <span>Page {safePage} of {totalPages}</span>
                <div className={list.pager}>
                  <button type="button" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}><IconArrow flip /> Previous</button>
                  <button type="button" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>Next <IconArrow /></button>
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
function IconPage() { return <svg {...svg}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><polyline points="14 3 14 8 19 8" /></svg>; }
