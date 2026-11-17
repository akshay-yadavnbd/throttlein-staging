'use client';

/**
 * Admin — brands, in the workspace list layout (same family as Orders,
 * Sellers, Customers): one panel with tabs (All / Featured / Regular),
 * search, "Add brand" in the header, and a table that turns into cards on
 * narrow panels. A row opens the brand for editing.
 *
 * Add and edit are the same form, shown in place of the list: titled
 * sections (details, logo, SEO, top and bottom content) beside a sticky
 * rail with the visibility toggles and Save. Delete lives in the row menu
 * and confirms with how many products use the brand.
 *
 * Data unchanged: GET /brands?counts=1, POST /brands, PUT /brands/:id,
 * DELETE /brands/:id, logo upload via ImageSlot.
 */
import { useEffect, useMemo, useState } from 'react';
import AdminSwitch from '@/components/AdminSwitch';
import AdminButton from '@/components/AdminButton';
import AdminInput from '@/components/AdminInput';
import AdminTextarea from '@/components/AdminTextarea';
import ModuleTabs from '@/components/ModuleTabs';
import RichTextEditor from '@/components/common/RichTextEditor';
import ImageSlot from '@/components/media/ImageSlot';
import { RowActions, StatusChip } from '@/components/ui';
import { Field, Counter } from '@/components/EditorShell';
import { api, imageUrl, envelopeOrLegacy } from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';
import list from '@/components/WorkspaceList.module.css';
import form from '@/components/AdminForm.module.css';
import shared from '@/app/sellers/[slug]/detail.module.css';

type Brand = {
  _id: string; name: string; slug?: string; logo?: string; description?: string; website?: string;
  isActive: boolean; featured?: boolean; order: number;
  seoTitle?: string; seoDescription?: string; ogImage?: string;
  contentTitle?: string; contentDescription?: string; bottomTitle?: string; bottomDescription?: string;
  /** From `/brands?counts=1` — products (any status) pointing at this brand. */
  productsCount?: number;
};
type FormState = {
  name: string; slug: string; logo: string; description: string; website: string; isActive: boolean; featured: boolean; order: number;
  seoTitle: string; seoDescription: string; ogImage: string; contentTitle: string; contentDescription: string; bottomTitle: string; bottomDescription: string;
};
const emptyForm: FormState = { name: '', slug: '', logo: '', description: '', website: '', isActive: true, featured: false, order: 0, seoTitle: '', seoDescription: '', ogImage: '', contentTitle: '', contentDescription: '', bottomTitle: '', bottomDescription: '' };
const PAGE_SIZE = 15;
type Filter = 'all' | 'featured' | 'regular';

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
const initials = (name: string) => (name || '?').trim().slice(0, 2).toUpperCase();

