'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import Arrow from '@/components/common/Arrow';
import { isAxiosError } from 'axios';
import { StatusChip } from '@/components/ui';
import { api, unwrap } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/dates';
import { readListCache, writeListCache } from '@/lib/listCache';
import { inr2, transitLabel, weekLabel, type PayoutLine, type PayoutSummary, type PayoutWeek } from '@/lib/payouts';
import styles from './DashboardPayouts.module.css';
import { apiMessage } from '@/lib/notify';

type Tab = 'due' | 'paid' | 'all';
const STATUS = {
  in_progress: { label: 'This week', status: 'pending' },
  due: { label: 'Waiting to be paid', status: 'processing' },
  paid: { label: 'Paid', status: 'delivered' },
};

export default function DashboardPayoutsPage() {
  const [data, setData] = useState<PayoutSummary | null>(() => readListCache<PayoutSummary>('seller-payouts'));
  const [loading, setLoading] = useState(!data);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('due');
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = unwrap<PayoutSummary>(await api.get('/seller/payouts', { signal }));
      if (signal?.aborted) return;
      setData(next);
      writeListCache('seller-payouts', next);
      setError(null);
    } catch (failure) {
      if (signal?.aborted) return;
      setError(isAxiosError(failure) ? apiMessage(failure) || 'Couldn’t load your payouts. Please try again.' : 'Couldn’t load your payouts. Please try again.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    // State changes occur after the external request resolves, never synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const weeks = [...(data?.weeks ?? [])].sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  const shown = weeks.filter(w => tab === 'all' || (tab === 'paid' ? w.status === 'paid' : w.status !== 'paid'));
  const missing = weeks.filter(w => w.status !== 'paid').reduce((sum, w) => sum + w.totals.missing, 0);
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'due', label: 'Upcoming', count: weeks.filter(w => w.status !== 'paid').length },
    { id: 'paid', label: 'Paid', count: weeks.filter(w => w.status === 'paid').length },
    { id: 'all', label: 'All weeks', count: weeks.length },
  ];
  function retry() { setLoading(true); void load(); }

  return (
    <div className={styles.page}>
      <h1 className="sr-only">Payouts</h1>

      {error && <div className={styles.notice} role="alert"><span>{data ? 'Showing saved payouts. ' : ''}{error}</span><button className={styles.darkButton} disabled={loading} onClick={retry}>{loading ? 'Retrying…' : 'Try again'}</button></div>}

      <section className={styles.summary} aria-label="Earnings summary" aria-busy={loading}>
        <div className={styles.highlight}><p>Waiting to be paid</p><strong>{data ? inr2(data.due) : '—'}</strong><span>Completed weeks awaiting transfer</span></div>
        <div><p>This week so far</p><strong>{data ? inr2(data.thisWeek?.totals.net ?? 0) : '—'}</strong><span>{data?.thisWeek ? `${data.thisWeek.totals.orders} delivered · settles next week` : 'Earnings from deliveries this week'}</span></div>
        <div><p>Total paid to you</p><strong>{data ? inr2(data.paidLifetime) : '—'}</strong><span>All completed settlements</span></div>
      </section>

      {missing > 0 && <p className={styles.notice}>{missing} parcel{missing === 1 ? '' : 's'} awaiting confirmed charges. Upcoming payout amounts may change once those charges arrive.</p>}

      <section className={styles.workspace} aria-label="Payout history">
        <div className={styles.sectionHeader}><div><h2>Payout history</h2><p>Weekly settlements, with a breakdown for every order.</p></div><span className={styles.schedule}>Weekly settlement</span></div>
        <div className={`seller-tab-row ${styles.filters}`} aria-label="Filter payout weeks">
          {tabs.map(t => <button key={t.id} aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>{t.label}<span>{data ? t.count : '—'}</span></button>)}
        </div>
        {loading && !data ? <div className={styles.empty} role="status"><h3>Loading your payouts…</h3><p>Fetching your earnings and settlement history.</p></div>
          : !data && error ? <div className={styles.empty}><h3>Payouts unavailable</h3><p>Use Try again above to reload your settlement history.</p></div>
          : !shown.length ? <div className={styles.empty}><span className={styles.emptyIcon}>₹</span><h3>{tab === 'paid' ? 'No paid settlements yet' : tab === 'due' ? 'No upcoming payouts' : 'Your payout history starts here'}</h3><p>{tab === 'paid' ? 'Completed transfers will appear here with their bank reference.' : 'Earnings appear in the week an order is delivered.'}</p>{tab !== 'all' && weeks.length > 0 && <button className={styles.darkButton} onClick={() => setTab('all')}>View all weeks</button>}</div>
          : <div>
            <div className={styles.columnHead} aria-hidden="true"><span>Delivery week</span><span>Status</span><span>You receive</span><span>Breakdown</span></div>
            {shown.map(week => <Week key={week.weekKey} week={week} />)}
            <footer className={styles.footer}>Showing {shown.length} {shown.length === 1 ? 'week' : 'weeks'}<span>Newest first</span></footer>
          </div>}
      </section>

      {!!data?.inTransit?.lines.length && <details className={styles.transit}>
        <summary><div><h2>Orders on the way <span>{data.inTransit.totals.orders}</span></h2><p>Added to a settlement once delivered.</p></div><div><strong>{inr2(data.inTransit.totals.net)}</strong><span>Estimated earnings · View orders</span></div></summary>
        <div className={styles.details}><WeekLines lines={data.inTransit.lines} mode="transit" /></div>
      </details>}

      <details className={styles.explainer}><summary>How your payout is calculated <Chevron /></summary><div><p>Item total − delivery charges − payment gateway fees − refunds = your payout.</p><p>Delivery charges come from the courier and include COD charges for cash-on-delivery orders. Payment gateway fees apply only to online payments and are split by your share of the order.</p><p>Unconfirmed charges can change the amount shown before settlement.</p></div></details>
    </div>
  );
}

