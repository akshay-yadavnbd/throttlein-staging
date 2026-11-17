'use client';

/**
 * Redirects — `/pages/redirects`, in the workspace list layout: one
 * panel with All / Active / Off tabs, search, a table that turns into
 * cards on narrow panels, and a modal for create / edit.
 *
 * The storefront's edge middleware (`frontend/middleware.ts`) reads the
 * active rows and 301s matching paths before they hit Next routing, so
 * changes take effect within ~60s without a deploy. Rows are
 * per-property, so the list refetches when the site switcher moves.
 * Backed by /api/redirects.
 */

import { useEffect, useMemo, useState } from 'react';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import AdminSwitch from '@/components/AdminSwitch';
import AdminShell from '@/components/AdminShell';
import AdminButton from '@/components/AdminButton';
import AdminInput from '@/components/AdminInput';
import AdminSelect from '@/components/AdminSelect';
import ModuleTabs from '@/components/ModuleTabs';
import { RowActions, StatusChip } from '@/components/ui';
import { Field, IconClose, IconPlus, IconSearch } from '@/components/EditorShell';
import { api, unwrap } from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import { useActiveSite } from '@/lib/useActiveSite';
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';
import list from '@/components/WorkspaceList.module.css';
import form from '@/components/AdminForm.module.css';
import modal from '@/components/AdminModal.module.css';

type Redirect = {
  _id: string;
  source: string;
  destination: string;
  statusCode: 301 | 302;
  isActive: boolean;
  note?: string;
  hitCount?: number;
  lastHitAt?: string | null;
  updatedAt?: string;
};

type FormState = {
  source: string;
  destination: string;
  statusCode: 301 | 302;
  isActive: boolean;
  note: string;
};

const emptyForm: FormState = { source: '', destination: '', statusCode: 301, isActive: true, note: '' };
type Filter = 'all' | 'active' | 'off';
const PAGE_SIZE = 20;

