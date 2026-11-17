'use client';

/**
 * Admin — seller settlements, in the workspace list layout (same family as
 * Orders and Refunds). Three views in one panel:
 *
 *   By week   every seller's delivered parcels for one week, side by side:
 *             item total, what the courier charged, the Razorpay share,
 *             refunds already returned, and the net to transfer. A row opens
 *             to its parcels; "Mark paid" records the bank transfer (UTR) and
 *             freezes the lines into a Settlement — the seller's Payouts page
 *             flips that week to Paid.
 *   On the way parcels with a label that haven't been delivered yet, so
 *             charges can be checked and corrected before they land in a week.
 *   Paid      settlement history with the bank reference and who recorded it.
 *
 * Money maths lives in backend services/payouts.js; nothing here computes.
 * Data: GET /api/admin/settlements?week=, /in-transit, /history;
 * POST /api/admin/settlements/pay; PATCH …/shipments/:sellerId/courier-charge.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import AdminButton from '@/components/AdminButton';
import AdminInput from '@/components/AdminInput';
import { StatusChip } from '@/components/ui';
import { api, unwrap } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/dates';
import { readListCache, writeListCache } from '@/lib/listCache';
import { apiMessage, notifyError, notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';
import list from '@/components/WorkspaceList.module.css';
import modal from '@/components/AdminModal.module.css';
import styles from './settlements.module.css';

type Line = {
  orderId: string; orderNumber: string; paymentMethod: 'cod' | 'online'; deliveredAt: string | null; status: string;
  courierName: string; itemTotal: number; courierCharge: number | null; gatewayCharge: number; refunds: number; net: number;
  flags: string[];
};
type Totals = { orders: number; itemTotal: number; courierCharge: number; gatewayCharge: number; refunds: number; net: number; missing: number };
type Row = {
  seller: { _id: string; name: string; email: string; slug?: string; bank: { bankName: string; accountHolder: string; last4: string; ifsc: string } | null };
  totals: Totals; lines: Line[]; status: 'due' | 'paid';
  settlement: { amountPaid: number; utr: string; paidAt: string; paidByEmail: string; note: string } | null;
};
type WeekResponse = { week: { weekKey: string; periodStart: string; periodEnd: string; inProgress: boolean }; rows: Row[]; totals: { sellers: number; net: number; paid: number } };
type TransitRow = { seller: { _id: string; name: string; email: string; slug?: string }; totals: Totals; lines: Line[] };
type TransitResponse = { rows: TransitRow[]; totals: { sellers: number; orders: number; net: number } };
type HistoryItem = { _id: string; weekKey: string; periodStart: string; periodEnd: string; orders: number; net: number; amountPaid: number; utr: string; paidAt: string; paidByEmail: string; seller: { _id: string; name: string; storeName?: string; slug?: string; email: string } };
type Tab = 'week' | 'transit' | 'history';

const inr2 = (n: number | null | undefined) =>
  n == null ? '—' : `₹${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
const minus = (n: number | null | undefined) => (n ? `− ${inr2(n)}` : '—');

function weekLabel(periodStart: string, periodEnd: string) {
  const s = new Date(periodStart); const e = new Date(new Date(periodEnd).getTime() - 1);
  const f = (d: Date, m: boolean) => d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', ...(m ? { month: 'short' } : {}) });
  return `${f(s, s.getMonth() !== e.getMonth())}–${f(e, true)} ${e.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', year: 'numeric' })}`;
}
/** Short status words for a parcel on its way (mirrors lib/orderStatusDisplay). */
function transitLabel(status: string): { label: string; status: string } {
  if (status === 'out_for_delivery') return { label: 'Out for delivery', status: 'out_for_delivery' };
  if (status === 'undelivered') return { label: 'Delivery failed', status: 'delivery_failed' };
  if (status === 'awb') return { label: 'Awaiting pickup', status: 'awaiting_pickup' };
  return { label: 'In transit', status: 'in_transit' };
}
/** Shift a Monday key by ±7 days. */
function shiftWeek(key: string, weeks: number) {
  const d = new Date(`${key}T12:00:00+05:30`); d.setDate(d.getDate() + weeks * 7);
  return d.toISOString().slice(0, 10);
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function SettlementsPage() {
  const [tab, setTab] = useState<Tab>('week');
  const [weekKey, setWeekKey] = useState<string>('');
  const cacheKey = `admin-settlements:${weekKey || 'default'}`;
  const [data, setData] = useState<WeekResponse | null>(() => readListCache<WeekResponse>(cacheKey));
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [transit, setTransit] = useState<TransitResponse | null>(() => readListCache<TransitResponse>('admin-settlements-transit'));
  const [transitError, setTransitError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  /* Loading is derived, never set from an effect: a never-seen week shows a
     skeleton; switching weeks keeps the old rows dimmed until the new ones land. */
  const loading = !data && !error;
  const updating = !!data && !!weekKey && data.week.weekKey !== weekKey;
  const transitLoading = !transit && !transitError;

  /* Loaders resolve state in `.then` callbacks (never synchronously), so the
     effects below can call them directly. */
  const load = (key = weekKey) =>
    api.get('/admin/settlements', { params: key ? { week: key } : {} })
      .then((r) => {
        const d = unwrap<WeekResponse>(r);
        setData(d); writeListCache(`admin-settlements:${key || 'default'}`, d); setError(null);
        if (!key) setWeekKey(d.week.weekKey);
      })
      .catch((e) => setError(apiMessage(e) || 'The settlements list is unavailable right now.'));
  const loadHistory = () =>
    api.get('/admin/settlements/history')
      .then((r) => { setHistory(unwrap<{ items?: HistoryItem[] }>(r).items || []); setHistoryError(null); })
      .catch((e) => setHistoryError(apiMessage(e) || 'Paid settlements are unavailable right now.'));
  const loadTransit = () =>
    api.get('/admin/settlements/in-transit')
      .then((r) => { const d = unwrap<TransitResponse>(r); setTransit(d); writeListCache('admin-settlements-transit', d); setTransitError(null); })
      .catch((e) => setTransitError(apiMessage(e) || 'Parcels on the way are unavailable right now.'));
  useEffect(() => { void load(''); void loadTransit(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'history' && history === null) void loadHistory(); }, [tab, history]);
  useEffect(() => { if (tab === 'transit') void loadTransit(); }, [tab]);

  const goWeek = (delta: number) => { if (!data) return; const k = shiftWeek(data.week.weekKey, delta); setWeekKey(k); setOpen({}); load(k); };
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const onRowClick = (e: React.MouseEvent, id: string) => { if ((e.target as HTMLElement).closest('a,button')) return; toggle(id); };

  // ── Mark paid ─────────────────────────────────────────────────────
  const [paying, setPaying] = useState<Row | null>(null);
  const [payForm, setPayForm] = useState({ amountPaid: '', utr: '', note: '' });
  const [payBusy, setPayBusy] = useState(false);
  function openPay(row: Row) { setPaying(row); setPayForm({ amountPaid: String(row.totals.net), utr: '', note: '' }); }
  async function submitPay() {
    if (!paying || !data) return;
    if (!payForm.utr.trim()) { notifyWarning(M.settlements.addTheBankReference); return; }
    setPayBusy(true);
    try {
      await api.post('/admin/settlements/pay', { sellerId: paying.seller._id, week: data.week.weekKey, amountPaid: Number(payForm.amountPaid), utr: payForm.utr.trim(), note: payForm.note.trim() });
      notifySuccess(M.settlements.markedPaid(paying.seller.name, inr2(Number(payForm.amountPaid))));
      setPaying(null); setHistory(null); await load(data.week.weekKey);
    } catch (e: any) { notifyError(e, M.settlements.couldntRecordThePayment); }
    finally { setPayBusy(false); }
  }

  // ── Courier charge fix-up ─────────────────────────────────────────
  const [charging, setCharging] = useState<{ sellerId: string; sellerName: string; line: Line } | null>(null);
  const [chargeForm, setChargeForm] = useState({ total: '', note: '' });
  const [chargeBusy, setChargeBusy] = useState(false);
  function openCharge(sellerId: string, sellerName: string, line: Line) {
    setCharging({ sellerId, sellerName, line }); setChargeForm({ total: line.courierCharge == null ? '' : String(line.courierCharge), note: '' });
  }
  async function submitCharge() {
    if (!charging) return;
    setChargeBusy(true);
    try {
      await api.patch(`/admin/orders/${charging.line.orderNumber}/shipments/${charging.sellerId}/courier-charge`, { total: Number(chargeForm.total), note: chargeForm.note.trim() });
      notifySuccess(M.settlements.deliveryChargeSaved); setCharging(null);
      if (tab === 'transit') await loadTransit(); else if (data) await load(data.week.weekKey);
    } catch (e: any) { notifyError(e, M.settlements.couldntSaveTheCharge); }
    finally { setChargeBusy(false); }
  }

  const rows = data?.rows ?? [];
  const due = rows.filter((r) => r.status !== 'paid');
  const dueNet = due.reduce((s, r) => s + r.totals.net, 0);
  const missing = rows.reduce((s, r) => s + (r.status === 'paid' ? 0 : r.totals.missing), 0);
  const noBank = due.filter((r) => !r.seller.bank).length;
  const inProgress = !!data?.week.inProgress;

  const headerCopy = tab === 'week'
    ? inProgress ? 'This week is still in progress — it can be settled after Sunday.' : 'What each seller is owed for parcels delivered this week. Open a seller to see every parcel; mark the week paid once the transfer is done.'
    : tab === 'transit' ? 'Parcels with a courier label that haven’t been delivered yet. Their charges are already known — fix any that are missing now, so they land in a week with the right numbers.'
    : 'Every settlement you’ve recorded, newest first, with the bank reference and who recorded it.';

  return (
    <div className={list.page}>
      <section className={list.workspace} aria-labelledby="settlements-heading">
        <div className={list.listHeader}>
          <div>
            <h2 id="settlements-heading">
              {tab === 'week' ? 'Weekly settlements' : tab === 'transit' ? 'Parcels on the way' : 'Paid settlements'}
              <span className={list.count}>{tab === 'week' ? (data ? data.totals.sellers : '…') : tab === 'transit' ? (transit ? transit.totals.orders : '…') : (history ? history.length : '…')}</span>
            </h2>
            <p>{headerCopy}</p>
          </div>
          {tab === 'week' && (
            <div className={list.headerActions}>
              <div className={styles.weekNav} role="group" aria-label="Choose week">
                <button type="button" onClick={() => goWeek(-1)} disabled={!data} aria-label="Earlier week"><IconChevron flip /></button>
                <span className={styles.weekLabel}>{data ? weekLabel(data.week.periodStart, data.week.periodEnd) : 'Loading…'}{inProgress && <small>in progress</small>}</span>
                <button type="button" onClick={() => goWeek(1)} disabled={!data || inProgress} aria-label="Later week"><IconChevron /></button>
              </div>
            </div>
          )}
        </div>

        <div className={list.stageFilters} role="group" aria-label="Settlement views">
          {([['week', 'By week', data ? data.totals.sellers : null], ['transit', 'On the way', transit ? transit.totals.orders : null], ['history', 'Paid', history ? history.length : null]] as [Tab, string, number | null][]).map(([id, label, n]) => (
            <button key={id} type="button" aria-pressed={tab === id} onClick={() => setTab(id)}>{label}<span>{n ?? '…'}</span></button>
          ))}
        </div>

        {/* ── By week ── */}
        {tab === 'week' && (
          <>
            {data && rows.length > 0 && (
              <dl className={styles.summary}>
                <div><dt>To pay</dt><dd>{inr2(dueNet)}<small>{plural(due.length, 'seller')} still due</small></dd></div>
                <div><dt>Paid</dt><dd>{data.totals.paid} of {data.totals.sellers}<small>{inr2(data.totals.net - dueNet)} transferred</small></dd></div>
                <div><dt>Charges to confirm</dt><dd className={missing ? styles.warn : ''}>{missing}<small>{missing ? 'set them before paying, or sellers get too much' : 'every parcel has its courier charge'}</small></dd></div>
                <div><dt>No bank details</dt><dd className={noBank ? styles.danger : ''}>{noBank}<small>{noBank ? 'ask these sellers to complete KYC' : 'all due sellers can be paid'}</small></dd></div>
              </dl>
            )}
            {error && !data ? (
              <ErrorState title="Couldn’t load settlements" message={error} onRetry={() => { setError(null); load(weekKey); }} />
            ) : loading ? (
              <Skeleton />
            ) : rows.length === 0 ? (
              <div className={list.state}>
                <span className={list.stateIcon}><IconPayout /></span>
                <h3>Nothing delivered this week</h3>
                <p>Parcels appear here in the week their courier marks them delivered. Try an earlier week, or check what’s on the way.</p>
                <button type="button" className={list.stateLink} onClick={() => setTab('transit')}>See parcels on the way</button>
              </div>
            ) : (
              <>
                <div className={`${list.tableWrap} ${updating ? list.stale : ''}`} aria-busy={updating}>
                  <table className={list.table}>
                    <caption className="sr-only">Sellers and what they are owed for the week</caption>
                    <thead>
                      <tr>
                        <th scope="col">Seller</th><th scope="col">Parcels</th>
                        <th scope="col" className={list.money}>Item total</th><th scope="col" className={list.money}>Delivery</th>
                        <th scope="col" className={list.money}>Gateway</th><th scope="col" className={list.money}>Refunds</th>
                        <th scope="col" className={list.money}>To pay</th><th scope="col">Status</th>
                        <th scope="col"><span className="sr-only">Actions</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => {
                        const id = r.seller._id;
                        const isOpen = !!open[id];
                        const canPay = r.status !== 'paid' && !inProgress && r.totals.net > 0;
                        return [
                          <tr key={id} onClick={(e) => onRowClick(e, id)} aria-expanded={isOpen}>
                            <td>
                              <Link className={list.primary} href={`/sellers/${r.seller.slug || id}`}>{r.seller.name}</Link>
                              <span className={`${styles.bank} block mt-[3px]`}>
                                {r.seller.bank ? `${r.seller.bank.bankName || 'Bank'} ···${r.seller.bank.last4}` : <span className={styles.noBank}>No bank details on file</span>}
                              </span>
                              {r.status !== 'paid' && r.totals.missing > 0 && <span className={styles.missing}><IconBang />{plural(r.totals.missing, 'charge')} to confirm</span>}
                            </td>
                            <td>{r.totals.orders}</td>
                            <td className={list.money}>{inr2(r.totals.itemTotal)}</td>
                            <td className={`${list.money} ${styles.deduct}`}>{minus(r.totals.courierCharge)}</td>
                            <td className={`${list.money} ${styles.deduct}`}>{minus(r.totals.gatewayCharge)}</td>
                            <td className={`${list.money} ${styles.deduct}`}>{minus(r.totals.refunds)}</td>
                            <td className={list.money}><strong>{inr2(r.totals.net)}</strong></td>
                            <td>
                              {r.status === 'paid'
                                ? <><StatusChip label="Paid" status="delivered" /><span className={list.sub}>{formatDate(r.settlement!.paidAt)}{r.settlement!.utr ? ` · UTR ${r.settlement!.utr}` : ''}</span></>
                                : <StatusChip label={inProgress ? 'In progress' : 'Due'} status={inProgress ? 'pending' : 'processing'} />}
                            </td>
                            <td>
                              <div className={styles.rowEnd}>
                                {canPay && <AdminButton color="primary" onPress={() => openPay(r)}>Mark paid</AdminButton>}
                                <button type="button" className={styles.expand} aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} parcels for ${r.seller.name}`} onClick={() => toggle(id)}><IconChevronDown /></button>
                              </div>
                            </td>
                          </tr>,
                          isOpen && (
                            <tr key={`${id}-lines`} className={styles.linesRow}>
                              <td colSpan={9}>
                                <div className={styles.lines}>
                                  <LinesTable lines={r.lines} mode="week" onCharge={r.status === 'paid' ? undefined : (l) => openCharge(id, r.seller.name, l)} />
                                </div>
                              </td>
                            </tr>
                          ),
                        ];
                      })}
                    </tbody>
                  </table>
                </div>
                <div className={`${list.cards} ${updating ? list.stale : ''}`}>
                  {rows.map((r) => {
                    const id = r.seller._id;
                    const canPay = r.status !== 'paid' && !inProgress && r.totals.net > 0;
                    return (
                      <div key={id} className={list.card}>
                        <div className={list.cardTop}>
                          <div className="min-w-0">
                            <Link className={list.primary} href={`/sellers/${r.seller.slug || id}`}>{r.seller.name}</Link>
                            <span className={list.sub}>{r.seller.bank ? `${r.seller.bank.bankName || 'Bank'} ···${r.seller.bank.last4}` : 'No bank details on file'}</span>
                          </div>
                          {r.status === 'paid' ? <StatusChip label="Paid" status="delivered" /> : <StatusChip label={inProgress ? 'In progress' : 'Due'} status={inProgress ? 'pending' : 'processing'} />}
                        </div>
                        <dl className={list.cardGrid}>
                          <div><dt>To pay</dt><dd><strong>{inr2(r.totals.net)}</strong></dd></div>
                          <div><dt>Parcels</dt><dd>{r.totals.orders}{r.totals.missing > 0 && r.status !== 'paid' ? <span className={styles.missing}> · {r.totals.missing} to confirm</span> : ''}</dd></div>
                          <div><dt>Item total</dt><dd>{inr2(r.totals.itemTotal)}</dd></div>
                          <div><dt>Deductions</dt><dd>{minus(r.totals.courierCharge + r.totals.gatewayCharge + r.totals.refunds)}</dd></div>
                        </dl>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {canPay && <AdminButton color="primary" onPress={() => openPay(r)}>Mark paid</AdminButton>}
                          <AdminButton variant="bordered" onPress={() => toggle(id)}>{open[id] ? 'Hide parcels' : `Show ${plural(r.totals.orders, 'parcel')}`}</AdminButton>
                        </div>
                        {open[id] && <CardLines lines={r.lines} mode="week" onCharge={r.status === 'paid' ? undefined : (l) => openCharge(id, r.seller.name, l)} />}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        {/* ── On the way ── */}
        {tab === 'transit' && (
          transitError && !transit ? (
            <ErrorState title="Couldn’t load parcels on the way" message={transitError} onRetry={() => { setTransitError(null); loadTransit(); }} />
          ) : transitLoading ? (
            <Skeleton />
          ) : !transit || transit.rows.length === 0 ? (
            <div className={list.state}>
              <span className={list.stateIcon}><IconTruck /></span>
              <h3>Nothing on the way</h3>
              <p>Parcels with a courier label that haven’t been delivered yet show here with their charges.</p>
            </div>
          ) : (
            <>
              <dl className={styles.summary}>
                <div><dt>Expected once delivered</dt><dd>{inr2(transit.totals.net)}<small>{plural(transit.totals.orders, 'parcel')} from {plural(transit.totals.sellers, 'seller')}</small></dd></div>
                <div><dt>Charges to confirm</dt><dd className={transit.rows.some((r) => r.totals.missing) ? styles.warn : ''}>{transit.rows.reduce((s, r) => s + r.totals.missing, 0)}<small>each parcel joins the week it’s delivered in</small></dd></div>
              </dl>
              <div className={list.tableWrap}>
                <table className={list.table}>
                  <caption className="sr-only">Parcels on the way, by seller</caption>
                  <thead>
                    <tr>
                      <th scope="col">Seller</th><th scope="col">Parcels</th>
                      <th scope="col" className={list.money}>Item total</th><th scope="col" className={list.money}>Delivery</th>
                      <th scope="col" className={list.money}>Gateway</th><th scope="col" className={list.money}>Expected payout</th>
                      <th scope="col"><span className="sr-only">Parcels</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {transit.rows.map((r) => {
                      const id = r.seller._id;
                      const isOpen = !!open[`t:${id}`];
                      return [
                        <tr key={id} onClick={(e) => onRowClick(e, `t:${id}`)} aria-expanded={isOpen}>
                          <td>
                            <Link className={list.primary} href={`/sellers/${r.seller.slug || id}`}>{r.seller.name}</Link>
                            {r.totals.missing > 0 && <span className={styles.missing}><IconBang />{plural(r.totals.missing, 'charge')} to confirm</span>}
                          </td>
                          <td>{r.totals.orders}</td>
                          <td className={list.money}>{inr2(r.totals.itemTotal)}</td>
                          <td className={`${list.money} ${styles.deduct}`}>{minus(r.totals.courierCharge)}</td>
                          <td className={`${list.money} ${styles.deduct}`}>{minus(r.totals.gatewayCharge)}</td>
                          <td className={list.money}><strong>{inr2(r.totals.net)}</strong></td>
                          <td><div className={styles.rowEnd}><button type="button" className={styles.expand} aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} parcels for ${r.seller.name}`} onClick={() => toggle(`t:${id}`)}><IconChevronDown /></button></div></td>
                        </tr>,
                        isOpen && (
                          <tr key={`${id}-lines`} className={styles.linesRow}>
                            <td colSpan={7}><div className={styles.lines}><LinesTable lines={r.lines} mode="transit" onCharge={(l) => openCharge(id, r.seller.name, l)} /></div></td>
                          </tr>
                        ),
                      ];
                    })}
                  </tbody>
                </table>
              </div>
              <div className={list.cards}>
                {transit.rows.map((r) => {
                  const id = r.seller._id;
                  return (
                    <div key={id} className={list.card}>
                      <div className={list.cardTop}>
                        <div className="min-w-0"><Link className={list.primary} href={`/sellers/${r.seller.slug || id}`}>{r.seller.name}</Link><span className={list.sub}>{plural(r.totals.orders, 'parcel')} on the way</span></div>
                        <strong className="whitespace-nowrap text-[13px]">{inr2(r.totals.net)}</strong>
                      </div>
                      <div className="mt-3"><AdminButton variant="bordered" onPress={() => toggle(`t:${id}`)}>{open[`t:${id}`] ? 'Hide parcels' : 'Show parcels'}</AdminButton></div>
                      {open[`t:${id}`] && <CardLines lines={r.lines} mode="transit" onCharge={(l) => openCharge(id, r.seller.name, l)} />}
                    </div>
                  );
                })}
              </div>
            </>
          )
        )}

        {/* ── Paid ── */}
        {tab === 'history' && (
          historyError && !history ? (
            <ErrorState title="Couldn’t load paid settlements" message={historyError} onRetry={() => { setHistoryError(null); loadHistory(); }} />
          ) : history === null ? (
            <Skeleton />
          ) : history.length === 0 ? (
            <div className={list.state}>
              <span className={list.stateIcon}><IconPayout /></span>
              <h3>Nothing paid yet</h3>
              <p>Settlements you mark paid are listed here with their bank reference.</p>
            </div>
          ) : (
            <>
              <div className={list.tableWrap}>
                <table className={list.table}>
                  <caption className="sr-only">Paid settlements, newest first</caption>
                  <thead>
                    <tr>
                      <th scope="col">Seller</th><th scope="col">Week delivered</th><th scope="col">Parcels</th>
                      <th scope="col" className={list.money}>Net</th><th scope="col" className={list.money}>Paid</th><th scope="col">Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h._id} style={{ cursor: 'default' }}>
                        <td><Link className={list.primary} href={`/sellers/${h.seller?.slug || h.seller?._id || ''}`}>{h.seller?.storeName || h.seller?.name || '—'}</Link></td>
                        <td>{weekLabel(h.periodStart, h.periodEnd)}</td>
                        <td>{h.orders}</td>
                        <td className={list.money}>{inr2(h.net)}</td>
                        <td className={list.money}><strong>{inr2(h.amountPaid)}</strong>{Math.abs(h.amountPaid - h.net) >= 0.01 && <span className={list.sub}>differs from net</span>}</td>
                        <td><span className={list.primary}>{h.utr || '—'}</span><span className={list.sub}>{formatDateTime(h.paidAt)}{h.paidByEmail ? ` · ${h.paidByEmail}` : ''}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className={list.cards}>
                {history.map((h) => (
                  <div key={h._id} className={list.card}>
                    <div className={list.cardTop}>
                      <div className="min-w-0"><span className={list.primary}>{h.seller?.storeName || h.seller?.name || '—'}</span><span className={list.sub}>{weekLabel(h.periodStart, h.periodEnd)}</span></div>
                      <strong className="whitespace-nowrap text-[13px]">{inr2(h.amountPaid)}</strong>
                    </div>
                    <dl className={list.cardGrid}>
                      <div><dt>Reference</dt><dd>{h.utr || '—'}</dd></div>
                      <div><dt>Paid</dt><dd>{formatDate(h.paidAt)}</dd></div>
                    </dl>
                  </div>
                ))}
              </div>
            </>
          )
        )}
      </section>

      {/* Mark paid */}
      <Modal isOpen={!!paying} onClose={() => !payBusy && setPaying(null)} placement="center" size="lg" hideCloseButton classNames={{ base: modal.modal, backdrop: modal.backdrop }}>
        <ModalContent>
          {paying && data && (
            <>
              <ModalHeader className={modal.header}>
                <span className={`${modal.icon} ${modal.positive}`}><IconPayout /></span>
                <div className="min-w-0 flex-1">
                  <div className={modal.eyebrow}>Record payment</div>
                  <div className={modal.title}>{paying.seller.name} · {weekLabel(data.week.periodStart, data.week.periodEnd)}</div>
                  <div className={modal.sub}>Do the bank transfer first, then record it here. The parcels below are frozen into this settlement and the seller sees the week as paid.</div>
                </div>
                <button type="button" className={modal.close} onClick={() => setPaying(null)} disabled={payBusy} aria-label="Close"><IconClose /></button>
              </ModalHeader>
              <ModalBody className={modal.body}>
                <dl className={styles.facts}>
                  <div><dt>Parcels delivered</dt><dd>{paying.totals.orders}</dd></div>
                  <div><dt>Item total</dt><dd>{inr2(paying.totals.itemTotal)}</dd></div>
                  <div><dt>Delivery, gateway and refunds</dt><dd>{minus(paying.totals.courierCharge + paying.totals.gatewayCharge + paying.totals.refunds)}</dd></div>
                  <div className={styles.net}><dt>Net due</dt><dd>{inr2(paying.totals.net)}</dd></div>
                  <div><dt>Pay to</dt><dd>{paying.seller.bank ? `${paying.seller.bank.accountHolder} · ${paying.seller.bank.bankName} ···${paying.seller.bank.last4} · ${paying.seller.bank.ifsc}` : <span className={styles.danger}>No bank details on file</span>}</dd></div>
                </dl>
                {paying.totals.missing > 0 && (
                  <div className={modal.callout} role="note"><strong>{plural(paying.totals.missing, 'parcel')} still missing a delivery charge.</strong> Set them first, or the seller is paid too much — a paid week can’t be corrected later.</div>
                )}
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <AdminInput label="Amount transferred (₹)" type="number" inputMode="decimal" variant="bordered" isRequired value={payForm.amountPaid} onChange={(e) => setPayForm({ ...payForm, amountPaid: e.target.value })} description="Normally the net due; change it only if you rounded." />
                  <AdminInput label="Bank reference (UTR)" variant="bordered" isRequired autoComplete="off" value={payForm.utr} onChange={(e) => setPayForm({ ...payForm, utr: e.target.value })} description="From your bank’s transfer confirmation." />
                  <AdminInput label="Note" variant="bordered" className="sm:col-span-2" placeholder="Optional — visible to the seller" value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })} />
                </div>
              </ModalBody>
              <ModalFooter className={modal.footer}>
                <AdminButton variant="bordered" onPress={() => setPaying(null)} isDisabled={payBusy}>Cancel</AdminButton>
                <AdminButton color="primary" isLoading={payBusy} isDisabled={!(Number(payForm.amountPaid) > 0)} onPress={submitPay}>Mark paid</AdminButton>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Set / edit delivery charge */}
      <Modal isOpen={!!charging} onClose={() => !chargeBusy && setCharging(null)} placement="center" size="lg" hideCloseButton classNames={{ base: modal.modal, backdrop: modal.backdrop }}>
        <ModalContent>
          {charging && (
            <>
              <ModalHeader className={modal.header}>
                <span className={`${modal.icon} ${modal.info}`}><IconTruck /></span>
                <div className="min-w-0 flex-1">
                  <div className={modal.eyebrow}>Delivery charge</div>
                  <div className={modal.title}>{charging.line.orderNumber} · {charging.sellerName}</div>
                  <div className={modal.sub}>What the courier charged for this parcel{charging.line.courierName ? ` (${charging.line.courierName})` : ''}. It comes off the seller’s payout.</div>
                </div>
                <button type="button" className={modal.close} onClick={() => setCharging(null)} disabled={chargeBusy} aria-label="Close"><IconClose /></button>
              </ModalHeader>
              <ModalBody className={modal.body}>
                <AdminInput label="Charge (₹)" type="number" inputMode="decimal" variant="bordered" isRequired value={chargeForm.total} onChange={(e) => setChargeForm({ ...chargeForm, total: e.target.value })} description="Freight as billed by the courier, including GST." />
                <AdminInput label="Note" variant="bordered" placeholder="Optional — e.g. from courier invoice INV-2231" value={chargeForm.note} onChange={(e) => setChargeForm({ ...chargeForm, note: e.target.value })} />
              </ModalBody>
              <ModalFooter className={modal.footer}>
                <AdminButton variant="bordered" onPress={() => setCharging(null)} isDisabled={chargeBusy}>Cancel</AdminButton>
                <AdminButton color="primary" isLoading={chargeBusy} isDisabled={chargeForm.total === '' || !(Number(chargeForm.total) >= 0)} onPress={submitCharge}>Save charge</AdminButton>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

/** One row per parcel — delivered ones inside a week, or the ones still on the way. */
function LinesTable({ lines, mode, onCharge }: { lines: Line[]; mode: 'week' | 'transit'; onCharge?: (l: Line) => void }) {
  return (
    <table className={styles.linesTable}>
      <thead>
        <tr>
          <th>Order</th><th>{mode === 'transit' ? 'Status' : 'Delivered'}</th>
          <th className={styles.num}>Items</th><th className={styles.num}>Delivery</th>
          <th className={styles.num}>Gateway</th><th className={styles.num}>Refunds</th>
          <th className={styles.num}>Net</th>{onCharge && <th />}
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.orderNumber}>
            <td>
              <Link className={list.primary} href={`/orders/${l.orderNumber}`}>{l.orderNumber}</Link>
              <span className={list.sub}>{l.paymentMethod === 'cod' ? 'Cash on delivery' : 'Online'}{l.courierName ? ` · ${l.courierName}` : ''}</span>
            </td>
            <td>{mode === 'transit' ? <StatusChip label={transitLabel(l.status).label} status={transitLabel(l.status).status} /> : l.deliveredAt ? formatDateTime(l.deliveredAt) : '—'}</td>
            <td className={styles.num}>{inr2(l.itemTotal)}</td>
            <td className={`${styles.num} ${styles.deduct}`}>{l.courierCharge == null ? <span className={styles.warn}>missing</span> : minus(l.courierCharge)}</td>
            <td className={`${styles.num} ${styles.deduct}`}>{l.flags.includes('gateway_fee_missing') ? <span className={styles.warn}>missing</span> : minus(l.gatewayCharge)}</td>
            <td className={`${styles.num} ${styles.deduct}`}>{minus(l.refunds)}</td>
            <td className={styles.num}><strong>{inr2(l.net)}</strong></td>
            {onCharge && (
              <td className={styles.num}>
                <button type="button" className={`${styles.setCharge} ${l.courierCharge == null ? styles.setChargeWarn : ''}`} onClick={() => onCharge(l)}>
                  {l.courierCharge == null ? 'Set delivery charge' : 'Edit charge'}
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The same parcels as a list, for the card layout on narrow panels. */
function CardLines({ lines, mode, onCharge }: { lines: Line[]; mode: 'week' | 'transit'; onCharge?: (l: Line) => void }) {
  return (
    <div className={styles.cardLines}>
      {lines.map((l) => (
        <div key={l.orderNumber} className={styles.cardLine}>
          <div className="min-w-0">
            <Link className={list.primary} href={`/orders/${l.orderNumber}`}>{l.orderNumber}</Link>
            <small>
              {mode === 'transit' ? transitLabel(l.status).label : l.deliveredAt ? `Delivered ${formatDate(l.deliveredAt)}` : '—'}
              {' · '}{l.courierCharge == null ? <span className={styles.warn}>delivery charge missing</span> : `delivery ${inr2(l.courierCharge)}`}
            </small>
            {onCharge && <button type="button" className={`${styles.setCharge} mt-1.5 ${l.courierCharge == null ? styles.setChargeWarn : ''}`} onClick={() => onCharge(l)}>{l.courierCharge == null ? 'Set delivery charge' : 'Edit charge'}</button>}
          </div>
          <strong className="whitespace-nowrap">{inr2(l.net)}</strong>
        </div>
      ))}
    </div>
  );
}

function ErrorState({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <div className={list.state} role="alert">
      <span className={`${list.stateIcon} ${list.errorIcon}`}><IconAlert /></span>
      <h3>{title}</h3>
      <p>{message}</p>
      <button type="button" className={list.stateAction} onClick={onRetry}>Try again</button>
    </div>
  );
}
function Skeleton() {
  return <div className={list.skeleton} role="status" aria-label="Loading"><span /><span /><span /><span /></div>;
}

const svg = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
function IconChevron({ flip }: { flip?: boolean }) { return <svg {...svg} style={flip ? { transform: 'scaleX(-1)' } : undefined}><polyline points="9 6 15 12 9 18" /></svg>; }
function IconChevronDown() { return <svg {...svg}><polyline points="6 9 12 15 18 9" /></svg>; }
function IconClose() { return <svg {...svg} width="14" height="14"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>; }
function IconBang() { return <svg {...svg} width="12" height="12" strokeWidth={2.4}><circle cx="12" cy="12" r="9" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>; }
function IconAlert() { return <svg {...svg}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>; }
function IconPayout() { return <svg {...svg}><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></svg>; }
function IconTruck() { return <svg {...svg}><rect x="1" y="5" width="13" height="11" rx="1" /><path d="M14 9h4l3 3v4h-7z" /><circle cx="5.5" cy="18.5" r="1.5" /><circle cx="17.5" cy="18.5" r="1.5" /></svg>; }
