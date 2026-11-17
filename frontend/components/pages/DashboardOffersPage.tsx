'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Switch } from '@heroui/react';
import { RowActions, TablePagination } from '@/components/ui';
import { api, unwrapMeta } from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import styles from './DashboardOffers.module.css';
import { notifySuccess, notifyWarning, apiMessage } from '@/lib/notify';
import { M } from '@/lib/messages';

type ProductSummary = {
  _id: string;
  name: string;
  slug?: string;
  listingImage?: string;
  image?: string;
};

type Offer = {
  _id: string;
  title: string;
  description?: string;
  discountType: 'percent' | 'flat';
  discountValue: number;
  maxDiscount?: number | null;
  minCartAmount?: number | null;
  scope: 'all' | 'selected';
  products?: string[];
  productSummaries?: ProductSummary[];
  catalogSize?: number;
  startsAt?: string | null;
  endsAt?: string | null;
  enabled: boolean;
  isLive?: boolean;
  createdAt?: string;
};

type StatusFilter = 'all' | 'enabled' | 'disabled';

const PAGE_SIZE = 20;

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);

function formatDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  });
}

/**
 * Derive the validity tone + label. Sellers care about "is this live NOW"
 * more than any exact date, so we bias toward action-oriented copy.
 */
function validityChip(o: Offer): { label: string; tone: 'emerald' | 'amber' | 'slate' | 'rose' } {
  const now = Date.now();
  const start = o.startsAt ? new Date(o.startsAt).getTime() : null;
  const end = o.endsAt ? new Date(o.endsAt).getTime() : null;
  if (!o.enabled) return { label: 'Disabled', tone: 'slate' };
  if (end != null && end < now) return { label: `Ended ${formatDate(o.endsAt)}`, tone: 'rose' };
  if (start != null && start > now) return { label: `Starts ${formatDate(o.startsAt)}`, tone: 'amber' };
  if (start == null && end == null) return { label: 'Always on', tone: 'emerald' };
  if (end != null) return { label: `Live · ends ${formatDate(o.endsAt)}`, tone: 'emerald' };
  return { label: 'Live', tone: 'emerald' };
}


