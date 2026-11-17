'use client';

/**
 * Admin — customer carts (abandoned-cart view), in the workspace list layout.
 * One row per non-empty cart: who, what's in it (with stock/availability
 * warnings), the estimated value and when it was last touched. Search,
 * an "idle for 24h+" filter, a CSV export of the current page, and quiet
 * polling every 30 s.
 *
 * Data: GET /api/admin/customer-carts?page&q&inactive (25/page, server-side).
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import AdminButton from '@/components/AdminButton';
import AdminSelect from '@/components/AdminSelect';
import ModuleTabs from '@/components/ModuleTabs';
import { api, unwrapMeta } from '@/lib/api';
import { formatDate, formatDateTime } from '@/lib/dates';
import { apiMessage, notifySuccess } from '@/lib/notify';
import { M } from '@/lib/messages';
import { useOrderPolling } from '@/lib/useOrderPolling';
import list from '@/components/WorkspaceList.module.css';
import styles from '../customers.module.css';

type CartItem = { productId: string | null; name: string; slug?: string; size: string; color: string; quantity: number; unitPrice: number; subtotal: number; available: boolean };
type Cart = {
  _id: string; reference: string; updatedAt: string; estimatedValue: number; quantity: number;
  user: { _id: string; name: string; email: string; phone?: string; slug?: string; status: string };
  items: CartItem[];
};
type Result = { carts: Cart[]; total: number; pages: number };

const inr = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n || 0);
const ACTIVITY = [{ value: '', label: 'All carts' }, { value: '24h', label: 'Idle for 24 hours or more' }];
const SHOW = 3;
// Formula-like values must remain text when opened in spreadsheet software.
const csvCell = (value: unknown) => {
  let text = String(value ?? '');
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
};
const hoursIdle = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 3600000);

export default function CustomerCartsPage() {
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [inactive, setInactive] = useState('');
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lastShown, setLastShown] = useState<Result | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const key = `carts:${page}:${inactive}:${q.trim()}`;

  useEffect(() => {
    const t = setTimeout(() => { setQ(query); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const request = (signal?: AbortSignal) =>
    api.get('/admin/customer-carts', { signal, params: { page, q: q.trim() || undefined, inactive: inactive || undefined } })
      .then((r): Result => {
        const { data, meta } = unwrapMeta<{ items?: Result['carts'] }, { totalItems: number; totalPages: number }>(r);
        return { carts: data.items || [], total: meta?.totalItems || 0, pages: meta?.totalPages || 1 };
      });
  const apply = (forKey: string, r: Result) => {
    setResults((all) => ({ ...all, [forKey]: r }));
    setErrors((e) => { const next = { ...e }; delete next[forKey]; return next; });
    setLastShown(r);
  };
  useEffect(() => {
    const controller = new AbortController();
    request(controller.signal).then((r) => apply(key, r)).catch((e) => {
      if (!controller.signal.aborted) setErrors((prev) => ({ ...prev, [key]: apiMessage(e) || 'Customer carts are unavailable right now.' }));
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);
  useOrderPolling((signal) => request(signal).then((r) => apply(key, r)), key, 30000);

  const current = results[key];
  const error = errors[key];
  const shown = current ?? lastShown;
  const updating = !current && !error && !!lastShown;
  const total = current?.total ?? 0;
  const pages = current?.pages ?? 1;
  const hasFilters = !!(q.trim() || inactive);
  const clearFilters = () => { setQuery(''); setQ(''); setInactive(''); setPage(1); };
  const retry = () => { setErrors((e) => { const next = { ...e }; delete next[key]; return next; }); setAttempt((n) => n + 1); };

  /* CSV of the page on screen — one line per cart item. */
  function exportRows() {
    const rows = shown?.carts || [];
    const records: unknown[][] = [['Cart reference', 'User ID', 'Name', 'Email', 'Phone', 'Account status', 'Updated', 'Product ID', 'Product', 'Size', 'Color', 'Quantity', 'Estimated unit price', 'Estimated subtotal']];
    for (const cart of rows) for (const item of cart.items) records.push([
      cart.reference, cart.user._id, cart.user.name, cart.user.email, cart.user.phone, cart.user.status,
      cart.updatedAt, item.productId, item.name, item.size, item.color, item.quantity, item.unitPrice, item.subtotal,
    ]);
    const url = URL.createObjectURL(new Blob(['﻿' + records.map((row) => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a'); link.href = url; link.download = `customer-carts-page-${page}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notifySuccess(M.customers.cartsExported(rows.length));
  }

  const Items = ({ cart }: { cart: Cart }) => {
    const all = expanded[cart._id];
    const items = all ? cart.items : cart.items.slice(0, SHOW);
    return (
      <div className={styles.cartItems}>
        {items.map((it, i) => (
          <div key={`${it.productId}-${i}`} className={styles.cartItem}>
            <span>
              <strong title={it.name}>{it.name}</strong>
              <small>{[it.size, it.color].filter(Boolean).join(' · ')}{it.size || it.color ? ' · ' : ''}{it.quantity} × ₹{inr(it.unitPrice)}{!it.available && <em> · Out of stock or unavailable</em>}</small>
            </span>
          </div>
        ))}
        {cart.items.length > SHOW && (
          <button type="button" className={styles.more} onClick={() => setExpanded((e) => ({ ...e, [cart._id]: !all }))}>
            {all ? 'Show fewer' : `+${cart.items.length - SHOW} more`}
          </button>
        )}
      </div>
    );
  };

  return (
    <div className={list.page}>
      <ModuleTabs moduleKey="customers" />

      <section className={list.workspace} aria-labelledby="carts-heading">
        <div className={list.listHeader}>
          <div>
            <h2 id="carts-heading">Customer carts <span className={list.count}>{current ? inr(total) : '…'}</span></h2>
            <p>Saved carts of signed-in customers, most recently touched first. Values are estimates before offers and delivery; empty carts drop off. Refreshes every 30 seconds.</p>
          </div>
          <div className={list.headerActions}>
            <AdminButton variant="bordered" onPress={exportRows} isDisabled={!shown?.carts.length}><IconDownload /> Export this page</AdminButton>
          </div>
        </div>

        <div className={list.toolbar}>
          <div className={list.toolbarLeft}>
            <label className={list.search}>
              <IconSearch />
              <span className="sr-only">Search carts</span>
              <input type="search" value={query} maxLength={100} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, email, phone or cart reference" />
              {query && <button type="button" className={list.clearSearch} onClick={() => setQuery('')} aria-label="Clear search"><IconClose /></button>}
            </label>
            <AdminSelect ariaLabel="Cart activity" value={inactive} onChange={(v) => { setInactive(v); setPage(1); }} options={ACTIVITY} />
          </div>
          <div className={list.results} aria-live="polite">
            {updating ? <span className={list.updating}>Updating…</span> : current && <span>{total ? `Showing ${(page - 1) * 25 + 1}–${Math.min(page * 25, total)} of ${inr(total)}` : 'No results'}</span>}
            {hasFilters && <button type="button" className={list.clearFilters} onClick={clearFilters}><IconClose /> Clear filters</button>}
          </div>
        </div>

        {error && !shown ? (
          <div className={list.state} role="alert">
            <span className={`${list.stateIcon} ${list.errorIcon}`}><IconAlert /></span>
            <h3>Couldn’t load customer carts</h3>
            <p>{error}</p>
            <button type="button" className={list.stateAction} onClick={retry}>Try again</button>
          </div>
        ) : !shown ? (
          <div className={list.skeleton} role="status" aria-label="Loading carts"><span /><span /><span /><span /></div>
        ) : shown.carts.length === 0 && !updating ? (
          <div className={list.state}>
            <span className={list.stateIcon}><IconCart /></span>
            <h3>{hasFilters ? 'No carts match these filters' : 'No saved carts right now'}</h3>
            <p>{hasFilters ? 'Try another search, or include carts touched today.' : 'A cart appears here as soon as a signed-in customer adds something.'}</p>
            {hasFilters && <button type="button" className={list.stateLink} onClick={clearFilters}>Clear filters</button>}
          </div>
        ) : (
          <>
            {error && <p className="px-[22px] pb-3 text-[11px] text-[#a3413b]" role="status">Couldn’t refresh — showing the last loaded list.</p>}
            <div className={`${list.tableWrap} ${updating ? list.stale : ''}`} aria-busy={updating}>
              <table className={list.table}>
                <caption className="sr-only">Customer carts, most recently updated first</caption>
                <thead>
                  <tr>
                    <th scope="col">Customer</th><th scope="col">In the cart</th>
                    <th scope="col" className={list.money}>Estimated value</th><th scope="col">Last updated</th>
                    <th scope="col"><span className="sr-only">Open customer</span></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.carts.map((cart) => {
                    const idle = hoursIdle(cart.updatedAt);
                    return (
                      <tr key={cart._id} style={{ cursor: 'default' }}>
                        <td>
                          <Link className={list.primary} href={`/customers/${cart.user.slug || cart.user._id}`}>{cart.user.name}</Link>
                          <span className={list.sub}>{cart.user.email}</span>
                          <span className={list.sub}>{cart.user.phone ? `${cart.user.phone} · ` : ''}<span className={styles.ref} title={cart.reference}>Cart …{cart.reference.slice(-6)}</span></span>
                        </td>
                        <td><Items cart={cart} /></td>
                        <td className={list.money}><strong>₹{inr(cart.estimatedValue)}</strong><span className={list.sub}>{cart.quantity} {cart.quantity === 1 ? 'unit' : 'units'}</span></td>
                        <td>
                          <span title={formatDateTime(cart.updatedAt)}>{formatDate(cart.updatedAt)}</span>
                          <span className={`${list.sub} ${idle >= 24 ? styles.stale : ''}`}>{idle < 1 ? 'Just now' : idle < 24 ? `${idle}h ago` : `Idle ${Math.floor(idle / 24)}d`}</span>
                        </td>
                        <td><Link className={list.openLink} href={`/customers/${cart.user.slug || cart.user._id}`} aria-label={`Open ${cart.user.name}`} title="Open customer"><IconArrow /></Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className={`${list.cards} ${updating ? list.stale : ''}`}>
              {shown.carts.map((cart) => (
                <div key={cart._id} className={list.card}>
                  <div className={list.cardTop}>
                    <div className="min-w-0">
                      <Link className={list.primary} href={`/customers/${cart.user.slug || cart.user._id}`}>{cart.user.name}</Link>
                      <span className={list.sub}>{cart.user.email}</span>
                    </div>
                    <strong className="whitespace-nowrap text-[13px]">₹{inr(cart.estimatedValue)}</strong>
                  </div>
                  <div className="mt-3"><Items cart={cart} /></div>
                  <span className={`${list.sub} mt-2`}>Updated {formatDateTime(cart.updatedAt)}</span>
                </div>
              ))}
            </div>
            {pages > 1 && (
              <div className={list.footer}>
                <span>Page {page} of {pages}</span>
                <div className={list.pager}>
                  <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><IconArrow flip /> Previous</button>
                  <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next <IconArrow /></button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}

const svg = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
function IconArrow({ flip }: { flip?: boolean }) { return <svg {...svg} style={flip ? { transform: 'scaleX(-1)' } : undefined}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></svg>; }
function IconSearch() { return <svg {...svg}><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>; }
function IconClose() { return <svg {...svg} width="12" height="12"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>; }
function IconDownload() { return <svg {...svg} width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>; }
function IconAlert() { return <svg {...svg}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>; }
function IconCart() { return <svg {...svg}><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></svg>; }