function Week({ week: w }: { week: PayoutWeek }) {
  return <details className={styles.week}>
    <summary className={styles.weekSummary}>
      <div><h3>{weekLabel(w.periodStart, w.periodEnd)}</h3><p>{w.totals.orders} delivered {w.totals.orders === 1 ? 'order' : 'orders'}</p></div>
      <div><StatusChip {...STATUS[w.status]} />{w.settlement && <p>Paid {formatDate(w.settlement.paidAt)}</p>}</div>
      <strong className={styles.net}>{inr2(w.totals.net)}</strong>
      <span className={styles.view}><span className={styles.closedLabel}>View details</span><span className={styles.openLabel}>Hide details</span><Chevron /></span>
    </summary>
    <div className={styles.details}>
      <dl className={styles.breakdown}>
        <div><dt>Item total</dt><dd>{inr2(w.totals.itemTotal)}</dd></div>
        <div><dt>Delivery charges</dt><dd>− {inr2(w.totals.courierCharge)}</dd></div>
        <div><dt>Payment gateway</dt><dd>− {inr2(w.totals.gatewayCharge)}</dd></div>
        <div><dt>Refunds</dt><dd>− {inr2(w.totals.refunds)}</dd></div>
        <div><dt>You receive</dt><dd>{inr2(w.totals.net)}</dd></div>
      </dl>
      {w.settlement && <div className={styles.settlement}><strong>Transfer details</strong><span>Amount paid: {inr2(w.settlement.amountPaid)}</span><span>Bank reference: {w.settlement.utr || 'Not provided'}</span>{w.settlement.note && <span>{w.settlement.note}</span>}</div>}
      {w.totals.missing > 0 && <p className={styles.pending}>Some parcel charges are awaiting confirmation.</p>}
      <WeekLines lines={w.lines} />
    </div>
  </details>;
}

function WeekLines({ lines, mode = 'week' }: { lines: PayoutLine[]; mode?: 'week' | 'transit' }) {
  return <div className={styles.parcels}>
    {lines.map(l => <article key={l.orderId || l.orderNumber} className={styles.parcel}>
      <div className={styles.parcelHeading}><div><Link href={`/dashboard/orders/${l.orderNumber}`}>{l.orderNumber} <Arrow /></Link><p>{l.paymentMethod === 'cod' ? 'Cash on delivery' : 'Online payment'}{l.courierName ? ` · ${l.courierName}` : ''}</p></div>
        {mode === 'transit' ? <StatusChip {...transitLabel(l.status)} /> : <span>Delivered {l.deliveredAt ? formatDateTime(l.deliveredAt) : '—'}</span>}
      </div>
      <dl className={styles.breakdown}>
        <div><dt>Items</dt><dd>{inr2(l.itemTotal)}</dd></div>
        <div><dt>Delivery</dt><dd>{l.courierCharge == null ? 'To confirm' : `− ${inr2(l.courierCharge)}`}</dd></div>
        <div><dt>Gateway</dt><dd>{l.flags.includes('gateway_fee_missing') ? 'To confirm' : `− ${inr2(l.gatewayCharge)}`}</dd></div>
        <div><dt>Refunds</dt><dd>− {inr2(l.refunds)}</dd></div>
        <div><dt>You receive</dt><dd>{inr2(l.net)}</dd></div>
      </dl>
    </article>)}
  </div>;
}

function Chevron() {
  return <svg className={styles.chevron} aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>;
}
