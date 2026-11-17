'use client';

/**
 * Admin — brand & category requests from sellers, in the workspace queue
 * layout (same family as the KYC queue): tabs with counts (Pending /
 * Approved / Rejected / All), one entry per request with who asked, what
 * for and their note, and Approve / Reject on pending ones.
 *
 * Approve opens a pre-filled create form (the admin may flip a "brand"
 * request into a category, or the other way round); reject needs a reason
 * the seller sees. Every state is loaded once and the tabs filter here, so
 * counts always match.
 *
 * Data unchanged: GET /admin/brand-category-requests?status=all,
 * POST …/:id/approve { createdResourceId }, POST …/:id/reject { decisionNote },
 * POST /brands, POST /categories, GET /categories (parent picker).
 */
import { useEffect, useMemo, useState } from 'react';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import AdminSwitch from '@/components/AdminSwitch';
import AdminButton from '@/components/AdminButton';
import AdminInput from '@/components/AdminInput';
import AdminSelect from '@/components/AdminSelect';
import AdminTextarea from '@/components/AdminTextarea';
import ImageSlot from '@/components/media/ImageSlot';
import ModuleTabs from '@/components/ModuleTabs';
import { StatusChip } from '@/components/ui';
import { IconButton, IconTrash } from '@/components/EditorShell';
import { api, unwrap, envelopeOrLegacy } from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import { formatDate, formatDateTime } from '@/lib/dates';
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';
import list from '@/components/WorkspaceList.module.css';
import modal from '@/components/AdminModal.module.css';
import form from '@/components/AdminForm.module.css';
import queue from '@/app/sellers/sellers.module.css';

