'use client';

/**
 * Categories (and, scoped to one root, Shop by Bike makes & models) in the
 * workspace list layout: one panel with the count, search, "Add" in the
 * header, and a tree table (children indented under their parent) that
 * turns into cards on narrow panels. A row opens the category for editing.
 *
 * Add and edit share one form shown in place of the list: titled sections
 * (details with the parent picker, icon, SEO with a live search preview,
 * top and bottom content) beside a sticky rail with Active, Save, and
 * "Open in new tab" for a saved category.
 *
 * Data unchanged: GET /categories/admin (flat list), POST /categories,
 * PUT /categories/:id, DELETE /categories/:id, icon upload via ImageSlot.
 */
import { useEffect, useMemo, useState } from 'react';
import AdminSwitch from '@/components/AdminSwitch';
import AdminButton from '@/components/AdminButton';
import AdminInput from '@/components/AdminInput';
import AdminSelect from '@/components/AdminSelect';
import AdminTextarea from '@/components/AdminTextarea';
import RichTextEditor from '@/components/common/RichTextEditor';
import ImageSlot from '@/components/media/ImageSlot';
import { RowActions, StatusChip } from '@/components/ui';
import { FieldMeta, SerpPreview, TITLE_MAX, DESC_MAX } from '@/components/SeoFields';
import { api, imageUrl, envelopeOrLegacy } from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import { previewUrl, storefrontOrigin } from '@/lib/storefrontUrl';
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';
import list from '@/components/WorkspaceList.module.css';
import form from '@/components/AdminForm.module.css';
import shared from '@/app/sellers/[slug]/detail.module.css';

/** Stats reported to a parent page (kept for callers that still pass `onStatsChange`). */
export type CategoryStats = {
  sectionTotal: number;
  topLevel: number;
  descendants: number;
  rawAll: { _id: string; name: string; parent: string | null }[];
};

type Category = {
  _id: string; name: string; slug?: string; description?: string; parent: string | null; icon?: string; order: number; isActive: boolean;
  seoTitle?: string; seoDescription?: string; contentTitle?: string; contentDescription?: string; bottomTitle?: string; bottomDescription?: string;
};
type FormState = {
  name: string; slug: string; description: string; parent: string | null; icon: string; order: number; isActive: boolean;
  seoTitle: string; seoDescription: string; contentTitle: string; contentDescription: string; bottomTitle: string; bottomDescription: string;
};
const emptyForm: FormState = { name: '', slug: '', description: '', parent: null, icon: '', order: 0, isActive: true, seoTitle: '', seoDescription: '', contentTitle: '', contentDescription: '', bottomTitle: '', bottomDescription: '' };

interface Props {
  /** Scope to one top-level root (Shop by Bike): only its subtree is listed and new rows nest under it. */
  rootName?: string;
  /** Hide one top-level root and its subtree (the Categories tab hides Shop by Bike). */
  excludeRootName?: string;
  emptyText?: string;
  addTitle?: string;
  listAccent?: 'blue' | 'indigo' | 'amber' | 'emerald';
  listTitle?: string;
  onStatsChange?: (stats: CategoryStats) => void;
}

const TOP_LEVEL_KEY = '__TOP_LEVEL__';
const INDENT = '   ';
const PAGE_SIZE = 15;
const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
const initials = (name: string) => (name || '?').trim().slice(0, 2).toUpperCase();