export default function DashboardOffersPage() {
  const [items, setItems] = useState<Offer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const pending = useRef(new Set<string>());
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => { setSearch(searchInput); setPage(1); }, 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(() => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    const params = { page, limit: PAGE_SIZE, ...(status !== 'all' ? { status } : {}), ...(search.trim() ? { q: search.trim() } : {}) };
    return api.get('/seller/offers', { params, signal: controller.signal })
      .then((r) => {
        if (controller.signal.aborted) return;
        const { data, meta } = unwrapMeta<{ items?: any[] }>(r);
        const count = meta?.totalItems || 0;
        const last = Math.max(1, Math.ceil(count / PAGE_SIZE));
        if (page > last) { setPage(last); return; }
        setItems(Array.isArray(data.items) ? data.items : []);
        setTotal(count);
      })
      .catch(failure => {
        if (!controller.signal.aborted) setError(apiMessage(failure) || 'Could not load offers. Please try again.');
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
  }, [page, status, search]);

  useEffect(() => {
    // The request synchronizes server data and its loading state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => request.current?.abort();
  }, [load]);

  async function toggleOne(offer: Offer) {
    if (pending.current.has(offer._id)) return;
    pending.current.add(offer._id);
    setBusy(new Set(pending.current));
    try {
      await api.patch('/seller/offers/' + offer._id + '/toggle');
      notifySuccess(M.offers.offerToggled(offer.enabled));
      await load();
    } catch {
      notifyWarning(M.offers.couldNotUpdateOfferPleaseTryAgain);
    } finally {
      pending.current.delete(offer._id);
      setBusy(new Set(pending.current));
    }
  }

  async function removeOne(offer: Offer) {
    if (!(await confirmDialog({ title: 'Delete “' + offer.title + '”?', message: 'This offer will be permanently removed and will no longer apply at checkout.', destructive: true, confirmLabel: 'Delete offer' }))) return;
    try {
      await api.delete('/seller/offers/' + offer._id);
      notifySuccess(M.offers.offerDeleted);
      await load();
    } catch { notifyWarning(M.offers.couldNotDeleteOfferPleaseTryAgain); }
  }

  function clearFilters() { setSearchInput(''); setSearch(''); setStatus('all'); setPage(1); }
  const filtered = !!search.trim() || status !== 'all';
  return <div className={styles.page}>
    <h1 className="sr-only">Offers & discounts</h1>
      {(loading || error || filtered || items.length > 0) && <div className="flex flex-wrap items-center justify-end gap-3 mb-5"><Link className={styles.primary} href="/dashboard/offers/new"><span aria-hidden="true">+</span> Create offer</Link></div>}
    <section className={styles.workspace} aria-label="Your offers" aria-busy={loading}>
      <div className={`seller-tab-row ${styles.filters}`} aria-label="Offer status">
        {(['all', 'enabled', 'disabled'] as const).map(value => <button key={value} aria-pressed={status === value} onClick={() => { setStatus(value); setPage(1); }}>{value === 'all' ? 'All offers' : value === 'enabled' ? 'Enabled' : 'Disabled'}</button>)}
        <span className={styles.count}>{loading ? 'Updating…' : error ? 'Unavailable' : total + (total === 1 ? ' offer' : ' offers')}</span>
      </div>
      <div className={styles.toolbar}>
        <label className={styles.search}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></svg><input aria-label="Search offers" type="search" placeholder="Search offer title…" value={searchInput} onChange={event => setSearchInput(event.target.value)} /></label>
        {(searchInput || status !== 'all') && <button className={styles.clear} onClick={clearFilters}>Clear filters</button>}
      </div>
      {loading ? <div className={styles.empty} role="status"><h3>Loading offers…</h3><p>Fetching your latest promotions.</p></div>
        : error ? <div className={styles.empty} role="alert"><h3>Offers unavailable</h3><p>{error}</p><button className={styles.primary} onClick={() => void load()}>Try again</button></div>
        : !items.length ? <div className={styles.empty}>
          <span className={styles.emptyIcon} aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><path d="M3 3h8l10 10-8 8L3 11Z" /><circle cx="7.5" cy="7.5" r="1" /></svg></span>
          <h3>{filtered ? 'No offers match your filters' : 'Create your first offer'}</h3>
          <p>{filtered ? 'Try a different title or clear the filters to see all offers.' : 'Choose a percentage or fixed discount for your catalogue or selected products. Set a schedule when you’re ready.'}</p>
          {filtered ? <button className={styles.primary} onClick={clearFilters}>Clear filters</button> : <Link className={styles.primary} href="/dashboard/offers/new">Create offer</Link>}
        </div>
        : <><div className={styles.rows}>{items.map(offer => {
          const validity = validityChip(offer);
          return <article key={offer._id} className={styles.offer}>
            <div className={styles.discount}><strong>{offer.discountType === 'percent' ? offer.discountValue + '%' : '₹' + inr(offer.discountValue)}</strong><span>OFF</span></div>
            <div className={styles.offerBody}>
              <div className={styles.title}><Link href={'/dashboard/offers/' + offer._id}>{offer.title}</Link><span className={styles.badge} data-tone={validity.tone}>{validity.label}</span></div>
              {offer.description && <p className={styles.description}>{offer.description}</p>}
              <dl className={styles.details}>
                <div><dt>Applies to</dt><dd>{offer.scope === 'all' ? 'All products' : (offer.products?.length ?? offer.productSummaries?.length ?? 0) + ' products'}</dd></div>
                <div><dt>Minimum cart</dt><dd>{offer.minCartAmount ? '₹' + inr(offer.minCartAmount) : 'No minimum'}</dd></div>
                {offer.discountType === 'percent' && !!offer.maxDiscount && <div><dt>Discount limit</dt><dd>₹{inr(offer.maxDiscount)}</dd></div>}
                <div><dt>Schedule</dt><dd>{offer.startsAt ? formatDate(offer.startsAt) : 'No start date'} · {offer.endsAt ? 'Ends ' + formatDate(offer.endsAt) : 'No end date'}</dd></div>
              </dl>
            </div>
            <div className={styles.actions}>
              <Switch size="sm" isSelected={offer.enabled} isDisabled={busy.has(offer._id)} onValueChange={() => void toggleOne(offer)} aria-label={(offer.enabled ? 'Disable ' : 'Enable ') + offer.title}>{busy.has(offer._id) ? 'Updating…' : offer.enabled ? 'Enabled' : 'Disabled'}</Switch>
              <RowActions ariaLabel={'Actions for ' + offer.title} primary={{ label:'Edit offer', href:'/dashboard/offers/' + offer._id }} items={[{key:'delete',label:'Delete offer…',tone:'danger',onSelect:() => void removeOne(offer)}]} />
            </div>
          </article>;
        })}</div><div className={styles.footer}><TablePagination noun="offers" page={page} pages={Math.max(1, Math.ceil(total / PAGE_SIZE))} pageSize={PAGE_SIZE} total={total} onChange={setPage} /></div></>}
    </section>
    <p className={styles.note}>Enabled offers follow their schedule. Future and ended offers do not apply at checkout.</p>
  </div>;
}
