'use client';

/**
 * Admin refund queue, in the workspace list layout (same family as Orders):
 * one panel with the money waiting in the header, status tabs with counts,
 * search, and a table that turns into cards when the panel is narrow.
 *
 * Refunds are raised by sellers (after verifying a returned parcel) or
 * automatically when a paid order is cancelled. Admin settles each one:
 *   - Online (Razorpay) → one click calls the Razorpay refund API on the
 *     original payment; it stays "processing" until the provider confirms.
 *   - COD / bank transfer → admin pays outside this system, then records
 *     the UPI / bank transaction reference here.
 *
 * Every refund state is loaded once (`?status=all`) and the tabs filter in
 * the page, so switching is instant and the counts always match the rows.
 * `?q=` pre-fills the search (the order page's "Process refund" link); if
 * exactly one refund needing action matches, it opens straight away.
 *
 * Data source: GET /api/admin/refund-requests?status=all
 * Actions:     POST /api/admin/refund-requests/:reqId/process | /reconcile
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import AdminButton from '@/components/AdminButton';
import AdminInput from '@/components/AdminInput';
import AdminTextarea from '@/components/AdminTextarea';
import { StatusChip } from '@/components/ui';
import { api, unwrap } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/dates';
import { refundMethodLabel } from '@/lib/orderStatusDisplay';
import { useOrderPolling } from '@/lib/useOrderPolling';
import { readListCache, writeListCache } from '@/lib/listCache';
import { confirmDialog } from '@/lib/confirm';
import list from '@/components/WorkspaceList.module.css';
import modal from '@/components/AdminModal.module.css';
import styles from './refunds.module.css';
import { notifyError, notifySuccess, notifyWarning, apiMessage } from '@/lib/notify';
import { M } from '@/lib/messages';

type RefundStatus = 'requested' | 'processing' | 'completed' | 'failed';
type Row = {
  orderNumber: string;
  reqId: string;
  kind: 'return' | 'exchange' | 'cancellation';
  paymentMethod: 'cod' | 'online';
  razorpayPaymentId: string;
  refundStatus: RefundStatus;
  refundMethod: 'razorpay' | 'manual' | '';
  refundAmount: number;
  refundReference: string;
  refundRequestedAt: string;
  /** When an admin last sent it to Razorpay (set by /process). */
  refundAttemptAt?: string | null;
  refundCompletedAt?: string | null;
  /** Admin's note, or the provider-uncertain warning written by /process. */
  refundNotes?: string;
  reason?: string;
  seller?: { name: string; slug?: string } | null;
  customer: { name: string; email: string };
  shippingAddress: any;
  items: { name: string; size?: string; quantity: number }[];
  customerRefundUpi?: string;
  customerRefundBankName?: string;
  customerRefundAccountNo?: string;
  customerRefundIfsc?: string;
  verification?: {
    verifiedAt?: string;
    verifiedOk?: boolean;
    verificationNotes?: string;
  } | null;
};

type Tab = RefundStatus | 'all';
const TABS: { id: Tab; label: string }[] = [
  { id: 'requested', label: 'To process' },
  { id: 'processing', label: 'Processing' },
  { id: 'failed', label: 'Failed' },
  { id: 'completed', label: 'Refunded' },
  { id: 'all', label: 'All' },
];
const STATUS_LABEL: Record<RefundStatus, string> = { requested: 'To process', processing: 'Processing', failed: 'Failed', completed: 'Refunded' };
const KIND_LABEL: Record<Row['kind'], string> = { return: 'Return refund', exchange: 'Exchange refund', cancellation: 'Cancellation refund' };

const CACHE_KEY = 'admin-refunds:all';
const PAGE_SIZE = 15;
const inr = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n || 0);
const daysSince = (iso?: string | null) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 86400000) : 0);
/** The backend decides by refundMethod: anything not Razorpay needs a transfer reference. */
const viaRazorpay = (r: Row) => r.refundMethod === 'razorpay';
const actionable = (r: Row) => r.refundStatus === 'requested' || r.refundStatus === 'failed';
const hasPayoutDetails = (r: Row) => !!(r.customerRefundUpi || r.customerRefundAccountNo);
const uncertain = (r: Row) => r.refundStatus === 'processing' && /uncertain|reconcile/i.test(r.refundNotes || '');
/** Matches the backend's RELEASE_AFTER_MS: an unconfirmed attempt may be released after an hour. */
const RELEASE_AFTER_MINUTES = 60;
const minutesSinceAttempt = (r: Row) => {
  const at = r.refundAttemptAt || r.refundRequestedAt;
  return at ? Math.floor((Date.now() - Date.parse(at)) / 60000) : Infinity;
};