type Status = 'pending' | 'approved' | 'rejected';
type ReqType = 'brand' | 'category';
type RequestRow = {
  _id: string; type: ReqType; name: string; notes?: string; status: Status; decisionNote?: string; decidedAt?: string | null; createdAt: string;
  seller?: { _id: string; slug?: string; name?: string; storeName?: string; email?: string } | null;
  parentCategory?: { _id: string; name: string; slug?: string } | null;
};
type CategoryNode = { _id: string; name: string; children: CategoryNode[] };
type Tab = Status | 'all';
const TABS: [Tab, string][] = [['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['all', 'All']];

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
const flatten = (tree: CategoryNode[], depth = 0): { _id: string; name: string; depth: number }[] => tree.flatMap((n) => [{ _id: n._id, name: n.name, depth }, ...flatten(n.children || [], depth + 1)]);
const daysSince = (iso?: string) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 86400000) : 0);
const initials = (name: string) => (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();

type BrandForm = { name: string; slug: string; logo: string; description: string; isActive: boolean; order: number };
type CategoryForm = { name: string; slug: string; description: string; parent: string; icon: string; order: number; isActive: boolean };

export default function BrandRequestsPage() {
  const [items, setItems] = useState<RequestRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<Tab>('pending');
  const [categoryTree, setCategoryTree] = useState<CategoryNode[]>([]);
  const flatCategories = useMemo(() => flatten(categoryTree), [categoryTree]);

  const load = () => api.get('/admin/brand-category-requests', { params: { status: 'all' } })
    .then((r) => { setItems(unwrap<{ items?: any[] }>(r).items || []); setError(null); })
    .catch((e) => setError(e?.response?.status >= 500 || !e?.response ? 'Requests are unavailable right now.' : 'Requests couldn’t be loaded.'));
  useEffect(() => { void load(); }, [attempt]);
  useEffect(() => { api.get('/categories').then(envelopeOrLegacy).then(({ data }) => setCategoryTree(data.tree || [])).catch(() => { /* the parent picker just stays empty */ }); }, []);

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { pending: 0, approved: 0, rejected: 0, all: 0 };
    for (const r of items || []) { c[r.status] += 1; c.all += 1; }
    return c;
  }, [items]);
  const shown = useMemo(() => (items || []).filter((r) => tab === 'all' || r.status === tab), [items, tab]);
  const oldest = (items || []).filter((r) => r.status === 'pending').reduce((m, r) => Math.max(m, daysSince(r.createdAt)), 0);

  // ── Approve ──
  const [approving, setApproving] = useState<RequestRow | null>(null);
  const [createAs, setCreateAs] = useState<ReqType>('brand');
  const [brandForm, setBrandForm] = useState<BrandForm>({ name: '', slug: '', logo: '', description: '', isActive: true, order: 0 });
  const [categoryForm, setCategoryForm] = useState<CategoryForm>({ name: '', slug: '', description: '', parent: '', icon: '', order: 0, isActive: true });
  const [savingApprove, setSavingApprove] = useState(false);
  function openApprove(row: RequestRow) {
    setApproving(row); setCreateAs(row.type);
    setBrandForm({ name: row.name, slug: '', logo: '', description: row.notes || '', isActive: true, order: 0 });
    setCategoryForm({ name: row.name, slug: '', description: row.notes || '', parent: row.parentCategory?._id || '', icon: '', order: 0, isActive: true });
  }
  async function submitApprove() {
    if (!approving) return;
    const name = createAs === 'brand' ? brandForm.name : categoryForm.name;
    if (!name.trim()) { notifyWarning(createAs === 'brand' ? M.brandRequests.brandNameIsRequired : M.brandRequests.categoryNameIsRequired); return; }
    setSavingApprove(true);
    try {
      let createdId: string;
      if (createAs === 'brand') { const { data } = await api.post('/brands', brandForm).then(envelopeOrLegacy); createdId = data.brand._id; }
      else { const { data } = await api.post('/categories', { ...categoryForm, parent: categoryForm.parent || null }).then(envelopeOrLegacy); createdId = data.category._id; }
      await api.post(`/admin/brand-category-requests/${approving._id}/approve`, { createdResourceId: createdId });
      notifySuccess(M.brandRequests.approvedCreated(createAs));
      setApproving(null); await load();
    } catch (e: any) { notifyError(e, M.brandRequests.couldntApprove); }
    finally { setSavingApprove(false); }
  }

  // ── Delete (clears a row from the queue) ──
  async function remove(r: RequestRow) {
    const ok = await confirmDialog({
      title: `Delete the request for “${r.name}”?`,
      message: r.status === 'pending'
        ? 'The seller never gets an answer — they can ask again. If you want them told, reject it with a reason instead.'
        : r.status === 'approved'
          ? `The ${r.type} that was created stays; only this request row goes.`
          : 'This clears the row from the list. The seller keeps the rejection they already saw.',
      destructive: true,
      confirmLabel: 'Delete request',
    });
    if (!ok) return;
    try {
      await api.delete(`/admin/brand-category-requests/${r._id}`);
      notifySuccess(M.brandRequests.requestDeleted);
      await load();
    } catch (e: any) { notifyError(e, M.brandRequests.couldntDelete); }
  }

  // ── Reject ──
  const [rejecting, setRejecting] = useState<RequestRow | null>(null);
  const [reason, setReason] = useState('');
  const [savingReject, setSavingReject] = useState(false);
  async function submitReject() {
    if (!rejecting) return;
    if (reason.trim().length < 5) { notifyWarning(M.brandRequests.reasonMustBeAtLeast5Characters); return; }
    setSavingReject(true);
    try {
      await api.post(`/admin/brand-category-requests/${rejecting._id}/reject`, { decisionNote: reason.trim() });
      notifySuccess(M.brandRequests.requestRejected);
      setRejecting(null); setReason(''); await load();
    } catch (e: any) { notifyError(e, M.brandRequests.couldntReject); }
    finally { setSavingReject(false); }
  }

  return (
    <div className={list.page}>
      <ModuleTabs moduleKey="brands" />
      <section className={list.workspace} aria-labelledby="requests-heading">
        <div className={list.listHeader}>
          <div>
            <h2 id="requests-heading">
              Brand &amp; category requests <span className={list.count}>{items ? counts.pending : '…'}</span>
              {items && oldest >= 2 && <span className={queue.oldest}>Oldest waiting {oldest}d</span>}
            </h2>
            <p>Sellers ask here when a brand or category they need is missing. Approving creates it and tells the seller; rejecting needs a reason they’ll see.</p>
          </div>
        </div>
        <div className={list.stageFilters} role="group" aria-label="Filter requests">
          {TABS.map(([id, label]) => <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>{label}<span>{items ? counts[id] : '…'}</span></button>)}
        </div>

        {error && !items ? (
          <div className={list.state} role="alert"><span className={`${list.stateIcon} ${list.errorIcon}`}><IconAlert /></span><h3>Couldn’t load requests</h3><p>{error}</p><button type="button" className={list.stateAction} onClick={() => { setError(null); setAttempt((n) => n + 1); }}>Try again</button></div>
        ) : !items ? (
          <div className={list.skeleton} role="status" aria-label="Loading requests"><span style={{ height: 110 }} /><span style={{ height: 110 }} /></div>
        ) : shown.length === 0 ? (
          <div className={list.state}>
            <span className={list.stateIcon}><IconCheck /></span>
            <h3>{tab === 'pending' ? 'All caught up' : `No ${tab === 'all' ? '' : tab + ' '}requests`}</h3>
            <p>{tab === 'pending' ? 'New brand or category requests from sellers appear here.' : 'Nothing with this status yet.'}</p>
          </div>
        ) : (
          <div className={queue.queue} style={{ paddingTop: 18 }}>
            {shown.map((r) => {
              const waited = daysSince(r.createdAt);
              const aged = r.status === 'pending' && waited >= 2;
              const who = r.seller?.storeName || r.seller?.name || 'Unknown seller';
              return (
                <article key={r._id} className={`${queue.entry} ${aged ? queue.entryAged : ''}`} aria-label={`${r.type} request: ${r.name}`}>
                  <div className={queue.entryHead}>
                    <span className={queue.avatar} aria-hidden>{initials(who)}</span>
                    <div className={queue.entryWho}>
                      <div className={queue.entryName}>
                        {r.name}
                        <span className={`${queue.tag} ${r.type === 'category' ? queue.tagInfo : ''}`}>{r.type === 'brand' ? 'New brand' : 'New category'}</span>
                        <StatusChip status={r.status} />
                        {aged && <span className={`${queue.tag} ${queue.tagWarn}`}>Waiting {waited}d</span>}
                      </div>
                      <p className={queue.entryMeta}>
                        Asked by {who}{r.seller?.email ? ` · ${r.seller.email}` : ''} · {formatDate(r.createdAt)}
                        {r.parentCategory && <> · {r.type === 'brand' ? 'suggested category' : 'under'} <strong className="font-medium text-[#39434c]">{r.parentCategory.name}</strong></>}
                        {r.status !== 'pending' && r.decidedAt && <> · decided {formatDateTime(r.decidedAt)}</>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {r.status === 'pending' && (
                        <>
                          <AdminButton variant="bordered" className="!border-[#f0c9c6] !text-[#b44848]" onPress={() => { setRejecting(r); setReason(''); }}>Reject</AdminButton>
                          <AdminButton color="primary" onPress={() => openApprove(r)}>Approve…</AdminButton>
                        </>
                      )}
                      <IconButton label={`Delete the request for ${r.name}`} danger onClick={() => remove(r)}><IconTrash /></IconButton>
                    </div>
                  </div>
                  {(r.notes || (r.status === 'rejected' && r.decisionNote)) && (
                    <div className="px-4 py-3 text-[12px] leading-relaxed text-[#39434c]">
                      {r.notes && <p className="whitespace-pre-wrap"><span className="text-[#74808a]">Seller’s note:</span> {r.notes}</p>}
                      {r.status === 'rejected' && r.decisionNote && <p className="mt-1.5 text-[#a3413b]"><span className="font-semibold">Rejected:</span> {r.decisionNote}</p>}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Approve → create */}
      <Modal isOpen={!!approving} onClose={() => !savingApprove && setApproving(null)} placement="center" size="2xl" scrollBehavior="inside" hideCloseButton classNames={{ base: modal.modal, backdrop: modal.backdrop }}>
        <ModalContent>
          {approving && (
            <>
              <ModalHeader className={modal.header}>
                <span className={`${modal.icon} ${modal.positive}`}><IconCheckCircle /></span>
                <div className="min-w-0 flex-1">
                  <div className={modal.eyebrow}>Approve request</div>
                  <div className={modal.title}>Create “{approving.name}”</div>
                  <div className={modal.sub}>The {createAs} is created right away and the seller is told. Check the name and slug — they’re what the storefront shows.</div>
                </div>
                <button type="button" className={modal.close} onClick={() => setApproving(null)} disabled={savingApprove} aria-label="Close"><IconClose /></button>
              </ModalHeader>
              <ModalBody className={modal.body}>
                <div>
                  <div className={form.label}>Create as</div>
                  <div className={form.segment} role="group" aria-label="Create as">
                    <button type="button" aria-pressed={createAs === 'brand'} onClick={() => setCreateAs('brand')}>Brand</button>
                    <button type="button" aria-pressed={createAs === 'category'} onClick={() => setCreateAs('category')}>Category</button>
                  </div>
                  <p className={form.help}>
                    {approving.type !== createAs
                      ? <span className="text-[#8a5a12]">The seller asked for a {approving.type}; you’re creating a {createAs} instead.</span>
                      : createAs === 'brand' ? 'A global brand sellers can tag products with.' : 'A category in the storefront tree — pick where it sits.'}
                  </p>
                </div>
                {createAs === 'brand' ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <AdminInput label="Name" isRequired variant="bordered" value={brandForm.name} onChange={(e) => setBrandForm({ ...brandForm, name: e.target.value })} autoFocus />
                    <AdminInput label="Slug" variant="bordered" value={brandForm.slug} onChange={(e) => setBrandForm({ ...brandForm, slug: e.target.value })} placeholder={brandForm.name ? slugify(brandForm.name) : 'made from the name'} description="Leave blank to make one from the name." />
                    <div className="sm:col-span-2"><AdminTextarea label="Description" variant="bordered" minRows={2} value={brandForm.description} onChange={(e) => setBrandForm({ ...brandForm, description: e.target.value })} /></div>
                    <div className="sm:col-span-2"><div className={form.label}>Logo (optional)</div><div className={form.upload}><ImageSlot label="" aspect="aspect-square" fit="contain" hint="No logo" value={brandForm.logo} onChange={(url) => setBrandForm((f) => ({ ...f, logo: url }))} uploadEndpoint="/brands/upload-logo" uploadField="logo" acceptedTypes="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" /></div></div>
                    <div className={`${form.toggleRow} sm:col-span-2`} style={{ borderTop: 0, padding: 0 }}><div><strong>Active</strong><span>Sellers can pick it straight away.</span></div><AdminSwitch isSelected={brandForm.isActive} onValueChange={(v) => setBrandForm({ ...brandForm, isActive: v })} aria-label="Active" /></div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <AdminInput label="Name" isRequired variant="bordered" value={categoryForm.name} onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })} autoFocus />
                    <AdminInput label="Slug" variant="bordered" value={categoryForm.slug} onChange={(e) => setCategoryForm({ ...categoryForm, slug: e.target.value })} placeholder={categoryForm.name ? slugify(categoryForm.name) : 'made from the name'} description="Leave blank to make one from the name." />
                    <div className="sm:col-span-2">
                      <label className={form.label} htmlFor="req-parent">Parent category</label>
                      <AdminSelect id="req-parent" fullWidth ariaLabel="Parent category" value={categoryForm.parent} onChange={(v) => setCategoryForm({ ...categoryForm, parent: v })} options={[{ value: '', label: 'None — top level' }, ...flatCategories.map((c) => ({ value: c._id, label: `${'   '.repeat(c.depth)}${c.name}` }))]} />
                    </div>
                    <div className="sm:col-span-2"><AdminTextarea label="Description" variant="bordered" minRows={2} value={categoryForm.description} onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })} /></div>
                    <AdminInput label="Order" type="number" variant="bordered" value={String(categoryForm.order)} onChange={(e) => setCategoryForm({ ...categoryForm, order: Number(e.target.value) || 0 })} description="Lower numbers show first." />
                    <div className={form.toggleRow} style={{ borderTop: 0, padding: 0 }}><div><strong>Active</strong><span>Visible on the storefront.</span></div><AdminSwitch isSelected={categoryForm.isActive} onValueChange={(v) => setCategoryForm({ ...categoryForm, isActive: v })} aria-label="Active" /></div>
                  </div>
                )}
              </ModalBody>
              <ModalFooter className={modal.footer}>
                <AdminButton variant="bordered" onPress={() => setApproving(null)} isDisabled={savingApprove}>Cancel</AdminButton>
                <AdminButton color="primary" onPress={submitApprove} isLoading={savingApprove}>Create {createAs} &amp; approve</AdminButton>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Reject */}
      <Modal isOpen={!!rejecting} onClose={() => !savingReject && setRejecting(null)} placement="center" size="lg" hideCloseButton classNames={{ base: modal.modal, backdrop: modal.backdrop }}>
        <ModalContent>
          {rejecting && (
            <>
              <ModalHeader className={modal.header}>
                <span className={`${modal.icon} ${modal.danger}`}><IconXCircle /></span>
                <div className="min-w-0 flex-1">
                  <div className={modal.eyebrow}>Reject request</div>
                  <div className={modal.title}>Tell {rejecting.seller?.storeName || rejecting.seller?.name || 'the seller'} why</div>
                  <div className={modal.sub}>“{rejecting.name}” won’t be created. Your reason is shown to the seller.</div>
                </div>
                <button type="button" className={modal.close} onClick={() => setRejecting(null)} disabled={savingReject} aria-label="Close"><IconClose /></button>
              </ModalHeader>
              <ModalBody className={modal.body}>
                <AdminTextarea label="Reason" labelPlacement="outside" isRequired variant="bordered" minRows={4} maxLength={500} autoFocus placeholder="e.g. We already list this under Helmets → Full face. Use that instead." value={reason} onChange={(e) => setReason(e.target.value)} />
              </ModalBody>
              <ModalFooter className={modal.footer}>
                <AdminButton variant="bordered" onPress={() => setRejecting(null)} isDisabled={savingReject}>Cancel</AdminButton>
                <AdminButton color="danger" onPress={submitReject} isLoading={savingReject} isDisabled={reason.trim().length < 5}>Reject &amp; notify seller</AdminButton>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

const svg = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
function IconClose() { return <svg {...svg} width="14" height="14"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>; }
function IconAlert() { return <svg {...svg}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>; }
function IconCheck() { return <svg {...svg}><path d="M20 6 9 17l-5-5" /></svg>; }
function IconCheckCircle() { return <svg {...svg}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>; }
function IconXCircle() { return <svg {...svg}><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>; }
