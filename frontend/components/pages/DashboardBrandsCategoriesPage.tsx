'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardBody, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure } from '@heroui/react';
import Button from '@/components/common/SellerButton';
import {
  FilterTabs,
  RowActions,
  StatusChip,
  type DataTableColumn,
} from '@/components/ui';
import { formatDate } from '@/lib/dates';
import { api, imageUrl, unwrap, envelopeOrLegacy } from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import { useKycStatus } from '@/lib/kyc';
import Link from 'next/link';
import SellerSelect from '@/components/common/SellerSelect';
import styles from './DashboardBrandsCategories.module.css';
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';

type CategoryNode = {
  _id: string;
  name: string;
  slug?: string;
  parent?: string | null;
  children: CategoryNode[];
};

type FlatCategory = { _id: string; name: string; depth: number; path: string };

type Brand = {
  _id: string;
  name: string;
  slug?: string;
  logo?: string;
  isActive: boolean;
};

type RequestType = 'brand' | 'category';

type MyRequest = {
  _id: string;
  type: RequestType;
  name: string;
  notes?: string;
  status: 'pending' | 'approved' | 'rejected';
  decisionNote?: string;
  parentCategory?: { _id: string; name: string; slug?: string } | null;
  createdAt: string;
};

function flatten(tree: CategoryNode[], depth = 0, ancestors: string[] = []): FlatCategory[] {
  const out: FlatCategory[] = [];
  for (const node of tree) {
    out.push({ _id: node._id, name: node.name, depth, path: ancestors.join(' / ') });
    if (node.children?.length) {
      out.push(...flatten(node.children, depth + 1, [...ancestors, node.name]));
    }
  }
  return out;
}