export default function AdminRefundsPage() {
  const [rows, setRows] = useState<Row[] | null>(() => readListCache<Row[]>(CACHE_KEY));
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<Tab>('requested');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [activeId, setActiveId] = useState<string | null>(null);
  /** Set by the ?q= deep link only, so typing a search never auto-opens. */
  const [openFromLink, setOpenFromLink] = useState(false);

  const fetchRows = (signal?: AbortSignal) =>
    api.get('/admin/refund-requests', { signal, params: { status: 'all' } }).then((r) => {
      const next: Row[] = unwrap<{ requests?: Row[] }>(r).requests || [];
      setRows(next);
      setError(null);
      writeListCache(CACHE_KEY, next);
      return next;
    });

  useEffect(() => {
    const controller = new AbortController();
    fetchRows(controller.signal).catch((e) => {
      if (!controller.signal.aborted) setError(apiMessage(e) || 'The refund queue is unavailable right now.');
    });
    return () => controller.abort();
  }, [attempt]);
  // UX audit X5: no manual Refresh — the queue polls quietly.
  useOrderPolling((signal) => fetchRows(signal), 'refunds');

  // ?q= deep link (window.location avoids the Suspense boundary
  // useSearchParams needs at build time).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('q');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (q) { setQuery(q); setTab('all'); setOpenFromLink(true); }
  }, []);

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { requested: 0, processing: 0, failed: 0, completed: 0, all: 0 };
    for (const r of rows || []) { c[r.refundStatus] += 1; c.all += 1; }
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows || []).filter((r) => (tab === 'all' || r.refundStatus === tab) && (!q || [
      r.orderNumber, r.customer?.name, r.customer?.email, r.seller?.name, r.refundReference,
    ].some((v) => String(v || '').toLowerCase().includes(q))));
  }, [rows, tab, query]);

  // The order page's deep link: one refund needing action → open it.
  if (openFromLink && rows) {
    const due = filtered.filter(actionable);
    setOpenFromLink(false);
    if (due.length === 1) setActiveId(due[0].reqId);
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const shown = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const active = (rows || []).find((r) => r.reqId === activeId) || null;

  const waiting = (rows || []).filter(actionable);
  const waitingAmount = waiting.reduce((s, r) => s + (r.refundAmount || 0), 0);
  const oldest = waiting.reduce((m, r) => Math.max(m, daysSince(r.refundRequestedAt)), 0);
  const stuck = (rows || []).filter(uncertain).length;

  const chooseTab = (t: Tab) => { setTab(t); setPage(1); };
  const clearSearch = () => { setQuery(''); setPage(1); };
  const onRowClick = (e: React.MouseEvent, r: Row) => {
    if ((e.target as HTMLElement).closest('a,button')) return;
    setActiveId(r.reqId);
  };

  return (
    <div className={list.page}>
      <section className={list.workspace} aria-labelledby="refunds-heading">
        <div className={list.listHeader}>
          <div>
            <h2 id="refunds-heading">Refunds <span className={list.count}>{rows ? counts.all : '…'}</span></h2>
            <p className={styles.summary}>
              {!rows ? 'Online orders refund through Razorpay; cash on delivery needs a bank transfer and its reference.'
                : waiting.length
                  ? <><strong>₹{inr(waitingAmount)}</strong> to pay back across {waiting.length} {waiting.length === 1 ? 'refund' : 'refunds'}{oldest >= 2 && <> · <span className={styles.aged}>oldest waiting {oldest} days</span></>}{stuck > 0 && <> · <span className={styles.warnText}>{stuck} need a provider check</span></>}</>
                  : <>Nothing waiting to be paid back.{stuck > 0 && <> <span className={styles.warnText}>{stuck} {stuck === 1 ? 'needs' : 'need'} a provider check.</span></>}</>}
            </p>
          </div>
        </div>

        <div className={list.stageFilters} role="group" aria-label="Filter by refund status">
          {TABS.map((t) => (
            <button key={t.id} type="button" aria-pressed={tab === t.id} onClick={() => chooseTab(t.id)}>
              {t.label}<span>{rows ? counts[t.id] : '…'}</span>
            </button>
          ))}
        </div>

        <div className={list.toolbar}>
          <div className={list.toolbarLeft}>
            <label className={list.search}>
              <IconSearch />
              <span className="sr-only">Search refunds</span>
              <input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Search order, customer, seller or reference" />
              {query && <button type="button" className={list.clearSearch} onClick={clearSearch} aria-label="Clear search"><IconClose /></button>}
            </label>
          </div>
          <div className={list.results} aria-live="polite">
            {rows && <span>{filtered.length ? `Showing ${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, filtered.length)} of ${filtered.length}` : 'No results'}</span>}
            {query && <button type="button" className={list.clearFilters} onClick={clearSearch}><IconClose /> Clear search</button>}
          </div>
        </div>

        {error && !rows ? (
          <div className={list.state} role="alert">
            <span className={`${list.stateIcon} ${list.errorIcon}`}><IconAlert /></span>
            <h3>Couldn’t load refunds</h3>
            <p>{error}</p>
            <button type="button" className={list.stateAction} onClick={() => { setError(null); setAttempt((n) => n + 1); }}>Try again</button>
          </div>
        ) : !rows ? (
          <div className={list.skeleton} role="status" aria-label="Loading refunds"><span /><span /><span /><span /></div>
        ) : filtered.length === 0 ? (
          <div className={list.state}>
            <span className={list.stateIcon}><IconRefund /></span>
            <h3>{query ? `No refunds match “${query.trim()}”` : tab === 'requested' ? 'Nothing to pay back' : `No ${TABS.find((t) => t.id === tab)!.label.toLowerCase()} refunds`}</h3>
            <p>{query ? 'Try an order number, customer email or seller name.' : tab === 'requested' ? 'Refunds raised by sellers, and those created when a paid order is cancelled, appear here.' : 'They’ll show here once there are some.'}</p>
            {query && <button type="button" className={list.stateLink} onClick={clearSearch}>Clear search</button>}
          </div>
        ) : (
          <>
            {error && <p className="px-[22px] pb-3 text-[11px] text-[#a3413b]" role="status">Couldn’t refresh — showing the last loaded queue.</p>}
            <div className={list.tableWrap}>
              <table className={list.table}>
                <caption className="sr-only">Refunds, newest first</caption>
                <thead>
                  <tr>
                    <th scope="col">Refund</th><th scope="col">Customer</th>
                    <th scope="col">Pay back via</th><th scope="col">Raised</th><th scope="col">Status</th>
                    <th scope="col" className={list.money}>Amount</th><th scope="col"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.reqId} onClick={(e) => onRowClick(e, r)}>
                      <td className="whitespace-nowrap">
                        <Link className={list.primary} href={`/orders/${r.orderNumber}`}>{r.orderNumber}</Link>
                        <span className={list.sub} title={r.seller ? `Seller: ${r.seller.name}` : undefined}>{KIND_LABEL[r.kind] || 'Refund'}{r.seller ? ` · ${r.seller.name}` : ''}</span>
                      </td>
                      <td>
                        <span className={list.primary}>{r.customer?.name || 'Deleted account'}</span>
                        {r.customer?.email && <span className={list.sub}>{r.customer.email}</span>}
                      </td>
                      <td>
                        <span className={styles.method}>{refundMethodLabel(r.refundMethod, r.paymentMethod)}</span>
                        <Destination r={r} />
                      </td>
                      <td><Raised r={r} /></td>
                      <td><StatusChip status={r.refundStatus} label={STATUS_LABEL[r.refundStatus]} /></td>
                      <td className={list.money}><strong>₹{inr(r.refundAmount)}</strong></td>
                      <td>
                        <button type="button" className={list.openLink} onClick={() => setActiveId(r.reqId)} aria-label={`${actionable(r) ? 'Process' : 'View'} refund for ${r.orderNumber}`} title={actionable(r) ? 'Process refund' : 'View refund'}><IconArrow /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={list.cards}>
              {shown.map((r) => (
                <button key={r.reqId} type="button" className={`${list.card} w-full text-left`} onClick={() => setActiveId(r.reqId)}>
                  <div className={list.cardTop}>
                    <div className="min-w-0">
                      <span className={list.primary}>{r.orderNumber}</span>
                      <span className={list.sub}>{KIND_LABEL[r.kind] || 'Refund'} · {r.customer?.name || 'Deleted account'}</span>
                    </div>
                    <StatusChip status={r.refundStatus} label={STATUS_LABEL[r.refundStatus]} />
                  </div>
                  <dl className={list.cardGrid}>
                    <div><dt>Amount</dt><dd><strong>₹{inr(r.refundAmount)}</strong></dd></div>
                    <div><dt>Pay back via</dt><dd>{refundMethodLabel(r.refundMethod, r.paymentMethod)}<Destination r={r} /></dd></div>
                    <div><dt>Seller</dt><dd>{r.seller?.name || '—'}</dd></div>
                    <div><dt>Raised</dt><dd><Raised r={r} /></dd></div>
                  </dl>
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

      <RefundDialog row={active} onClose={() => setActiveId(null)} onDone={() => { void fetchRows().catch(() => {}); }} />
    </div>
  );
}

/** What the admin needs before paying: a COD refund without payout details can't be sent. */
function Destination({ r }: { r: Row }) {
  if (viaRazorpay(r) || !actionable(r)) return null;
  return hasPayoutDetails(r)
    ? <span className={list.sub}>{r.customerRefundUpi ? 'UPI on file' : 'Bank account on file'}</span>
    : <span className={`${list.sub} ${styles.warnText}`}>No payout details</span>;
}

function Raised({ r }: { r: Row }) {
  if (!r.refundRequestedAt) return <span className={list.sub}>—</span>;
  const waited = daysSince(r.refundRequestedAt);
  return (
    <>
      <span title={formatDateTime(r.refundRequestedAt)}>{formatDate(r.refundRequestedAt)}</span>
      {r.refundStatus === 'completed' && r.refundCompletedAt
        ? <span className={list.sub}>Refunded {formatDate(r.refundCompletedAt)}</span>
        : uncertain(r)
          ? <span className={`${list.sub} ${styles.warnText}`}>Needs provider check</span>
          : actionable(r) && waited >= 2 && <span className={`${list.sub} ${styles.aged}`}>Waiting {waited}d</span>}
    </>
  );
}

/**
 * Review + settle one refund. Online: one click to Razorpay. Manual: the
 * transfer happens outside, the reference recorded here. Processing:
 * re-read the provider. Every money action still goes through confirmDialog.
 */
function RefundDialog({ row, onClose, onDone }: { row: Row | null; onClose: () => void; onDone: () => void }) {
  const [txRef, setTxRef] = useState('');
  const [notes, setNotes] = useState('');
  const [working, setWorking] = useState(false);
  const [forId, setForId] = useState<string | null>(null);
  // Fresh form per refund opened (render-time reset, not an effect).
  if (row && row.reqId !== forId) { setForId(row.reqId); setTxRef(''); setNotes(''); }

  async function processRefund() {
    if (!row) return;
    const manual = !viaRazorpay(row);
    if (manual && txRef.trim().length < 3) {
      notifyWarning(M.refunds.addTheTransactionReference);
      return;
    }
    if (!(await confirmDialog({
      title: manual ? 'Record this transfer?' : 'Send this refund?',
      message: manual
        ? `Marks ₹${inr(row.refundAmount)} as paid with reference “${txRef.trim()}”. Make sure the transfer has actually gone through first.`
        : `Razorpay will return ₹${inr(row.refundAmount)} to the customer’s original payment method. This can’t be undone.`,
      confirmLabel: manual ? 'Mark as refunded' : 'Refund via Razorpay',
    }))) return;
    setWorking(true);
    try {
      const data = unwrap<any>(await api.post(`/admin/refund-requests/${row.reqId}/process`, { reference: txRef.trim(), notes: notes.trim() }));
      // Our own words for each outcome (the response carries the state).
      const amount = `₹${inr(row.refundAmount)}`;
      if (data?.reconciliationRequired) notifyWarning(M.refunds.razorpayDidntConfirmInTime);
      else if (manual) notifySuccess(M.refunds.refundRecorded(amount, row.customer?.name || 'the customer'));
      else if (data?.refund?.refundStatus === 'completed') notifySuccess(M.refunds.refundSent(amount));
      else if (data?.refund?.refundStatus === 'failed') notifyWarning(M.refunds.razorpayRejectedTheRefund);
      else notifySuccess(M.refunds.refundSubmitted(amount));
      onClose();
      onDone();
    } catch (e: any) {
      notifyError(e, M.refunds.couldntProcessTheRefund);
    } finally {
      setWorking(false);
    }
  }

  async function reconcile() {
    if (!row) return;
    setWorking(true);
    try {
      const res = await api.post(`/admin/refund-requests/${row.reqId}/reconcile`);
      const now = unwrap<any>(res)?.refund?.refundStatus;
      if (res.status === 202) notifyWarning(M.refunds.noRefundOnRazorpayYet);
      else if (now === 'completed') notifySuccess(M.refunds.refundConfirmed);
      else if (now === 'failed') notifyWarning(M.refunds.razorpayRejectedTheRefund);
      else notifySuccess(M.refunds.statusUpdated);
      onDone();
    } catch (e: any) {
      notifyError(e, M.refunds.couldntCheckTheProviderStatus);
    } finally {
      setWorking(false);
    }
  }

  /** An attempt Razorpay never confirmed goes back to "To process" — after a last provider check. */
  async function release() {
    if (!row) return;
    if (!(await confirmDialog({
      title: 'Release this refund?',
      message: `Razorpay is checked once more first. If it still has no record of the ₹${inr(row.refundAmount)} attempt, the request goes back to To process so it can be refunded again. If Razorpay does have a record, that status is applied instead.`,
      confirmLabel: 'Release',
    }))) return;
    setWorking(true);
    try {
      const data = unwrap<{ released?: boolean }>(await api.post(`/admin/refund-requests/${row.reqId}/release`));
      if (data?.released) notifySuccess(M.refunds.releasedForRetry);
      else notifyWarning(M.refunds.razorpayHadARecordAfterAll);
      onClose();
      onDone();
    } catch (e: any) {
      notifyError(e, M.refunds.couldntReleaseTheRefund);
    } finally {
      setWorking(false);
    }
  }

  const r = row;
  const tone = !r ? 'info' : r.refundStatus === 'completed' ? 'positive' : r.refundStatus === 'failed' ? 'danger' : r.refundStatus === 'processing' ? 'warn' : 'info';
  const manual = r ? !viaRazorpay(r) : false;
  const addr = r?.shippingAddress;

  return (
    <Modal isOpen={!!r} onClose={() => !working && onClose()} placement="center" size="2xl" scrollBehavior="inside" hideCloseButton classNames={{ base: modal.modal, backdrop: modal.backdrop }}>
      <ModalContent>
        {r && (
          <>
            <ModalHeader className={modal.header}>
              <span className={`${modal.icon} ${modal[tone]}`}><IconRefund /></span>
              <div className="min-w-0 flex-1">
                <div className={modal.eyebrow}>{KIND_LABEL[r.kind] || 'Refund'} · <span className="whitespace-nowrap">{r.orderNumber}</span></div>
                <div className={modal.title}>₹{inr(r.refundAmount)} to {r.customer?.name || 'the customer'}</div>
                <div className={`${modal.sub} flex flex-wrap items-center gap-2`}>
                  <StatusChip status={r.refundStatus} label={uncertain(r) ? 'Needs provider check' : STATUS_LABEL[r.refundStatus]} />
                  <span>{refundMethodLabel(r.refundMethod, r.paymentMethod)} · raised {r.refundRequestedAt ? formatDateTime(r.refundRequestedAt) : '—'}</span>
                </div>
              </div>
              <button type="button" className={modal.close} onClick={onClose} disabled={working} aria-label="Close"><IconClose /></button>
            </ModalHeader>

            <ModalBody className={modal.body}>
              {/* Where the money stands — first, because it decides what to do. */}
              {r.refundStatus === 'completed' && (
                <div className={`${styles.banner} ${styles.good}`} role="status">
                  <IconCheck />
                  <span><strong>Refunded{r.refundCompletedAt ? ` on ${formatDateTime(r.refundCompletedAt)}` : ''}.</strong> Reference {r.refundReference || '—'}{r.refundReference && <CopyButton label="Reference" value={r.refundReference} />}</span>
                </div>
              )}
              {r.refundStatus === 'processing' && (
                <div className={`${styles.banner} ${styles.info}`} role="status">
                  <IconClock />
                  <span>
                    <strong>{uncertain(r) ? 'Razorpay didn’t confirm this refund.' : 'Submitted to Razorpay — waiting for confirmation.'}</strong>{' '}
                    {uncertain(r)
                      ? <>The transfer may or may not have gone through, so it stays locked until the provider status is checked.{r.refundAttemptAt && <> Sent {formatDateTime(r.refundAttemptAt)}.</>}{minutesSinceAttempt(r) >= RELEASE_AFTER_MINUTES
                          ? ' Razorpay has had over an hour; if it still has no record, release the refund and send it again.'
                          : ` If Razorpay still has no record after an hour, you can release it and send it again (in ${Math.max(1, RELEASE_AFTER_MINUTES - minutesSinceAttempt(r))} min).`}</>
                      : 'It completes on its own once Razorpay confirms; check the provider status if it’s taking long.'}
                  </span>
                </div>
              )}
              {r.refundStatus === 'failed' && (
                <div className={`${styles.banner} ${styles.bad}`} role="alert">
                  <IconAlert />
                  <span><strong>The last attempt failed.</strong> {r.refundNotes && !uncertain(r) ? `${r.refundNotes} · ` : ''}Review the details, then try again.</span>
                </div>
              )}

              {/* Why the refund exists. */}
              {r.verification?.verifiedAt ? (
                <div className={`${styles.banner} ${r.verification.verifiedOk !== false ? '' : styles.bad}`}>
                  <IconBox />
                  <span>
                    <strong>{r.seller?.name || 'Seller'} {r.verification.verifiedOk !== false ? 'verified' : 'flagged'} the returned parcel</strong> on {formatDateTime(r.verification.verifiedAt)}
                    {r.verification.verificationNotes && <> — “{r.verification.verificationNotes}”</>}
                  </span>
                </div>
              ) : r.reason ? (
                <div className={styles.banner}><IconBox /><span><strong>Reason:</strong> {r.reason}</span></div>
              ) : null}

              <div className={styles.grid}>
                <div className={styles.box}>
                  <div className={styles.boxTitle}>Refunding</div>
                  <ul className={styles.items}>
                    {r.items.map((it, i) => (
                      <li key={i}>
                        {it.name}
                        <span className={styles.muted}>{it.size ? ` · Size ${it.size}` : ''} × {it.quantity}</span>
                      </li>
                    ))}
                  </ul>
                  <p className={`${styles.muted} mt-2`}>
                    {r.customer?.name}{r.customer?.email ? ` · ${r.customer.email}` : ''}
                    {addr?.city ? <><br />{[addr.city, addr.state].filter(Boolean).join(', ')} {addr.pincode}</> : null}
                  </p>
                </div>

                <div className={styles.box}>
                  <div className={styles.boxTitle}>Send to</div>
                  {!manual ? (
                    <>
                      <p><strong>Original Razorpay payment</strong></p>
                      <div className={styles.value}><span className={styles.muted}>{r.razorpayPaymentId || '—'}</span>{r.razorpayPaymentId && <CopyButton label="Payment id" value={r.razorpayPaymentId} />}</div>
                      <p className={`${styles.muted} mt-1`}>Razorpay returns the money to the customer’s card, UPI or bank automatically.</p>
                    </>
                  ) : r.customerRefundUpi ? (
                    <>
                      <p><strong>UPI</strong></p>
                      <div className={styles.value}><span>{r.customerRefundUpi}</span><CopyButton label="UPI id" value={r.customerRefundUpi} /></div>
                      <p className={`${styles.muted} mt-1`}>Transfer manually, then record the reference below.</p>
                    </>
                  ) : r.customerRefundAccountNo ? (
                    <>
                      <p><strong>{r.customerRefundBankName || 'Bank account'}</strong></p>
                      <div className={styles.value}><span className={styles.muted}>A/C</span><span>{r.customerRefundAccountNo}</span><CopyButton label="Account number" value={r.customerRefundAccountNo} /></div>
                      <div className={styles.value}><span className={styles.muted}>IFSC</span><span>{r.customerRefundIfsc || '—'}</span>{r.customerRefundIfsc && <CopyButton label="IFSC" value={r.customerRefundIfsc} />}</div>
                      <p className={`${styles.muted} mt-1`}>Transfer via NEFT / IMPS, then record the reference below.</p>
                    </>
                  ) : (
                    <p className={styles.warnText}>The customer hasn’t given UPI or bank details. Contact them before paying{r.customer?.email ? ` (${r.customer.email})` : ''}.</p>
                  )}
                </div>
              </div>

              {actionable(r) && (
                <div className={styles.form}>
                  {manual && (
                    <AdminInput
                      label="Transaction reference" isRequired variant="bordered"
                      placeholder="UPI ref / NEFT or IMPS transaction id"
                      description="Required — it’s what proves the transfer to the customer and in audits."
                      value={txRef} onChange={(e) => setTxRef(e.target.value)}
                    />
                  )}
                  <AdminTextarea
                    label="Internal note" labelPlacement="outside" variant="bordered" minRows={2} maxRows={5} maxLength={500}
                    placeholder="Optional — visible to admins only"
                    value={notes} onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              )}
              {!actionable(r) && r.refundNotes && !uncertain(r) && (
                <p className={`${styles.muted} text-[12px]`}><strong className="font-semibold text-[#39434c]">Note:</strong> {r.refundNotes}</p>
              )}
            </ModalBody>

            <ModalFooter className={`${modal.footer} ${styles.footerSpread}`}>
              <Link className={styles.orderLink} href={`/orders/${r.orderNumber}`}>Open order <IconArrow /></Link>
              <div className="flex flex-wrap gap-2">
                <AdminButton variant="bordered" onPress={onClose} isDisabled={working}>Close</AdminButton>
                {uncertain(r) && viaRazorpay(r) && minutesSinceAttempt(r) >= RELEASE_AFTER_MINUTES && (
                  <AdminButton variant="bordered" isLoading={working} onPress={release}>Release and refund again</AdminButton>
                )}
                {r.refundStatus === 'processing' && viaRazorpay(r) && (
                  <AdminButton color="primary" isLoading={working} onPress={reconcile}>Check provider status</AdminButton>
                )}
                {actionable(r) && (
                  <AdminButton color="primary" isLoading={working} onPress={processRefund}>
                    {manual ? 'Mark as refunded' : r.refundStatus === 'failed' ? 'Retry via Razorpay' : 'Refund via Razorpay'}
                  </AdminButton>
                )}
              </div>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

function CopyButton({ label, value }: { label: string; value: string }) {
  return (
    <button type="button" className={styles.copy} aria-label={`Copy ${label.toLowerCase()}`} title={`Copy ${label.toLowerCase()}`}
      onClick={() => navigator.clipboard.writeText(value).then(() => notifySuccess(M.refunds.copied(label))).catch(() => notifyWarning(M.refunds.copyFailedSelectTheTextManually))}>
      <IconCopy />
    </button>
  );
}

const svg = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
function IconArrow({ flip }: { flip?: boolean }) { return <svg {...svg} width="14" height="14" style={flip ? { transform: 'scaleX(-1)' } : undefined}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></svg>; }
function IconSearch() { return <svg {...svg}><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>; }
function IconClose() { return <svg {...svg} width="12" height="12"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>; }
function IconAlert() { return <svg {...svg}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>; }
function IconRefund() { return <svg {...svg}><polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" /></svg>; }
function IconCheck() { return <svg {...svg}><polyline points="20 6 9 17 4 12" /></svg>; }
function IconClock() { return <svg {...svg}><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></svg>; }
function IconBox() { return <svg {...svg}><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><path d="M3.27 6.96 12 12.01l8.73-5.05M12 22.08V12" /></svg>; }
function IconCopy() { return <svg {...svg}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>; }