export default function BrandsPage() {
  const [items, setItems] = useState<Brand[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  /* `mode` replaces the list: a new brand, or the brand being edited. */
  const [mode, setMode] = useState<{ kind: 'new' } | { kind: 'edit'; brand: Brand } | null>(null);
  const [draft, setDraft] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = () => api.get('/brands', { params: { counts: 1 } }).then(envelopeOrLegacy)
    .then(({ data }) => { setItems(data.items || []); setError(null); })
    .catch((e) => setError(e?.response?.status >= 500 || !e?.response ? 'The brands list is unavailable right now.' : 'Brands couldn’t be loaded.'));
  useEffect(() => { void load(); }, [attempt]);

  const all = useMemo(() => items || [], [items]);
  const featuredCount = all.filter((b) => b.featured).length;
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((b) => (filter === 'all' || (filter === 'featured') === !!b.featured) && (!q || b.name.toLowerCase().includes(q) || (b.slug || '').includes(q)));
  }, [all, filter, search]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const shown = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function openNew() { setDraft(emptyForm); setMode({ kind: 'new' }); }
  function openEdit(b: Brand) {
    setDraft({ name: b.name, slug: b.slug || '', logo: b.logo || '', description: b.description || '', website: b.website || '', isActive: b.isActive, featured: !!b.featured, order: b.order,
      seoTitle: b.seoTitle || '', seoDescription: b.seoDescription || '', ogImage: b.ogImage || '', contentTitle: b.contentTitle || '', contentDescription: b.contentDescription || '', bottomTitle: b.bottomTitle || '', bottomDescription: b.bottomDescription || '' });
    setMode({ kind: 'edit', brand: b });
    window.scrollTo(0, 0);
  }
  async function save() {
    if (!mode) return;
    if (!draft.name.trim()) { notifyWarning(M.brands.brandNameIsRequired); return; }
    setSaving(true);
    try {
      if (mode.kind === 'new') { await api.post('/brands', draft); notifySuccess(M.brands.added(draft.name)); }
      else { await api.put(`/brands/${mode.brand._id}`, draft); notifySuccess(M.brands.brandUpdated); }
      setMode(null);
      await load();
    } catch (e: any) {
      notifyError(e, mode.kind === 'new' ? M.brands.couldntCreate : M.brands.couldntUpdate);
    } finally { setSaving(false); }
  }
  async function remove(b: Brand) {
    const n = b.productsCount || 0;
    const ok = await confirmDialog({
      title: `Delete ${b.name}?`,
      message: n ? `${n} ${n === 1 ? 'product uses' : 'products use'} this brand. ${n === 1 ? 'It' : 'They'} will lose the brand and drop off the brand page. This can’t be undone.` : 'This can’t be undone.',
      destructive: true, confirmLabel: 'Delete brand',
    });
    if (!ok) return;
    try { await api.delete(`/brands/${b._id}`); notifySuccess(M.brands.deleted); await load(); }
    catch (e: any) { notifyError(e, M.brands.couldntDelete); }
  }
  const onRowClick = (e: React.MouseEvent, b: Brand) => { if ((e.target as HTMLElement).closest('a,button')) return; openEdit(b); };
  const set = (patch: Partial<FormState>) => setDraft((d) => ({ ...d, ...patch }));

  /* ── Add / edit ── */
  if (mode) {
    const isNew = mode.kind === 'new';
    const slugPreview = draft.slug || slugify(draft.name);
    return (
      <div className={list.page}>
        <ModuleTabs moduleKey="brands" />
        <button type="button" className={shared.back} onClick={() => setMode(null)}><IconBack /> Back to brands</button>

        <section className={`${shared.panel} ${shared.summary}`}>
          {/* Rounded square, not the circle people get — brand logos are
              square artwork and a circle clips their corners. */}
          <span className={shared.avatar} aria-hidden style={{ borderRadius: 12, background: draft.logo ? 'white' : undefined, border: draft.logo ? '1px solid #e9edf0' : undefined }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {draft.logo ? <img src={imageUrl(draft.logo)} alt="" style={{ objectFit: 'contain', padding: 6 }} /> : draft.name ? initials(draft.name) : <IconTag />}
          </span>
          <div className={shared.who}>
            <h1>
              {isNew ? (draft.name || 'New brand') : draft.name}
              <StatusChip label={draft.isActive ? 'Active' : 'Inactive'} status={draft.isActive ? 'active' : 'inactive'} />
              {draft.featured && <StatusChip label="Featured" status="approved" />}
            </h1>
            <div className={shared.meta}>
              <span>/brands/{slugPreview || '…'}</span>
              {!isNew && <span>{mode.brand.productsCount ?? 0} {mode.brand.productsCount === 1 ? 'product' : 'products'}</span>}
            </div>
          </div>
        </section>

        <div className={form.layout}>
          <section className={form.panel}>
            <div className={form.grid}>
              <div className={form.section}><h3>Brand details</h3><p>Name, web address, official site and where it sorts in the brands list.</p></div>
              <AdminInput label="Name" isRequired variant="bordered" value={draft.name} onChange={(e) => set({ name: e.target.value })} autoFocus description="As sellers and customers see it." />
              <AdminInput label="Slug" variant="bordered" value={draft.slug} onChange={(e) => set({ slug: e.target.value })} placeholder={draft.name ? slugify(draft.name) : 'made from the name'} startContent={<span className={form.prefix}>/brands/</span>} description="Blank makes one from the name." />
              <div className={form.full}><AdminInput label="Website" variant="bordered" placeholder="https://brand-site.com" value={draft.website} onChange={(e) => set({ website: e.target.value })} description="The Visit website link on the brand page. Optional." /></div>
              <div className={form.full}><AdminTextarea label="Description" variant="bordered" minRows={3} value={draft.description} onChange={(e) => set({ description: e.target.value })} description="Optional. Shown on the storefront brand page." /></div>

              <div className={form.section}><h3>Search engines</h3><p>What Google and link previews show for this brand. Optional — blank fields fall back to the name, description and logo.</p></div>
              <div>
                <AdminInput label="Meta title" variant="bordered" placeholder="Made from the brand name" value={draft.seoTitle} onChange={(e) => set({ seoTitle: e.target.value })} />
                <Counter value={draft.seoTitle} max={60} hint="Aim for 50–60 characters." />
              </div>
              <div>
                <AdminTextarea label="Meta description" variant="bordered" minRows={2} maxRows={3} value={draft.seoDescription} onChange={(e) => set({ seoDescription: e.target.value })} />
                <Counter value={draft.seoDescription} max={160} hint="Aim for 150–160 characters." />
              </div>
              <div className={`${form.full} ${form.upload}`}>
                <Field label="Social preview image" hint="1200×630 PNG or JPG. Falls back to the logo.">
                  <ImageSlot label="" aspect="aspect-[1200/630]" className="w-[240px] max-w-full" hint="No image" value={draft.ogImage} onChange={(url) => set({ ogImage: url })} uploadEndpoint="/brands/upload-logo" uploadField="logo" acceptedTypes="image/png,image/jpeg,image/webp" />
                </Field>
              </div>

              <div className={form.section}><h3>Top of the brand page</h3><p>Replaces the heading and the intro line under it. Optional.</p></div>
              <div className={form.full}><AdminInput label="Title" variant="bordered" maxLength={150} value={draft.contentTitle} onChange={(e) => set({ contentTitle: e.target.value })} placeholder={draft.name || 'Falls back to the brand name'} /></div>
              <div className={form.full}><AdminTextarea label="Intro" variant="bordered" minRows={2} maxLength={500} value={draft.contentDescription} onChange={(e) => set({ contentDescription: e.target.value })} /></div>

              <div className={form.section}><h3>Below the products</h3><p>SEO copy after the product grid — headings, links and lists are fine.</p></div>
              <div className={form.full}><AdminInput label="Title" variant="bordered" maxLength={150} value={draft.bottomTitle} onChange={(e) => set({ bottomTitle: e.target.value })} /></div>
              <div className={form.full}><RichTextEditor value={draft.bottomDescription} onChange={(html) => set({ bottomDescription: html })} /></div>
            </div>
          </section>

          <aside className={form.rail} aria-label="Visibility and actions">
            <div className={form.railGroup}>
              <div className={form.railTitle}>Logo</div>
              <p className={form.railHint}>On the brands index and the brand page. PNG, JPG, WEBP or SVG up to 5 MB — square artwork works best.</p>
              <ImageSlot label="" aspect="aspect-square" fit="contain" hint="No logo" value={draft.logo} onChange={(url) => set({ logo: url })} uploadEndpoint="/brands/upload-logo" uploadField="logo" acceptedTypes="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" />
            </div>
            <div className={form.railGroup}>
              <div className={form.railTitle}>Visibility</div>
              <div className={form.toggleRow}><div><strong>Active</strong><span>Sellers can pick this brand; it shows on the storefront.</span></div><AdminSwitch isSelected={draft.isActive} onValueChange={(v) => set({ isActive: v })} aria-label="Active" /></div>
              <div className={form.toggleRow}><div><strong>Featured</strong><span>Shown in the homepage Top Brands rail.</span></div><AdminSwitch isSelected={draft.featured} onValueChange={(v) => set({ featured: v })} aria-label="Featured" /></div>
              <AdminInput label="Order" type="number" variant="bordered" value={String(draft.order)} onChange={(e) => set({ order: Number(e.target.value) || 0 })} description="Lower numbers show first in the brands list." />
            </div>
            <div className={form.railActions}>
              <AdminButton color="primary" onPress={save} isLoading={saving}>{isNew ? 'Add brand' : 'Save changes'}</AdminButton>
              <AdminButton variant="bordered" onPress={() => setMode(null)} isDisabled={saving}>Cancel</AdminButton>
              {!isNew && draft.slug !== (mode.brand.slug || '') && <p className={form.railNote}>Slug changed — the old brand URL stops working once you save.</p>}
            </div>
          </aside>
        </div>
      </div>
    );
  }

  /* ── List ── */
  return (
    <div className={list.page}>
      <ModuleTabs moduleKey="brands" />
      <section className={list.workspace} aria-labelledby="brands-heading">
        <div className={list.listHeader}>
          <div>
            <h2 id="brands-heading">Brands <span className={list.count}>{items ? all.length : '…'}</span></h2>
            <p>Brands sellers can tag products with. Featured ones also appear in the homepage Top Brands rail.</p>
          </div>
          <div className={list.headerActions}><AdminButton color="primary" onPress={openNew}><IconPlus /> Add brand</AdminButton></div>
        </div>
        <div className={list.stageFilters} role="group" aria-label="Filter brands">
          {([['all', 'All', all.length], ['featured', 'Featured', featuredCount], ['regular', 'Regular', all.length - featuredCount]] as [Filter, string, number][]).map(([id, label, n]) => (
            <button key={id} type="button" aria-pressed={filter === id} onClick={() => { setFilter(id); setPage(1); }}>{label}<span>{items ? n : '…'}</span></button>
          ))}
        </div>
        <div className={list.toolbar}>
          <div className={list.toolbarLeft}>
            <label className={list.search}>
              <IconSearch /><span className="sr-only">Search brands</span>
              <input type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search name or slug" />
              {search && <button type="button" className={list.clearSearch} onClick={() => setSearch('')} aria-label="Clear search"><IconClose /></button>}
            </label>
          </div>
          <div className={list.results}>{items && <span>{filtered.length ? `Showing ${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, filtered.length)} of ${filtered.length}` : 'No results'}</span>}</div>
        </div>

        {error && !items ? (
          <div className={list.state} role="alert"><span className={`${list.stateIcon} ${list.errorIcon}`}><IconAlert /></span><h3>Couldn’t load brands</h3><p>{error}</p><button type="button" className={list.stateAction} onClick={() => { setError(null); setAttempt((n) => n + 1); }}>Try again</button></div>
        ) : !items ? (
          <div className={list.skeleton} role="status" aria-label="Loading brands"><span /><span /><span /><span /></div>
        ) : filtered.length === 0 ? (
          <div className={list.state}>
            <span className={list.stateIcon}><IconTag /></span>
            <h3>{search.trim() ? `No brands match “${search.trim()}”` : filter !== 'all' ? 'No brands in this filter' : 'No brands yet'}</h3>
            <p>{search.trim() || filter !== 'all' ? 'Try another search or filter.' : 'Add the first brand so sellers can tag their products.'}</p>
            {search.trim() || filter !== 'all' ? <button type="button" className={list.stateLink} onClick={() => { setSearch(''); setFilter('all'); }}>Clear filters</button> : <button type="button" className={list.stateAction} onClick={openNew}>Add brand</button>}
          </div>
        ) : (
          <>
            <div className={list.tableWrap}>
              <table className={list.table}>
                <caption className="sr-only">Brands</caption>
                <thead><tr><th scope="col">Brand</th><th scope="col">Products</th><th scope="col">Order</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {shown.map((b) => (
                    <tr key={b._id} onClick={(e) => onRowClick(e, b)}>
                      <td>
                        <div className="flex items-center gap-3">
                          <Logo b={b} />
                          <div className="min-w-0"><span className={list.primary}>{b.name}</span><span className={list.sub}>/brands/{b.slug}</span></div>
                        </div>
                      </td>
                      <td className={b.productsCount ? '' : 'text-[#8a939b]'}>{b.productsCount ?? '—'}</td>
                      <td className="text-[#8a939b]">{b.order}</td>
                      <td><span className="inline-flex items-center gap-1.5"><StatusChip status={b.isActive ? 'active' : 'inactive'} />{b.featured && <StatusChip label="Featured" status="approved" />}</span></td>
                      <td>
                        <div className="flex items-center justify-end gap-1.5">
                          <RowActions ariaLabel={`More actions for ${b.name}`} items={[{ key: 'delete', label: 'Delete brand…', hint: b.productsCount ? `Used by ${b.productsCount} product${b.productsCount === 1 ? '' : 's'}` : 'Not used by any product', tone: 'danger', onSelect: () => remove(b) }]} />
                          <button type="button" className={list.openLink} onClick={() => openEdit(b)} aria-label={`Edit ${b.name}`} title="Edit brand"><IconArrow /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={list.cards}>
              {shown.map((b) => (
                <button key={b._id} type="button" className={`${list.card} w-full text-left`} onClick={() => openEdit(b)}>
                  <div className={list.cardTop}>
                    <div className="flex items-center gap-3 min-w-0"><Logo b={b} /><div className="min-w-0"><span className={list.primary}>{b.name}</span><span className={list.sub}>{b.productsCount ?? 0} products · order {b.order}</span></div></div>
                    <StatusChip status={b.isActive ? 'active' : 'inactive'} />
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

function Logo({ b }: { b: Brand }) {
  return b.logo
    // eslint-disable-next-line @next/next/no-img-element
    ? <img alt="" className="h-9 w-9 flex-none rounded-lg border border-[#e9edf0] bg-white object-contain p-1" src={imageUrl(b.logo)} />
    : <span aria-hidden className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-[#191d21] text-[11px] font-semibold text-[#bdff00]">{initials(b.name)}</span>;
}

const svg = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
function IconArrow({ flip }: { flip?: boolean }) { return <svg {...svg} width="14" height="14" style={flip ? { transform: 'scaleX(-1)' } : undefined}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></svg>; }
function IconBack() { return <svg {...svg}><line x1="19" y1="12" x2="5" y2="12" /><polyline points="11 18 5 12 11 6" /></svg>; }
function IconPlus() { return <svg {...svg} width="14" height="14"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>; }
function IconSearch() { return <svg {...svg}><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>; }
function IconClose() { return <svg {...svg} width="12" height="12"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>; }
function IconAlert() { return <svg {...svg}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>; }
function IconTag() { return <svg {...svg}><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>; }