export default function DashboardBrandsCategoriesPage() {
  const [tree, setTree] = useState<CategoryNode[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);

  // Brand/category requests are gated behind KYC approval. Until KYC is
  // approved the seller can browse the existing catalog but the
  // "request" CTAs are replaced with a banner pointing them at KYC.
  const { kyc } = useKycStatus();
  const canRequest = kyc.status === 'approved';

  /* UX audit S9: three tabs — Categories · Brands · My requests — instead
     of two side-by-side scrolling panes under a four-tile KPI strip. */
  type View = 'categories' | 'brands' | 'mine';
  const [view, setView] = useState<View>('categories');
  const [myRequests, setMyRequests] = useState<MyRequest[]>([]);
  const [mineLoading, setMineLoading] = useState(false);

  /* One search box; it filters whichever tab is open. */
  const [search, setSearch] = useState('');
  const [requestStatus, setRequestStatus] = useState('all');

  const requestModal = useDisclosure();
  const [requestType, setRequestType] = useState<RequestType>('brand');
  const [reqName, setReqName] = useState('');
  const [reqParent, setReqParent] = useState<string>('');
  const [reqNotes, setReqNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // When editing an existing request the id sits here. submitRequest()
  // looks at this to decide between POST (new) and PATCH (update).
  const [editingId, setEditingId] = useState<string | null>(null);
  // Tracks which request is being deleted so the per-row Delete button
  // can show its own loading state without freezing the whole list.
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const flatCategories = useMemo(() => flatten(tree), [tree]);

  async function loadBrowse() {
    setLoading(true);
    try {
      const [catRes, brandRes] = await Promise.all([
        api.get('/categories').then(envelopeOrLegacy),
        api.get('/brands', { params: { active: '1' } }).then(envelopeOrLegacy),
      ]);
      setTree(catRes.data.tree || []);
      setBrands(brandRes.data.items || []);
    } catch (e: any) {
      notifyError(e, M.brandsCategories.couldntLoadBrandsCategories);
    } finally {
      setLoading(false);
    }
  }

  async function loadMine() {
    setMineLoading(true);
    try {
      const data = unwrap<{ items?: any[] }>(await api.get('/seller/brand-category-requests'));
      setMyRequests(data.items || []);
    } catch (e: any) {
      notifyError(e, M.brandsCategories.couldntLoadYourRequests);
    } finally {
      setMineLoading(false);
    }
  }

  useEffect(() => {
    loadBrowse();
    // Pre-load my requests so the count badge on the "View my requests"
    // button is accurate on first paint, not just after the user clicks.
    loadMine();
  }, []);

  useEffect(() => {
    if (view === 'mine') loadMine();
  }, [view]);

  /* One "Request" button (UX audit S9). The type defaults from the open
     tab and can be switched inside the dialog. */
  function openRequest(type: RequestType = view === 'brands' ? 'brand' : 'category') {
    setEditingId(null);
    setRequestType(type);
    setReqName('');
    setReqParent('');
    setReqNotes('');
    requestModal.onOpen();
  }

  // Open the same modal pre-filled with an existing request's values.
  // The submitRequest path branches on `editingId` to call PATCH instead
  // of POST. Only pending rows reach this — completed ones don't render
  // an Edit button at all.
  function openEditRequest(r: MyRequest) {
    setEditingId(r._id);
    setRequestType(r.type);
    setReqName(r.name);
    setReqParent(r.parentCategory?._id || '');
    setReqNotes(r.notes || '');
    requestModal.onOpen();
  }

  async function deleteRequest(r: MyRequest) {
    const ok = await confirmDialog({
      title: 'Delete this request?',
      message: `"${r.name}" will be withdrawn before it is reviewed.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    setDeletingId(r._id);
    try {
      await api.delete(`/seller/brand-category-requests/${r._id}`);
      notifySuccess(M.brandsCategories.requestDeleted);
      // Optimistic local prune — avoids a flash of stale data.
      setMyRequests((prev) => prev.filter((x) => x._id !== r._id));
    } catch (e: any) {
      notifyError(e, M.brandsCategories.couldntDeleteTheRequest);
    } finally {
      setDeletingId(null);
    }
  }

  async function submitRequest() {
    if (reqName.trim().length < 2) {
      notifyWarning(M.brandsCategories.nameMustBeAtLeast2Characters);
      return;
    }
    setSubmitting(true);
    try {
      const body = {
        type: requestType,
        name: reqName.trim(),
        parentCategory: reqParent || null,
        notes: reqNotes.trim() || '',
      };
      if (editingId) {
        const { data } = await api.patch(
          `/seller/brand-category-requests/${editingId}`,
          body
        );
        notifySuccess(M.brandsCategories.requestUpdated);
        // Patch local cache in place so the row reflects the new values
        // without a full reload.
        setMyRequests((prev) =>
          prev.map((x) => (x._id === editingId ? { ...x, ...data.request } : x))
        );
      } else {
        await api.post('/seller/brand-category-requests', body);
        notifySuccess(M.brandsCategories.requestSentWellReviewItShortly);
        loadMine();
        setView('mine');
        setSearch('');
        setRequestStatus('all');
      }
      requestModal.onClose();
    } catch (e: any) {
      notifyError(e, M.brandsCategories.couldntSaveYourRequest);
    } finally {
      setSubmitting(false);
    }
  }

  const q = search.trim().toLowerCase();
  const filteredFlatCategories = useMemo(
    () => (q ? flatCategories.filter((c) => c.name.toLowerCase().includes(q)) : flatCategories),
    [flatCategories, q],
  );
  const filteredBrands = useMemo(
    () => [...(q ? brands.filter((b) => b.name.toLowerCase().includes(q)) : brands)].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })),
    [brands, q],
  );
  const brandGroups = useMemo(() => {
    const groups = new Map<string, Brand[]>();
    for (const brand of filteredBrands) {
      const first = brand.name.trim().charAt(0).toUpperCase();
      const letter = /^[A-Z]$/.test(first) ? first : '#';
      groups.set(letter, [...(groups.get(letter) || []), brand]);
    }
    return [...groups.entries()];
  }, [filteredBrands]);
  const filteredRequests = useMemo(
    () => myRequests.filter(r => (!q || r.name.toLowerCase().includes(q)) && (requestStatus === 'all' || r.status === requestStatus)),
    [myRequests, q, requestStatus],
  );


  const requestColumns: DataTableColumn<MyRequest>[] = [
    {
      id: 'request',
      header: 'Request',
      isRowHeader: true,
      cell: (r) => (
        <div className="min-w-0 max-w-md">
          <div className="text-sm font-medium text-foreground">{r.name}</div>
          {r.parentCategory && (
            <div className="mt-0.5 text-xs text-muted">
              {r.type === 'brand' ? 'Pair with' : 'Under'}:{' '}
              <span className="font-medium">{r.parentCategory.name}</span>
            </div>
          )}
          {r.notes && (
            <div className="mt-0.5 truncate text-xs text-muted" title={r.notes}>
              {r.notes}
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'type',
      header: 'Type',
      cell: (r) => <span className="text-sm text-foreground">{r.type === 'brand' ? 'Brand' : 'Category'}</span>,
    },
    {
      id: 'status',
      header: 'Status',
      cell: (r) => <StatusChip label={r.status === 'pending' ? 'Waiting for review' : r.status === 'approved' ? 'Added' : 'Declined'} status={r.status} />,
    },
    {
      id: 'feedback',
      header: 'Review feedback',
      cell: (r) => <div className={styles.reviewFeedback} data-declined={r.status === 'rejected'}>{r.decisionNote || (r.status === 'pending' ? 'Awaiting admin review' : r.status === 'approved' ? 'Available in the catalogue' : 'No review note provided')}</div>,
    },
    {
      id: 'requested',
      header: 'Requested',
      cell: (r) => <span className="whitespace-nowrap text-sm text-muted tabular-nums">{formatDate(r.createdAt)}</span>,
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      className: 'text-right',
      /* Only pending rows can change — once decided, the values are frozen
         so the audit trail stays consistent. */
      cell: (r) =>
        r.status === 'pending' ? (
          <RowActions
            ariaLabel={`More actions for ${r.name}`}
            items={[{ key: 'delete', label: 'Delete request…', tone: 'danger', busy: deletingId === r._id, busyLabel: 'Deleting…', onSelect: () => deleteRequest(r) }]}
            primary={{ label: 'Edit', onPress: () => openEditRequest(r) }}
          />
        ) : null,
    },
  ];

  const searchPlaceholder =
    view === 'categories' ? 'Search categories…' : view === 'brands' ? 'Search brands…' : 'Search your requests…';

  return (
    <div className={styles.page}>
      <h1 className="sr-only">Brands &amp; categories</h1>
      {!canRequest && <div className={styles.notice}>
        {kyc.status === 'pending' ? 'Your verification is under review. You can browse the catalogue while you wait.' : 'Browse the catalogue below. Complete verification to request a new brand or category.'}
      </div>}
      <section className={styles.workspace} aria-label="Brands and categories">
        <div className={styles.tabs}><FilterTabs ariaLabel="Brands and categories sections"
          actions={canRequest ? <Button className={styles.primary} onPress={() => openRequest()}>+ New request</Button> : <Link className={styles.secondary} href="/dashboard/kyc">{kyc.status === 'pending' ? 'Verification under review' : 'Verify to request'}</Link>}
          onChange={id => { setView(id as View); setSearch(''); }} value={view}
          tabs={[
            {id:'categories',label:'Categories',count:loading ? undefined : flatCategories.length},
            {id:'brands',label:'Brands',count:loading ? undefined : brands.length},
            {id:'mine',label:'My requests',count:mineLoading ? undefined : myRequests.length},
          ]} /></div>
        <div className={styles.toolbar}>
          <label className={styles.search}><span className="sr-only">{searchPlaceholder}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>
            <input type="search" placeholder={searchPlaceholder} value={search} onChange={event => setSearch(event.target.value)} />
          </label>
          {view === 'mine' && <div className={styles.statusFilter}><SellerSelect ariaLabel="Request status" fullWidth value={requestStatus} onChange={setRequestStatus} options={[{value:'all',label:'All statuses'},{value:'pending',label:'Waiting for review'},{value:'approved',label:'Added'},{value:'rejected',label:'Declined'}]} /></div>}
          {(search || (view === 'mine' && requestStatus !== 'all')) && <button type="button" className={styles.secondary} onClick={() => { setSearch(''); setRequestStatus('all'); }}>Clear filters</button>}
          <span className={styles.resultCount}>{(view === 'mine' ? mineLoading : loading) ? 'Loading…' : `${view === 'categories' ? filteredFlatCategories.length : view === 'brands' ? filteredBrands.length : filteredRequests.length} ${view === 'categories' ? (filteredFlatCategories.length === 1 ? 'category' : 'categories') : view === 'brands' ? (filteredBrands.length === 1 ? 'brand' : 'brands') : (filteredRequests.length === 1 ? 'request' : 'requests')}`}</span>
        </div>
        <p className={styles.browseHint}>{view === 'categories' ? 'Expand a category to explore its subcategories. Search to find a specific name.' : view === 'brands' ? 'Available brands for your product listings. Missing one? Send a new request.' : 'Track review decisions here. You can edit or withdraw pending requests.'}</p>
      {view !== 'mine' && loading && (
        <div aria-hidden className="skeleton--shimmer relative overflow-hidden rounded-2xl border border-border bg-surface p-4">
          <div className="space-y-2.5">
            {Array.from({ length: 8 }).map((_, r) => (
              <div key={r} className="h-3.5 rounded bg-surface-secondary" style={{ width: `${88 - (r % 4) * 12}%` }} />
            ))}
          </div>
        </div>
      )}

      {/* CATEGORIES — the tree, or a flat match list while searching so
          nobody has to expand every parent to find a name. */}
      {view === 'categories' && !loading && (
        <Card className={styles.contentCard}>
          <CardBody className={styles.categoryBody}>
            {tree.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted">No categories yet</div>
            ) : q ? (
              filteredFlatCategories.length === 0 ? (
                <div className="py-10 text-center text-sm text-muted">No categories match &ldquo;{search.trim()}&rdquo;</div>
              ) : (
                <div className={styles.matchGrid}>
                  {filteredFlatCategories.map((c) => (
                    <div
                      key={c._id}
                      className={styles.categoryMatch}

                    >
                      <span>{c.name}</span>
                      <small>{c.path || 'Top-level category'}</small>
                    </div>
                  ))}
                </div>
              )
            ) : (
              <div className={styles.categoryGrid}>
                {tree.map((node) => (
                  <CategoryTreeNode key={node._id} node={node} depth={0} />
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* BRANDS */}
      {view === 'brands' && !loading && (
        <Card className={styles.contentCard}>
          <CardBody className={styles.brandBody}>
            {filteredBrands.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted">
                {q ? `No brands match “${search.trim()}”` : 'No brands yet'}
              </div>
            ) : (
              <div className={styles.brandGroups}>
                {brandGroups.map(([letter, group]) => <section key={letter} aria-label={`Brands: ${letter}`} className={styles.brandGroup}>
                  <h2 className={styles.brandLetter}>{letter}<span>{group.length}</span></h2>
                  <div className={styles.brandGrid}>
                {group.map((b) => (
                  <div
                    key={b._id}
                    className={styles.brandTile}
                  >
                    <div className={styles.brandLogo}>
                      {b.logo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={imageUrl(b.logo)} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />
                      ) : (
                        <div className={styles.brandInitials} aria-hidden="true">
                          {b.name.slice(0, 2).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className={styles.brandName}>{b.name}</div>
                  </div>
                ))}
                  </div>
                </section>)}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* MY REQUESTS */}
      {view === 'mine' && (
        <div className={styles.requests}>
          {mineLoading ? <div className={styles.empty} role="status">Loading your requests…</div>
            : filteredRequests.length === 0 ? <div className={styles.empty}><h3>{q || requestStatus !== 'all' ? 'No matching requests' : 'No requests yet'}</h3><p>{q || requestStatus !== 'all' ? 'Try a different name or clear your filters.' : canRequest ? 'Request a missing brand or category using New request.' : 'You can send requests once verification is approved.'}</p></div>
            : <><div className={styles.tableScroll}><table className={styles.table} aria-label="My brand and category requests">
              <thead><tr>{requestColumns.map(column => <th scope="col" key={column.id}>{column.header}</th>)}</tr></thead>
              <tbody>{filteredRequests.map(request => <tr key={request._id}>{requestColumns.map(column => column.isRowHeader ? <th scope="row" key={column.id}>{column.cell(request)}</th> : <td key={column.id} data-column={column.id} data-label={column.id === 'actions' ? 'Actions' : String(column.header)}>{column.cell(request)}</td>)}</tr>)}</tbody>
            </table></div></>}
        </div>
      )}

      </section>

      {/* REQUEST DIALOG — one entry point; the type is picked here. */}
      <Modal
        isOpen={requestModal.isOpen}
        onClose={requestModal.onClose}
        placement="center"
        size="lg"
        scrollBehavior="inside"
      >
        <ModalContent className={styles.modal}>
          <ModalHeader>{editingId ? 'Edit request' : 'Request a brand or category'}</ModalHeader>
          <ModalBody className="flex flex-col gap-4">
            {!editingId && (
              <div role="radiogroup" aria-label="What are you requesting?" className="flex gap-2">
                {(['brand', 'category'] as RequestType[]).map((t) => (
                  <label key={t} className={styles.typeChoice} data-selected={requestType === t}>
                    <input type="radio" name="request-type" value={t} checked={requestType === t} onChange={() => { setRequestType(t); setReqParent(''); }} />
                    {t === 'brand' ? 'A brand' : 'A category'}
                  </label>
                ))}
              </div>
            )}
            <label className={styles.field}>
              <span>{requestType === 'brand' ? 'Brand name' : 'Category name'} <span aria-hidden="true">*</span></span>
              <input required autoFocus value={reqName} onChange={event => setReqName(event.target.value)} placeholder={requestType === 'brand' ? 'e.g. Rynox' : 'e.g. Riding gloves'} />
            </label>
            {requestType === 'category' && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted">Goes under (leave blank for top level)</label>
                <SellerSelect ariaLabel="Parent category" fullWidth value={reqParent} onChange={setReqParent} options={[{ value: '', label: '— Top level —' }, ...flatCategories.map(category => ({ value: category._id, label: `${'  '.repeat(category.depth)}${category.depth > 0 ? '↳ ' : ''}${category.name}` }))]} />
              </div>
            )}
            <label className={styles.field}><span>Notes <small>(optional)</small></span>
              <textarea rows={3} placeholder={requestType === 'brand' ? 'Add the official website, logo link or a little context.' : 'Tell us which products belong in this category.'} value={reqNotes} onChange={event => setReqNotes(event.target.value)} />
            </label>
            <p className={styles.formHint}>We review each request before adding it to the shared catalogue.</p>
          </ModalBody>
          <ModalFooter>
            <Button className={styles.secondary} onPress={requestModal.onClose}>Cancel</Button>
            <Button className={styles.primary} isLoading={submitting} onPress={submitRequest}>
              {editingId ? 'Save changes' : 'Send request'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

/* ───────────── Recursive category accordion ─────────────
   Each node renders as a clickable header. If the node has children,
   clicking it toggles a chevron and reveals the children indented
   below — children are themselves CategoryTreeNodes, so nesting works
   to any depth. Leaf nodes (no children) render as a plain row. */
function CategoryTreeNode({
  node,
  depth = 0,
}: {
  node: CategoryNode;
  depth?: number;
}) {
  const [open, setOpen] = useState(false);
  const hasChildren = Array.isArray(node.children) && node.children.length > 0;

  return (
    <div className={depth === 0 ? styles.categoryGroup : undefined} data-open={open}>
      <button
        type="button"
        onClick={() => hasChildren && setOpen((o) => !o)}
        className={styles.categoryRow}
        aria-expanded={hasChildren ? open : undefined}
        disabled={!hasChildren}
      >
        {hasChildren ? (
          <ChevronRightIcon
            className={`w-3.5 h-3.5 text-muted shrink-0 transition-transform ${
              open ? 'rotate-90 text-foreground' : ''
            }`}
          />
        ) : (
          <span className="w-3.5 h-3.5 shrink-0 grid place-items-center text-muted text-xs">
            •
          </span>
        )}
        <span
          className={`text-sm flex-1 truncate ${
            hasChildren ? 'font-semibold text-foreground' : 'text-foreground'
          }`}
        >
          {node.name}
        </span>
        {hasChildren && (
          <span
            className={`text-xs tabular-nums px-1.5 py-0.5 rounded ${
              open ? 'bg-slate-100 text-slate-700' : 'bg-slate-50 text-slate-500'
            }`}
          >
            {node.children.length} {depth === 0 ? (node.children.length === 1 ? 'subcategory' : 'subcategories') : ''}
          </span>
        )}
      </button>

      {hasChildren && open && (
        <div className={styles.children}>
          {node.children.map((child) => (
            <CategoryTreeNode key={child._id} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function ChevronRightIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <polyline points="9 6 15 12 9 18" />
    </svg>
  );
}

