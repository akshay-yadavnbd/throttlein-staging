"use client";

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import SellerSelect from '@/components/common/SellerSelect';
import SellerOrdersTabs from '@/components/common/SellerOrdersTabs';
import { EmptyState, ErrorState, StatusChip, TableSkeleton, TablePagination } from '@/components/ui';
import { useSellerQueue } from '@/lib/useSellerQueue';
import { formatDateTime } from '@/lib/dates';
import base from './DashboardOrders.module.css';
import styles from './SellerOrderQueues.module.css';

type Row = {
  orderNumber: string;
  customer: string;
  reqId: string;
  kind: 'return' | 'exchange';
  status: 'pending' | 'approved' | 'declined' | 'completed' | 'cancelled';
  reason: string;
  reasonCode: string;
  desiredAction: string;
  items: { name: string; size?: string; quantity: number }[];
  attachments?: { url: string; kind: 'image' | 'video' }[];
  requestedAt: string;
  decisionAt?: string | null;
  decisionReason?: string;
};


const STATUS_LABEL: Record<Row['status'], string> = {
  pending: 'Pending review', approved: 'Approved', declined: 'Declined', completed: 'Completed', cancelled: 'Cancelled',
};
const FILTERS = [
  { key: 'pending', label: 'Pending review' }, { key: 'all', label: 'All requests' },
  { key: 'approved', label: 'Approved' }, { key: 'completed', label: 'Completed' },
  { key: 'declined', label: 'Declined' }, { key: 'cancelled', label: 'Cancelled' },
] as const;
type Filter = typeof FILTERS[number]['key'];

function itemSummary(items: Row['items']) {
  if (!items?.length) return 'No product details';
  const first = `${items[0].name}${items[0].size ? ` · ${items[0].size}` : ''} ×${items[0].quantity}`;
  return items.length > 1 ? `${first} +${items.length - 1} more` : first;
}
function requestReason(row: Row) {
  return row.reason || row.reasonCode?.replace(/[_-]/g, ' ') || 'No reason provided';
}