export default function CategoryTable({ rootName, excludeRootName, emptyText = 'No categories yet.', addTitle, listTitle = 'Categories', onStatsChange }: Props) {
  const [all, setAll] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState<{ kind: 'new' } | { kind: 'edit'; cat: Category } | null>(null);
  const [draft, setDraft] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = () => api.get('/categories/admin').then(envelopeOrLegacy)
    .then(({ data }) => { setAll(data.flat as Category[]); setError(null); })
    .catch((e) => setError(e?.response?.status >= 500 || !e?.response ? 'The category list is unavailable right now.' : 'Categories couldn’t be loaded.'));
  useEffect(() => { void load(); }, [attempt]);

  const rows = useMemo(() => all || [], [all]);
  const scopedRootId = useMemo(() => (rootName ? rows.find((c) => c.parent === null && c.name === rootName)?._id ?? null : null), [rows, rootName]);
  const childrenOf = useMemo(() => {
    const map = new Map<string, Category[]>();
    for (const c of rows) { const k = c.parent ?? 'ROOT'; if (!map.has(k)) map.set(k, []); map.get(k)!.push(c); }
    for (const arr of map.values()) arr.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    return map;
  }, [rows]);
  const includedRoots = useMemo(() => (childrenOf.get('ROOT') || []).filter((r) => (rootName ? r.name === rootName : excludeRootName ? r.name !== excludeRootName : true)), [childrenOf, rootName, excludeRootName]);
  /* Depth-first rows. In scoped mode the root itself isn't a row — its children are the top level. */
  const flatRows = useMemo(() => {
    const out: { cat: Category; depth: number }[] = [];
    const walk = (node: Category, depth: number) => { out.push({ cat: node, depth }); for (const c of childrenOf.get(node._id) || []) walk(c, depth + 1); };
    for (const r of includedRoots) { if (rootName) for (const c of childrenOf.get(r._id) || []) walk(c, 0); else walk(r, 0); }
    return out;
  }, [childrenOf, includedRoots, rootName]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? flatRows.filter(({ cat }) => cat.name.toLowerCase().includes(q) || (cat.slug || '').includes(q)) : flatRows;
  }, [flatRows, search]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const shown = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const childCount = (id: string) => childrenOf.get(id)?.length ?? 0;
  const descendantsCount = (id: string): number => (childrenOf.get(id) || []).reduce((n, c) => n + 1 + descendantsCount(c._id), 0);

  useEffect(() => {
    if (!onStatsChange || !all) return;
    const topLevel = flatRows.filter((r) => r.depth === 0).length;
    onStatsChange({ sectionTotal: flatRows.length, topLevel, descendants: flatRows.length - topLevel, rawAll: all.map((c) => ({ _id: c._id, name: c.name, parent: c.parent })) });
  }, [flatRows, all, onStatsChange]);

  /** Parent options, depth-first, without self and descendants (no cycles). */
  function parentOptions(forCat: Category | null) {
    const blocked = new Set<string>();
    if (forCat) { blocked.add(forCat._id); const collect = (pid: string) => { for (const c of rows) if (c.parent === pid && !blocked.has(c._id)) { blocked.add(c._id); collect(c._id); } }; collect(forCat._id); }
    const out: { cat: Category; depth: number }[] = [];
    const walk = (node: Category, depth: number) => { if (blocked.has(node._id)) return; out.push({ cat: node, depth }); for (const c of childrenOf.get(node._id) || []) walk(c, depth + 1); };
    for (const r of includedRoots) { if (rootName) for (const c of childrenOf.get(r._id) || []) walk(c, 0); else walk(r, 0); }
    return out;
  }
  const nameOf = (id: string | null) => rows.find((c) => c._id === id)?.name;

  function openNew() { setDraft({ ...emptyForm, parent: scopedRootId ?? null }); setMode({ kind: 'new' }); window.scrollTo(0, 0); }
  function openEdit(cat: Category) {
    setDraft({ name: cat.name, slug: cat.slug || '', description: cat.description || '', parent: cat.parent, icon: cat.icon || '', order: cat.order, isActive: cat.isActive,
      seoTitle: cat.seoTitle || '', seoDescription: cat.seoDescription || '', contentTitle: cat.contentTitle || '', contentDescription: cat.contentDescription || '', bottomTitle: cat.bottomTitle || '', bottomDescription: cat.bottomDescription || '' });
    setMode({ kind: 'edit', cat }); window.scrollTo(0, 0);
  }
  async function save() {
    if (!mode) return;
    if (!draft.name.trim()) { notifyWarning(M.categoryTable.nameIsRequired); return; }
    setSaving(true);
    try {
      if (mode.kind === 'new') { await api.post('/categories', draft); notifySuccess(M.categoryTable.created(draft.name)); }
      else { await api.put(`/categories/${mode.cat._id}`, draft); notifySuccess(M.categoryTable.categoryUpdated); }
      setMode(null); await load();
    } catch (e: any) { notifyError(e, mode.kind === 'new' ? M.categoryTable.couldntCreate : M.categoryTable.couldntUpdate); }
    finally { setSaving(false); }
  }
  async function remove(cat: Category) {
    const kids = descendantsCount(cat._id);
    const ok = await confirmDialog({
      title: `Delete ${cat.name}?`,
      message: kids ? `It has ${kids} ${kids === 1 ? 'subcategory' : 'subcategories'} underneath. Move or delete those first if you want to keep them. This can’t be undone.` : 'Products in it keep their other categories. This can’t be undone.',
      destructive: true, confirmLabel: 'Delete category',
    });
    if (!ok) return;
    try { await api.delete(`/categories/${cat._id}`); notifySuccess(M.categoryTable.deleted); await load(); }
    catch (e: any) { notifyError(e, M.categoryTable.couldntDelete); }
  }
  const set = (patch: Partial<FormState>) => setDraft((d) => ({ ...d, ...patch }));
  const onRowClick = (e: React.MouseEvent, cat: Category) => { if ((e.target as HTMLElement).closest('a,button')) return; openEdit(cat); };
  const noun = rootName ? 'make or model' : 'category';
  const addLabel = addTitle || (rootName ? 'Add make or model' : 'Add category');

  /* ── Add / edit ── */
  if (mode) {
    const isNew = mode.kind === 'new';
    const forCat = isNew ? null : mode.cat;
    const options = parentOptions(forCat);
    const sentinelValue = rootName && scopedRootId ? scopedRootId : TOP_LEVEL_KEY;
    const parentValue = draft.parent ?? sentinelValue;
    const slugPreview = draft.slug || slugify(draft.name);
    return (
      <div className={list.page}>
        <button type="button" className={shared.back} onClick={() => setMode(null)}><IconBack /> Back to {rootName ? 'makes & models' : 'categories'}</button>

        <section className={`${shared.panel} ${shared.summary}`}>
          <span className={shared.avatar} aria-hidden style={draft.icon ? { background: 'white', border: '1px solid #e9edf0' } : undefined}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {draft.icon ? <img src={imageUrl(draft.icon)} alt="" style={{ objectFit: 'contain', padding: 6 }} /> : initials(draft.name)}
          </span>
          <div className={shared.who}>
            <h1>
              {draft.name || (isNew ? `New ${noun}` : 'Untitled')}
              <StatusChip label={draft.isActive ? 'Active' : 'Inactive'} status={draft.isActive ? 'active' : 'inactive'} />
            </h1>
            <div className={shared.meta}>
              <span>/{slugPreview || '…'}</span>
              {draft.parent && nameOf(draft.parent) && <span>Under {nameOf(draft.parent)}</span>}
              {!isNew && childCount(mode.cat._id) > 0 && <span>{childCount(mode.cat._id)} {childCount(mode.cat._id) === 1 ? 'subcategory' : 'subcategories'}</span>}
            </div>
          </div>
        </section>

        <div className={form.layout}>
          <section className={form.panel}>
            <div className={form.grid}>
              <div className={form.section}><h3>Details</h3><p>Name, web address and where this sits in the tree.</p></div>
              <AdminInput label="Name" isRequired variant="bordered" value={draft.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
              <AdminInput label="Slug" variant="bordered" value={draft.slug} onChange={(e) => set({ slug: e.target.value })} placeholder={draft.name ? slugify(draft.name) : 'made from the name'} description="Leave blank to make one from the name." />
              <div>
                <label className={form.label} htmlFor="cat-parent">Parent</label>
                <AdminSelect id="cat-parent" fullWidth ariaLabel="Parent" value={parentValue} onChange={(v) => set({ parent: v === TOP_LEVEL_KEY ? null : v })} options={[{ value: sentinelValue, label: rootName ? `Directly under ${rootName}` : 'None — top level' }, ...options.map(({ cat, depth }) => ({ value: cat._id, label: `${INDENT.repeat(depth)}${cat.name}` }))]} />
                <p className={form.help}>{rootName ? 'A make sits directly under Shop by Bike; a model goes under its make.' : 'Pick a parent to nest this category, or keep it top level.'}</p>
              </div>
              <AdminInput label="Order" type="number" variant="bordered" value={String(draft.order)} onChange={(e) => set({ order: Number(e.target.value) || 0 })} description="Lower numbers show first among siblings." />
              <div className={form.full}><AdminTextarea label="Description" variant="bordered" minRows={3} value={draft.description} onChange={(e) => set({ description: e.target.value })} description="Optional. Shown on the storefront category page." /></div>

              <div className={form.section}><h3>Icon</h3><p>Shown in the storefront category grid. PNG, JPG, WEBP or SVG up to 5 MB.</p></div>
              <div className={`${form.full} ${form.upload}`}>
                <ImageSlot label="" aspect="aspect-square" fit="contain" hint="No icon" value={draft.icon} onChange={(url) => set({ icon: url })} uploadEndpoint="/categories/upload-icon" uploadField="icon" acceptedTypes="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" />
              </div>

              <div className={form.section}><h3>Search engines</h3><p>What Google shows for this page. Optional — defaults come from the name.</p></div>
              <div><AdminInput label="Meta title" variant="bordered" maxLength={100} value={draft.seoTitle} onChange={(e) => set({ seoTitle: e.target.value })} /><FieldMeta hint="Overrides the page title." max={TITLE_MAX} value={draft.seoTitle} /></div>
              <div><AdminTextarea label="Meta description" variant="bordered" minRows={2} maxLength={200} value={draft.seoDescription} onChange={(e) => set({ seoDescription: e.target.value })} /><FieldMeta hint="Shown under the title in Google results." max={DESC_MAX} value={draft.seoDescription} /></div>
              <div className={form.full}><SerpPreview description={draft.seoDescription} fallbackTitle={draft.name ? `${draft.name} — THROTTLEIN` : ''} origin={storefrontOrigin('main')} route={`/${slugPreview}`} title={draft.seoTitle} /></div>

              <div className={form.section}><h3>Top of the page</h3><p>Replaces the heading and the intro line under it.</p></div>
              <AdminInput label="Title" variant="bordered" maxLength={150} value={draft.contentTitle} onChange={(e) => set({ contentTitle: e.target.value })} />
              <AdminTextarea label="Intro" variant="bordered" minRows={2} maxLength={500} value={draft.contentDescription} onChange={(e) => set({ contentDescription: e.target.value })} />

              <div className={form.section}><h3>Below the products</h3><p>SEO copy after the product grid — headings, links and lists are fine.</p></div>
              <div className={form.full}><AdminInput label="Title" variant="bordered" maxLength={150} value={draft.bottomTitle} onChange={(e) => set({ bottomTitle: e.target.value })} /></div>
              <div className={form.full}><RichTextEditor value={draft.bottomDescription} onChange={(html) => set({ bottomDescription: html })} /></div>
            </div>
          </section>

          <aside className={form.rail} aria-label="Visibility and actions">
            <div className={form.railTitle}>Visibility</div>
            <div className={form.toggleRow}><div><strong>Active</strong><span>Inactive categories are hidden from the storefront menu and grids.</span></div><AdminSwitch isSelected={draft.isActive} onValueChange={(v) => set({ isActive: v })} aria-label="Active" /></div>
            <div className={form.railActions}>
              <AdminButton color="primary" onPress={save} isLoading={saving}>{isNew ? addLabel : 'Save changes'}</AdminButton>
              {!isNew && (
                <button type="button" className={form.railLink} disabled={!mode.cat.slug} onClick={() => window.open(previewUrl('main', `/${mode.cat.slug}`), '_blank', 'noopener,noreferrer')}><IconExternal /> Open on the storefront</button>
              )}
              <AdminButton variant="bordered" onPress={() => setMode(null)} isDisabled={saving}>Cancel</AdminButton>
              {!isNew && draft.slug !== (mode.cat.slug || '') && <p className={form.railNote}>Slug changed — the old URL stops working once you save.</p>}
            </div>
          </aside>
        </div>
      </div>
    );
  }

  /* ── List ── */
  return (
    <div className={list.page}>
      <section className={list.workspace} aria-labelledby="categories-heading">
        <div className={list.listHeader}>
          <div>
            <h2 id="categories-heading">{listTitle} <span className={list.count}>{all ? flatRows.length : '…'}</span></h2>
            <p>{rootName ? 'Bike makes, with their models underneath. Sellers tag bike-specific products with these.' : 'The storefront menu and product grouping. Subcategories sit indented under their parent.'}</p>
          </div>
          <div className={list.headerActions}><AdminButton color="primary" onPress={openNew}><IconPlus /> {addLabel}</AdminButton></div>
        </div>
        <div className={list.toolbar}>
          <div className={list.toolbarLeft}>
            <label className={list.search}>
              <IconSearch /><span className="sr-only">Search</span>
              <input type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search name or slug" />
              {search && <button type="button" className={list.clearSearch} onClick={() => setSearch('')} aria-label="Clear search"><IconClose /></button>}
            </label>
          </div>
          <div className={list.results}>{all && <span>{filtered.length ? `Showing ${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, filtered.length)} of ${filtered.length}` : 'No results'}</span>}</div>
        </div>

        {error && !all ? (
          <div className={list.state} role="alert"><span className={`${list.stateIcon} ${list.errorIcon}`}><IconAlert /></span><h3>Couldn’t load {rootName ? 'makes & models' : 'categories'}</h3><p>{error}</p><button type="button" className={list.stateAction} onClick={() => { setError(null); setAttempt((n) => n + 1); }}>Try again</button></div>
        ) : !all ? (
          <div className={list.skeleton} role="status" aria-label="Loading"><span /><span /><span /><span /></div>
        ) : filtered.length === 0 ? (
          <div className={list.state}>
            <span className={list.stateIcon}><IconFolder /></span>
            <h3>{search.trim() ? `No matches for “${search.trim()}”` : emptyText}</h3>
            <p>{search.trim() ? 'Try a different name or slug.' : `Add the first ${noun} to get started.`}</p>
            {search.trim() ? <button type="button" className={list.stateLink} onClick={() => setSearch('')}>Clear search</button> : <button type="button" className={list.stateAction} onClick={openNew}>{addLabel}</button>}
          </div>
        ) : (
          <>
            <div className={list.tableWrap}>
              <table className={list.table}>
                <caption className="sr-only">{listTitle}</caption>
                <thead><tr><th scope="col">Name</th><th scope="col">{rootName ? 'Models' : 'Subcategories'}</th><th scope="col">Order</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {shown.map(({ cat, depth }) => (
                    <tr key={cat._id} onClick={(e) => onRowClick(e, cat)}>
                      <td>
                        <div className="flex items-center gap-3" style={{ paddingLeft: depth * 24 }}>
                          {depth > 0 && <span aria-hidden className="text-[#c9d1d8]">└</span>}
                          {cat.icon
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img alt="" className="h-8 w-8 flex-none rounded-md border border-[#e9edf0] bg-white object-contain p-0.5" src={imageUrl(cat.icon)} />
                            : <span aria-hidden className="grid h-8 w-8 flex-none place-items-center rounded-md bg-[#f0f2f4] text-[10px] font-semibold text-[#55616b]">{initials(cat.name)}</span>}
                          <div className="min-w-0"><span className={list.primary}>{cat.name}</span><span className={list.sub}>/{cat.slug}</span></div>
                        </div>
                      </td>
                      <td className={childCount(cat._id) ? '' : 'text-[#8a939b]'}>{childCount(cat._id) || '—'}</td>
                      <td className="text-[#8a939b]">{cat.order}</td>
                      <td><StatusChip status={cat.isActive ? 'active' : 'inactive'} /></td>
                      <td>
                        <div className="flex items-center justify-end gap-1.5">
                          <RowActions ariaLabel={`More actions for ${cat.name}`} items={[{ key: 'delete', label: `Delete ${noun}…`, hint: childCount(cat._id) ? `Has ${childCount(cat._id)} underneath` : undefined, tone: 'danger', onSelect: () => remove(cat) }]} />
                          <button type="button" className={list.openLink} onClick={() => openEdit(cat)} aria-label={`Edit ${cat.name}`} title="Edit"><IconArrow /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={list.cards}>
              {shown.map(({ cat, depth }) => (
                <button key={cat._id} type="button" className={`${list.card} w-full text-left`} onClick={() => openEdit(cat)}>
                  <div className={list.cardTop}>
                    <div className="min-w-0" style={{ paddingLeft: depth * 16 }}><span className={list.primary}>{depth > 0 ? '└ ' : ''}{cat.name}</span><span className={list.sub}>/{cat.slug}{childCount(cat._id) ? ` · ${childCount(cat._id)} underneath` : ''}</span></div>
                    <StatusChip status={cat.isActive ? 'active' : 'inactive'} />
                  </div>
                </button>
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
function IconBack() { return <svg {...svg}><line x1="19" y1="12" x2="5" y2="12" /><polyline points="11 18 5 12 11 6" /></svg>; }
function IconPlus() { return <svg {...svg} width="14" height="14"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>; }
function IconSearch() { return <svg {...svg}><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>; }
function IconClose() { return <svg {...svg} width="12" height="12"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>; }
function IconAlert() { return <svg {...svg}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>; }
function IconFolder() { return <svg {...svg}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>; }
function IconExternal() { return <svg {...svg}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>; }
