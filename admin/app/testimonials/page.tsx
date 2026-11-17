'use client';

/**
 * Testimonials — seller success stories shown on the Sell Online landing
 * page and every seller-category page. Workspace list layout: tabs
 * (All / Published / Drafts) with counts, search, "Add testimonial" in the
 * header, and a table — person, the quote, order with move arrows, a
 * publish switch — that turns into cards on narrow panels.
 *
 * Create and edit run in a modal (TestimonialForm owns the API call) so
 * the list is never lost. Reorder arrows act on the FULL sorted list, so
 * filtering never corrupts the order. Scoped to the sidebar's active site.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import AdminSwitch from '@/components/AdminSwitch';
import AdminButton from '@/components/AdminButton';
import { RowActions, StatusChip } from '@/components/ui';
import { api, imageUrl, unwrap } from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import { useActiveSite } from '@/lib/useActiveSite';
import TestimonialForm, { emptyTestimonialForm, type TestimonialFormState } from './TestimonialForm';
import { notifyError, notifySuccess } from '@/lib/notify';
import { M } from '@/lib/messages';
import list from '@/components/WorkspaceList.module.css';
import modal from '@/components/AdminModal.module.css';

type Testimonial = { _id: string; name: string; company: string; avatar: string; quote: string; order: number; isActive: boolean; updatedAt?: string };
type Tab = 'all' | 'published' | 'draft';
const PAGE_SIZE = 15;

/** One readable line for the table — never raw markup. */
const plainText = (html: string) => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
const initials = (name: string) => (String(name || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase() || '?');

export default function TestimonialsPage() {
  const site = useActiveSite();
  const [items, setItems] = useState<Testimonial[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<{ mode: 'create' | 'edit'; id?: string; initial: TestimonialFormState } | null>(null);
  /* The modal footer element — the form portals its Cancel / Save into
     it so they sit outside the scrolling body. */
  const [footerEl, setFooterEl] = useState<HTMLElement | null>(null);

  const load = useCallback(() => api.get('/testimonials/admin')
    .then((r) => { setItems(unwrap<{ items?: any[] }>(r).items || []); setError(null); })
    .catch((e) => setError(e?.response?.status >= 500 || !e?.response ? 'Testimonials are unavailable right now.' : 'Testimonials couldn’t be loaded.')), []);
  useEffect(() => { void load(); }, [load, site, attempt]);

  const sorted = useMemo(() => [...(items || [])].sort((a, b) => a.order - b.order || a._id.localeCompare(b._id)), [items]);
  const counts = { all: sorted.length, published: sorted.filter((t) => t.isActive).length, draft: sorted.filter((t) => !t.isActive).length };
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sorted.filter((t) => (tab === 'all' || (tab === 'published') === t.isActive) && (!q || t.name?.toLowerCase().includes(q) || t.company?.toLowerCase().includes(q) || plainText(t.quote).toLowerCase().includes(q)));
  }, [sorted, tab, search]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const shown = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const hasFilters = !!search.trim() || tab !== 'all';

  function openCreate() {
    setEditor({ mode: 'create', initial: { ...emptyTestimonialForm, order: sorted.length ? Math.max(...sorted.map((x) => x.order)) + 1 : 0 } });
  }
  function openEdit(t: Testimonial) {
    setEditor({ mode: 'edit', id: t._id, initial: { name: t.name || '', company: t.company || '', avatar: t.avatar || '', quote: t.quote || '', order: typeof t.order === 'number' ? t.order : 0, isActive: t.isActive !== false } });
  }
  async function togglePublished(t: Testimonial, next: boolean) {
    setItems((prev) => (prev || []).map((x) => (x._id === t._id ? { ...x, isActive: next } : x)));
    try { await api.put(`/testimonials/admin/${t._id}`, { isActive: next }); }
    catch (e: any) { setItems((prev) => (prev || []).map((x) => (x._id === t._id ? { ...x, isActive: !next } : x))); notifyError(e, M.testimonials.couldntUpdate); }
  }
  async function remove(t: Testimonial) {
    const ok = await confirmDialog({ title: `Delete ${t.name || 'this testimonial'}?`, message: 'It leaves the Sell Online pages straight away. This can’t be undone.', destructive: true, confirmLabel: 'Delete testimonial' });
    if (!ok) return;
    try { await api.delete(`/testimonials/admin/${t._id}`); notifySuccess(M.testimonials.deleted); await load(); }
    catch (e: any) { notifyError(e, M.testimonials.couldntDelete); }
  }
  /** Swap `order` with the neighbour; both rows locked while the two PUTs are in flight. */
  async function move(t: Testimonial, dir: -1 | 1) {
    const idx = sorted.findIndex((x) => x._id === t._id);
    const n = sorted[idx + dir];
    if (idx < 0 || !n) return;
    setBusy((b) => new Set(b).add(t._id).add(n._id));
    try {
      await Promise.all([api.put(`/testimonials/admin/${t._id}`, { order: n.order }), api.put(`/testimonials/admin/${n._id}`, { order: t.order })]);
      setItems((prev) => (prev || []).map((x) => (x._id === t._id ? { ...x, order: n.order } : x._id === n._id ? { ...x, order: t.order } : x)));
    } catch (e: any) { notifyError(e, M.testimonials.couldntReorder); }
    finally { setBusy((b) => { const next = new Set(b); next.delete(t._id); next.delete(n._id); return next; }); }
  }
  const onRowClick = (e: React.MouseEvent, t: Testimonial) => { if ((e.target as HTMLElement).closest('a,button,label,input')) return; openEdit(t); };

  return (
    <div className={list.page}>
      <section className={list.workspace} aria-labelledby="testimonials-heading">
        <div className={list.listHeader}>
          <div>
            <h2 id="testimonials-heading">Testimonials <span className={list.count}>{items ? counts.all : '…'}</span></h2>
            <p>Seller stories in the quote carousel on Sell Online and the seller-category pages. Order decides where each one appears; drafts stay hidden.</p>
          </div>
          <div className={list.headerActions}><AdminButton color="primary" onPress={openCreate}><IconPlus /> Add testimonial</AdminButton></div>
        </div>
        <div className={list.stageFilters} role="group" aria-label="Filter testimonials">
          {([['all', 'All'], ['published', 'Published'], ['draft', 'Drafts']] as [Tab, string][]).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={tab === id} onClick={() => { setTab(id); setPage(1); }}>{label}<span>{items ? counts[id] : '…'}</span></button>
          ))}
        </div>
        <div className={list.toolbar}>
          <div className={list.toolbarLeft}>
            <label className={list.search}>
              <IconSearch /><span className="sr-only">Search testimonials</span>
              <input type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search name, company or quote" />
              {search && <button type="button" className={list.clearSearch} onClick={() => setSearch('')} aria-label="Clear search"><IconClose /></button>}
            </label>
          </div>
          <div className={list.results}>
            {items && <span>{filtered.length ? `Showing ${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, filtered.length)} of ${filtered.length}` : 'No results'}</span>}
            {hasFilters && <button type="button" className={list.clearFilters} onClick={() => { setSearch(''); setTab('all'); }}><IconClose /> Clear filters</button>}
          </div>
        </div>

        {error && !items ? (
          <div className={list.state} role="alert"><span className={`${list.stateIcon} ${list.errorIcon}`}><IconAlert /></span><h3>Couldn’t load testimonials</h3><p>{error}</p><button type="button" className={list.stateAction} onClick={() => { setError(null); setAttempt((n) => n + 1); }}>Try again</button></div>
        ) : !items ? (
          <div className={list.skeleton} role="status" aria-label="Loading testimonials"><span /><span /><span /></div>
        ) : filtered.length === 0 ? (
          <div className={list.state}>
            <span className={list.stateIcon}><IconQuote /></span>
            <h3>{hasFilters ? 'No testimonials match this view' : 'No testimonials yet'}</h3>
            <p>{hasFilters ? 'Try another search or tab.' : 'Until you add one, the site shows its built-in default card.'}</p>
            {hasFilters ? <button type="button" className={list.stateLink} onClick={() => { setSearch(''); setTab('all'); }}>Clear filters</button> : <button type="button" className={list.stateAction} onClick={openCreate}>Add testimonial</button>}
          </div>
        ) : (
          <>
            <div className={list.tableWrap}>
              <table className={list.table}>
                <caption className="sr-only">Testimonials in display order</caption>
                <thead><tr><th scope="col">Person</th><th scope="col">Quote</th><th scope="col">Order</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {shown.map((t) => {
                    const idx = sorted.findIndex((x) => x._id === t._id);
                    const locked = busy.has(t._id);
                    const preview = plainText(t.quote);
                    return (
                      <tr key={t._id} onClick={(e) => onRowClick(e, t)}>
                        <td>
                          <div className="flex items-center gap-3">
                            <Avatar t={t} />
                            <div className="min-w-0"><span className={list.primary}>{t.name}</span>{t.company && <span className={list.sub}>{t.company}</span>}</div>
                          </div>
                        </td>
                        <td>{preview ? <span className={list.reason}>{preview}</span> : <span className="text-[#8a939b]">No quote yet</span>}</td>
                        <td>
                          <div className="inline-flex items-center gap-1" aria-label={`Position ${idx + 1} of ${sorted.length}`}>
                            <button type="button" className={list.openLink} style={{ margin: 0, width: 28, height: 28 }} disabled={locked || idx === 0} onClick={() => move(t, -1)} aria-label="Move up"><IconUp /></button>
                            <span className="w-7 text-center tabular-nums">{idx + 1}</span>
                            <button type="button" className={list.openLink} style={{ margin: 0, width: 28, height: 28 }} disabled={locked || idx === sorted.length - 1} onClick={() => move(t, 1)} aria-label="Move down"><IconDown /></button>
                          </div>
                        </td>
                        <td><span className="inline-flex items-center gap-2"><AdminSwitch isSelected={t.isActive} onValueChange={(v) => togglePublished(t, v)} aria-label={`${t.name} published`} /><StatusChip status={t.isActive ? 'published' : 'draft'} /></span></td>
                        <td>
                          <div className="flex items-center justify-end gap-1.5">
                            <RowActions ariaLabel={`More actions for ${t.name}`} items={[{ key: 'delete', label: 'Delete testimonial…', tone: 'danger', onSelect: () => remove(t) }]} />
                            <button type="button" className={list.openLink} onClick={() => openEdit(t)} aria-label={`Edit ${t.name}`} title="Edit"><IconArrow /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className={list.cards}>
              {shown.map((t) => (
                <button key={t._id} type="button" className={`${list.card} w-full text-left`} onClick={() => openEdit(t)}>
                  <div className={list.cardTop}>
                    <div className="flex items-center gap-3 min-w-0"><Avatar t={t} /><div className="min-w-0"><span className={list.primary}>{t.name}</span><span className={list.sub}>{t.company || plainText(t.quote)}</span></div></div>
                    <StatusChip status={t.isActive ? 'published' : 'draft'} />
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

      {/* Create / edit — TestimonialForm owns the save and its own sticky action bar. */}
      <Modal isOpen={!!editor} onClose={() => setEditor(null)} placement="center" size="3xl" scrollBehavior="inside" hideCloseButton classNames={{ base: modal.modal, backdrop: modal.backdrop }}>
        <ModalContent>
          {editor && (
            <>
              <ModalHeader className={modal.header}>
                <span className={`${modal.icon} ${modal.info}`}><IconQuote /></span>
                <div className="min-w-0 flex-1">
                  <div className={modal.eyebrow}>{editor.mode === 'create' ? 'New testimonial' : 'Edit testimonial'}</div>
                  <div className={modal.title}>{editor.mode === 'create' ? 'Add a seller story' : editor.initial.name || 'Testimonial'}</div>
                  <div className={modal.sub}>Name, company and the quote as it should read on the site. Keep it a few sentences.</div>
                </div>
                <button type="button" className={modal.close} onClick={() => setEditor(null)} aria-label="Close"><IconClose /></button>
              </ModalHeader>
              <ModalBody className={`${modal.body} pb-6`}>
                <TestimonialForm key={editor.id || 'create'} mode={editor.mode} initial={editor.initial} testimonialId={editor.id} onCancel={() => setEditor(null)} onSaved={() => { setEditor(null); void load(); }} actionsPortal={footerEl} />
              </ModalBody>
              <ModalFooter ref={setFooterEl} className={modal.footer} />
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

function Avatar({ t }: { t: Testimonial }) {
  return t.avatar
    // eslint-disable-next-line @next/next/no-img-element
    ? <img alt="" className="h-9 w-9 flex-none rounded-full border border-[#edf0f2] object-cover" src={imageUrl(t.avatar)} />
    : <span aria-hidden className="grid h-9 w-9 flex-none place-items-center rounded-full bg-[#191d21] text-[11px] font-semibold text-[#bdff00]">{initials(t.name)}</span>;
}

const svg = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
function IconArrow({ flip }: { flip?: boolean }) { return <svg {...svg} width="14" height="14" style={flip ? { transform: 'scaleX(-1)' } : undefined}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></svg>; }
function IconUp() { return <svg {...svg} width="13" height="13"><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></svg>; }
function IconDown() { return <svg {...svg} width="13" height="13"><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></svg>; }
function IconPlus() { return <svg {...svg} width="14" height="14"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>; }
function IconSearch() { return <svg {...svg}><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>; }
function IconClose() { return <svg {...svg} width="12" height="12"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>; }
function IconAlert() { return <svg {...svg}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>; }
function IconQuote() { return <svg {...svg}><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.76-2-2-2H4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .01-1 1.03V20c0 1 0 1 1 1z" /><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.76-2-2-2h-4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .01-1 1.03V20c0 1 0 1 1 1z" /></svg>; }