export default function DashboardReturnRequestsPage() {
  const router = useRouter();
  const { rows, loading, error, refreshError, retry } = useSellerQueue<Row>('/seller/return-requests', 'requests', 'seller-returns');
  const [tab, setTab] = useState<Filter>('pending');
  const [kind, setKind] = useState('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const searched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter(row => (kind === 'all' || row.kind === kind) &&
      [row.orderNumber, row.customer, row.reason, row.reasonCode, ...(row.items || []).map(item => item.name)]
        .some(value => (value || '').toLowerCase().includes(needle)));
  }, [rows, kind, query]);
  const visible = useMemo(() => searched.filter(row => tab === 'all' || row.status === tab).sort((a, b) =>
    Number(b.status === 'pending') - Number(a.status === 'pending') || Date.parse(b.requestedAt) - Date.parse(a.requestedAt)), [searched, tab]);
  const pages = Math.max(1, Math.ceil(visible.length / 15));
  const activePage = Math.min(page, pages);
  const paginated = visible.slice((activePage - 1) * 15, activePage * 15);
  const filtered = query.trim() !== '' || kind !== 'all' || tab !== 'pending';
  function clearFilters() { setQuery(''); setKind('all'); setTab('pending'); setPage(1); }

  return <><div className={base.page}>
    <h1 className="sr-only">Returns &amp; exchanges</h1>
    <SellerOrdersTabs active="returns" />
    {refreshError && <div className={styles.refreshNotice} role="status">Couldn’t refresh requests. Showing the last saved list.<button type="button" onClick={retry}>Try again</button></div>}
    <section className={base.workspace} aria-label="Return and exchange request list">
      <div className={base.listHeader}><div><h2>Customer requests <span>{loading || error ? '—' : rows.length}</span></h2><p>Open a request to review the details and evidence.</p></div>
        <div className={base.period}><span>Request type</span><SellerSelect ariaLabel="Request type" value={kind} onChange={value => { setKind(value); setPage(1); }} options={[{ value: 'all', label: 'All types' }, { value: 'return', label: 'Returns' }, { value: 'exchange', label: 'Exchanges' }]} /></div>
      </div>
      <div className={`seller-tab-row ${base.stageFilters}`} role="group" aria-label="Filter requests by status">{FILTERS.map(filter => <button type="button" key={filter.key} aria-pressed={tab === filter.key} onClick={() => { setTab(filter.key); setPage(1); }}>{filter.label}<span>{loading || error ? '—' : filter.key === 'all' ? searched.length : searched.filter(row => row.status === filter.key).length}</span></button>)}</div>
      <div className={base.toolbar}><label className={base.search}><svg aria-hidden width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="10.5" cy="10.5" r="7" /><path d="m16 16 5 5" /></svg><span className="sr-only">Search return and exchange requests</span><input type="search" placeholder="Search order, customer or product…" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} /></label>
        <div className={base.results} aria-live="polite">{loading ? 'Loading requests…' : error ? 'Requests unavailable' : `${visible.length} ${visible.length === 1 ? 'request' : 'requests'}`}{filtered && <button className={base.clearFilters} type="button" onClick={clearFilters}>Clear filters <span aria-hidden>×</span></button>}</div>
      </div>
      {error ? <ErrorState title="We couldn’t load customer requests" message={error} onRetry={retry} /> : loading ? <div role="status" aria-label="Loading customer requests"><TableSkeleton columns={6} rows={4} /></div> : visible.length === 0 ? <EmptyState
        title={query.trim() || kind !== 'all' ? 'No requests match your filters' : tab === 'pending' ? 'Nothing to review right now' : 'No requests in this status'}
        description={query.trim() || kind !== 'all' ? 'Try another search or include both returns and exchanges.' : tab === 'pending' ? 'New return and exchange requests will appear here. You can still view requests you’ve already handled.' : 'Choose another status or view all customer requests.'}
        filtered={Boolean(query.trim() || kind !== 'all')}
        action={query.trim() || kind !== 'all' ? <button className={base.darkLink} type="button" onClick={clearFilters}>Clear filters</button> : tab === 'all' ? <Link className={styles.textLink} href="/dashboard/orders">Back to orders →</Link> : <button className={base.darkLink} type="button" onClick={() => { setTab('all'); setPage(1); }}>View all requests</button>}
      /> : <>
        <div className={base.desktopTable}><table className={`${styles.queueTable} ${styles.returnTable}`}>
          <caption className="sr-only">Seller return and exchange requests: {tab}</caption>
          <thead><tr>{['Order / submitted', 'Customer / products', 'Type', 'Reason / evidence', 'Status', 'Next step'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{paginated.map(row => <tr key={row.reqId} className={styles.clickableRow} onClick={event => {
            if ((event.target as HTMLElement).closest('a, button')) return;
            const href = `/dashboard/return-requests/${row.reqId}`;
            if (event.ctrlKey || event.metaKey) window.open(href, '_blank', 'noopener');
            else router.push(href);
          }}>
            <th scope="row"><Link className={styles.orderLink} href={`/dashboard/return-requests/${row.reqId}`}>{row.orderNumber}</Link><small>{formatDateTime(row.requestedAt)}</small></th>
            <td><p>{row.customer || 'Customer not provided'}</p><small className={styles.itemSummary} title={itemSummary(row.items)}>{itemSummary(row.items)}</small></td>
            <td><span className={styles.kind}>{row.kind === 'exchange' ? 'Exchange' : 'Return'}</span></td>
            <td><p className={styles.reason}>{requestReason(row)}</p><small>{row.attachments?.length ? `${row.attachments.length} ${row.attachments.length === 1 ? 'attachment' : 'attachments'}` : 'No attachments'}</small></td>
            <td><StatusChip label={STATUS_LABEL[row.status] || row.status} status={row.status} /></td>
            <td><Link className={base.darkLink} aria-label={`${row.status === 'pending' ? 'Review' : 'View'} request for ${row.orderNumber}`} href={`/dashboard/return-requests/${row.reqId}`}>{row.status === 'pending' ? 'Review request' : 'View request'}</Link></td>
          </tr>)}</tbody>
        </table></div>
        <div className={base.mobileOrders}>{paginated.map(row => <article className={`${base.mobileOrder} ${styles.returnCard}`} key={row.reqId} aria-label={`Request for ${row.orderNumber}`}>
          <div className={base.mobileTop}><Link className={styles.orderLink} href={`/dashboard/return-requests/${row.reqId}`}>{row.orderNumber}</Link><StatusChip label={STATUS_LABEL[row.status] || row.status} status={row.status} /></div>
          <p className={styles.secondary}>{row.customer || 'Customer not provided'} · {formatDateTime(row.requestedAt)}</p>
          <dl><div><dt>Products</dt><dd>{itemSummary(row.items)}</dd></div><div><dt>Reason</dt><dd>{requestReason(row)}</dd></div><div><dt>Request type</dt><dd>{row.kind === 'exchange' ? 'Exchange' : 'Return'}</dd></div><div><dt>Evidence</dt><dd>{row.attachments?.length ? `${row.attachments.length} attachments` : 'No attachments'}</dd></div></dl>
          <div className={base.mobileActions}><Link className={base.darkLink} aria-label={`${row.status === 'pending' ? 'Review' : 'View'} request for ${row.orderNumber}`} href={`/dashboard/return-requests/${row.reqId}`}>{row.status === 'pending' ? 'Review request' : 'View request'}</Link></div>
        </article>)}</div>
        <footer className={base.listFooter}>{pages > 1 ? <TablePagination noun="requests" onChange={setPage} page={activePage} pages={pages} pageSize={15} total={visible.length} /> : <p>Showing {visible.length} {visible.length === 1 ? 'request' : 'requests'}</p>}</footer>
      </>}
    </section>
  </div></>;
}