export default function RedirectsPage() {
  const site = useActiveSite();
  const [items, setItems] = useState<Redirect[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editor, setEditor] = useState<{ id: string | null; draft: FormState } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = () => api.get('/redirects/admin')
    .then((r) => { setItems(unwrap<{ items?: any[] }>(r).items || []); setError(null); })
    .catch((e) => setError(e?.response?.status >= 500 || !e?.response ? 'Redirects are unavailable right now.' : 'Redirects couldn’t be loaded.'));
  useEffect(() => { void load(); }, [site, attempt]);

  const all = useMemo(() => items || [], [items]);
  const activeCount = all.filter((r) => r.isActive).length;
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((r) => (filter === 'all' || (filter === 'active') === r.isActive) && (!q || r.source.toLowerCase().includes(q) || r.destination.toLowerCase().includes(q) || (r.note || '').toLowerCase().includes(q)));
  }, [all, filter, search]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const shown = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function openCreate() { setEditor({ id: null, draft: emptyForm }); }
  function openEdit(r: Redirect) {
    setEditor({ id: r._id, draft: { source: r.source, destination: r.destination, statusCode: r.statusCode, isActive: r.isActive, note: r.note || '' } });
  }
  const set = (patch: Partial<FormState>) => setEditor((e) => (e ? { ...e, draft: { ...e.draft, ...patch } } : e));

  async function save() {
    if (!editor) return;
    if (!editor.draft.source.trim() || !editor.draft.destination.trim()) {
      notifyWarning(M.pages.bothSourceAndDestinationAreRequired);
      return;
    }
    setSaving(true);
    try {
      if (editor.id) {
        await api.put(`/redirects/${editor.id}`, editor.draft);
        notifySuccess(M.pages.redirectUpdated);
      } else {
        await api.post('/redirects', editor.draft);
        notifySuccess(M.pages.redirectCreated);
      }
      setEditor(null);
      void load();
    } catch (err: any) {
      notifyError(err, M.pages.couldntSave);
    } finally {
      setSaving(false);
    }
  }

  async function remove(r: Redirect) {
    const ok = await confirmDialog({
      title: 'Delete this redirect?',
      message: `${r.source} → ${r.destination} stops redirecting within a minute. This can’t be undone.`,
      confirmLabel: 'Delete redirect',
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/redirects/${r._id}`);
      notifySuccess(M.pages.redirectDeleted);
      void load();
    } catch (err: any) {
      notifyError(err, M.pages.couldntDelete);
    }
  }

  async function toggleActive(r: Redirect) {
    try {
      await api.put(`/redirects/${r._id}`, { isActive: !r.isActive });
      setItems((prev) => (prev || []).map((x) => (x._id === r._id ? { ...x, isActive: !r.isActive } : x)));
    } catch (err: any) {
      notifyError(err, M.pages.couldntUpdate);
    }
  }

  const onRowClick = (e: React.MouseEvent, r: Redirect) => { if ((e.target as HTMLElement).closest('a,button,label,input')) return; openEdit(r); };

  return (
    <AdminShell>
      <div className={list.page}>
        <ModuleTabs moduleKey="pages" />
        <section className={list.workspace} aria-labelledby="redirects-heading">
          <div className={list.listHeader}>
            <div>
              <h2 id="redirects-heading">Redirects <span className={list.count}>{items ? all.length : '…'}</span></h2>
              <p>Send old URLs to new ones without a deploy — the storefront picks changes up within a minute. Source paths start with / and match exactly; destinations can be paths or full URLs.</p>
            </div>
            <div className={list.headerActions}><AdminButton color="primary" onPress={openCreate}><IconPlus /> Add redirect</AdminButton></div>
          </div>
          <div className={list.stageFilters} role="group" aria-label="Filter redirects">
            {([['all', 'All', all.length], ['active', 'Active', activeCount], ['off', 'Off', all.length - activeCount]] as [Filter, string, number][]).map(([id, label, n]) => (
              <button key={id} type="button" aria-pressed={filter === id} onClick={() => { setFilter(id); setPage(1); }}>{label}<span>{items ? n : '…'}</span></button>
            ))}
          </div>
          <div className={list.toolbar}>
            <div className={list.toolbarLeft}>
              <label className={list.search}>
                <IconSearch /><span className="sr-only">Search redirects</span>
                <input type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search source, destination or note" />
                {search && <button type="button" className={list.clearSearch} onClick={() => setSearch('')} aria-label="Clear search"><IconClose /></button>}
              </label>
            </div>
            <div className={list.results}>{items && <span>{filtered.length ? `Showing ${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, filtered.length)} of ${filtered.length}` : 'No results'}</span>}</div>
          </div>

          {error && !items ? (
            <div className={list.state} role="alert"><h3>Couldn’t load redirects</h3><p>{error}</p><button type="button" className={list.stateAction} onClick={() => { setError(null); setAttempt((n) => n + 1); }}>Try again</button></div>
          ) : !items ? (
            <div className={list.skeleton} role="status" aria-label="Loading redirects"><span /><span /><span /></div>
          ) : filtered.length === 0 ? (
            <div className={list.state}>
              <h3>{search.trim() ? `No redirects match “${search.trim()}”` : filter !== 'all' ? 'No redirects in this filter' : 'No redirects yet'}</h3>
              <p>{search.trim() || filter !== 'all' ? 'Try another search or filter.' : 'Add one when a URL moves or an audit flags a 404.'}</p>
              {search.trim() || filter !== 'all' ? <button type="button" className={list.stateLink} onClick={() => { setSearch(''); setFilter('all'); }}>Clear filters</button> : <button type="button" className={list.stateAction} onClick={openCreate}>Add redirect</button>}
            </div>
          ) : (
            <>
              <div className={list.tableWrap}>
                <table className={list.table}>
                  <caption className="sr-only">Redirects</caption>
                  <thead><tr><th scope="col">From</th><th scope="col">To</th><th scope="col">Type</th><th scope="col">Hits</th><th scope="col">Active</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r._id} onClick={(e) => onRowClick(e, r)}>
                        <td style={{ maxWidth: 420 }}><span className={list.primary} style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 500, overflowWrap: 'anywhere' }}>{r.source}</span>{r.note && <span className={list.sub} title={r.note}>{r.note}</span>}</td>
                        <td><span className={list.sub} style={{ marginTop: 0, maxWidth: 360, color: '#39434c', fontFamily: 'ui-monospace, monospace' }} title={r.destination}>{r.destination}</span></td>
                        <td>
                          <span className="inline-flex items-center gap-2 whitespace-nowrap">
                            <StatusChip label={String(r.statusCode)} status={r.statusCode === 302 ? 'pending' : 'active'} />
                            <span className="text-[11px] text-[#8a939b]">{r.statusCode === 302 ? 'Temporary' : 'Permanent'}</span>
                          </span>
                        </td>
                        <td className="tabular-nums">{r.hitCount || 0}</td>
                        <td><AdminSwitch isSelected={r.isActive} onValueChange={() => toggleActive(r)} aria-label={`Redirect ${r.source} active`} /></td>
                        <td>
                          <div className="flex items-center justify-end gap-1.5">
                            <RowActions ariaLabel={`More actions for ${r.source}`} items={[
                              { key: 'edit', label: 'Edit…', onSelect: () => openEdit(r) },
                              { key: 'delete', label: 'Delete redirect…', tone: 'danger', onSelect: () => remove(r) },
                            ]} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={list.cards}>
                {shown.map((r) => (
                  <button key={r._id} type="button" className={`${list.card} w-full text-left`} onClick={() => openEdit(r)}>
                    <div className={list.cardTop}>
                      <div className="min-w-0"><span className={list.primary} style={{ fontFamily: 'ui-monospace, monospace' }}>{r.source}</span><span className={list.sub}>→ {r.destination}</span></div>
                      <StatusChip label={r.isActive ? 'Active' : 'Off'} status={r.isActive ? 'active' : 'inactive'} />
                    </div>
                  </button>
                ))}
              </div>
              {totalPages > 1 && (
                <div className={list.footer}>
                  <span>Page {safePage} of {totalPages}</span>
                  <div className={list.pager}>
                    <button type="button" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>Previous</button>
                    <button type="button" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>Next</button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>

        <Modal isOpen={!!editor} onClose={() => !saving && setEditor(null)} placement="center" size="lg" hideCloseButton classNames={{ base: modal.modal, backdrop: modal.backdrop }}>
          <ModalContent>
            {editor && (
              <>
                <ModalHeader className={modal.header}>
                  <span className={`${modal.icon} ${modal.info}`}><IconRedirect /></span>
                  <div className="min-w-0 flex-1">
                    <div className={modal.eyebrow}>{editor.id ? 'Edit redirect' : 'New redirect'}</div>
                    <div className={modal.title}>{editor.id ? editor.draft.source : 'Send one URL to another'}</div>
                    <div className={modal.sub}>Paths match exactly. Use a full URL for an off-site destination.</div>
                  </div>
                  <button type="button" className={modal.close} onClick={() => setEditor(null)} aria-label="Close" disabled={saving}><IconClose /></button>
                </ModalHeader>
                <ModalBody className={modal.body}>
                  <div className="grid grid-cols-1 gap-4">
                    <AdminInput label="From" isRequired placeholder="/helmets" value={editor.draft.source} onChange={(e) => set({ source: e.target.value })} description="Must start with /. Matched exactly against the request path." autoFocus />
                    <AdminInput label="To" isRequired placeholder="/helmets-and-accessories" value={editor.draft.destination} onChange={(e) => set({ destination: e.target.value })} description="A path, or a full https:// URL." />
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <Field label="Type" htmlFor="redirect-code">
                        <AdminSelect id="redirect-code" fullWidth ariaLabel="Type" value={String(editor.draft.statusCode)} onChange={(v) => set({ statusCode: Number(v) as 301 | 302 })} options={[{ value: '301', label: '301 — permanent (recommended)' }, { value: '302', label: '302 — temporary' }]} />
                      </Field>
                      <Field label="Active">
                        <div className={form.inlineSwitch}><strong>{editor.draft.isActive ? 'Redirecting' : 'Off — skipped'}</strong><AdminSwitch isSelected={editor.draft.isActive} onValueChange={(v) => set({ isActive: v })} aria-label="Active" /></div>
                      </Field>
                    </div>
                    <AdminInput label="Note" placeholder="Audit fix — flagged as a 404" value={editor.draft.note} onChange={(e) => set({ note: e.target.value })} description="For your own reference. Not shown publicly." />
                  </div>
                </ModalBody>
                <ModalFooter className={modal.footer}>
                  <AdminButton variant="bordered" onPress={() => setEditor(null)} isDisabled={saving}>Cancel</AdminButton>
                  <AdminButton color="primary" onPress={save} isLoading={saving}>{editor.id ? 'Save changes' : 'Add redirect'}</AdminButton>
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>
      </div>
    </AdminShell>
  );
}

function IconRedirect() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><polyline points="15 10 20 15 15 20" /><path d="M4 4v7a4 4 0 0 0 4 4h12" /></svg>; }
