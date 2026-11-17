'use client';

/**
 * Admin — customers (buyers), in the workspace list layout (same family as
 * Orders and Sellers): one panel with the count, a search box, and a table
 * that turns into cards on narrow panels. Rows open the customer.
 *
 * Data: GET /api/admin/customers?q&page&limit (server-side paging, 15/page;
 * each row carries orderCount and lifetimeSpend). A view seen before paints
 * from the list cache; switching pages keeps the old rows dimmed.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ModuleTabs from '@/components/ModuleTabs';
import { api, imageUrl, unwrapMeta } from '@/lib/api';
import { formatDate } from '@/lib/dates';
import { readListCache, writeListCache } from '@/lib/listCache';
import { apiMessage } from '@/lib/notify';
import list from '@/components/WorkspaceList.module.css';
import styles from './customers.module.css';

type Customer = {
  _id: string;
  slug?: string;
  name: string;
  email: string;
  phone?: string;
  avatar?: string;
  status: 'pending' | 'approved' | 'suspended';
  createdAt: string;
  addresses?: { city?: string; state?: string }[];
  orderCount: number;
  lifetimeSpend: number;
};
type Result = { items: Customer[]; total: number };

const PAGE_SIZE = 15;
const inr = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n || 0);
const initials = (name: string) => (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();
const href = (c: Customer) => `/customers/${c.slug || c._id}`;

export default function CustomersListPage() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lastShown, setLastShown] = useState<Result | null>(null);
  const key = `admin-customers:${page}:${q.trim()}`;

  useEffect(() => {
    const t = setTimeout(() => { setQ(query); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    api.get('/admin/customers', { signal: controller.signal, params: { q: q.trim() || undefined, page, limit: PAGE_SIZE } })
      .then((res) => {
        const { data, meta } = unwrapMeta<{ items: Customer[] }, { totalItems: number }>(res);
        const r: Result = { items: data.items || [], total: meta?.totalItems || 0 };
        setResults((all) => ({ ...all, [key]: r }));
        setErrors((e) => { const next = { ...e }; delete next[key]; return next; });
        setLastShown(r);
        writeListCache(key, r);
      })
      .catch((e) => { if (!controller.signal.aborted) setErrors((prev) => ({ ...prev, [key]: apiMessage(e) || 'The customers list is unavailable right now.' })); });
    return () => controller.abort();
  }, [key, q, page, attempt]);

  const current = results[key] ?? readListCache<Result>(key);
  const error = errors[key];
  const shown = current ?? lastShown;
  const updating = !current && !error && !!lastShown;
  const total = current?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(page * PAGE_SIZE, total);
  const retry = () => { setErrors((e) => { const next = { ...e }; delete next[key]; return next; }); setAttempt((n) => n + 1); };
  const onRowClick = (e: React.MouseEvent, c: Customer) => { if ((e.target as HTMLElement).closest('a,button')) return; router.push(href(c)); };

  return (
    <div className={list.page}>
      <ModuleTabs moduleKey="customers" />

      <section className={list.workspace} aria-labelledby="customers-heading">
        <div className={list.listHeader}>
          <div>
            <h2 id="customers-heading">All customers <span className={list.count}>{current ? inr(total) : '…'}</span></h2>
            <p>Everyone with a shopping account, newest first. Orders and spend exclude cancelled orders.</p>
          </div>
        </div>

        <div className={list.toolbar}>
          <div className={list.toolbarLeft}>
            <label className={list.search}>
              <IconSearch />
              <span className="sr-only">Search customers</span>
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, email or phone" />
              {query && <button type="button" className={list.clearSearch} onClick={() => setQuery('')} aria-label="Clear search"><IconClose /></button>}
            </label>
          </div>
          <div className={list.results} aria-live="polite">
            {updating ? <span className={list.updating}>Updating…</span> : current && <span>{total ? `Showing ${from}–${to} of ${inr(total)}` : 'No results'}</span>}
            {q.trim() && <button type="button" className={list.clearFilters} onClick={() => setQuery('')}><IconClose /> Clear search</button>}
          </div>
        </div>

        {error && !shown ? (
          <div className={list.state} role="alert">
            <span className={`${list.stateIcon} ${list.errorIcon}`}><IconAlert /></span>
            <h3>Couldn’t load customers</h3>
            <p>{error}</p>
            <button type="button" className={list.stateAction} onClick={retry}>Try again</button>
          </div>
        ) : !shown ? (
          <div className={list.skeleton} role="status" aria-label="Loading customers"><span /><span /><span /><span /><span /></div>
        ) : shown.items.length === 0 && !updating ? (
          <div className={list.state}>
            <span className={list.stateIcon}><IconPeople /></span>
            <h3>{q.trim() ? `No customers match “${q.trim()}”` : 'No customers yet'}</h3>
            <p>{q.trim() ? 'Try a different name, email or phone.' : 'Customers show here once people create accounts and buy.'}</p>
            {q.trim() && <button type="button" className={list.stateLink} onClick={() => setQuery('')}>Clear search</button>}
          </div>
        ) : (
          <>
            {error && <p className="px-[22px] pb-3 text-[11px] text-[#a3413b]" role="status">Couldn’t refresh — showing the last loaded list. <button type="button" className="underline" onClick={retry}>Retry</button></p>}
            <div className={`${list.tableWrap} ${updating ? list.stale : ''}`} aria-busy={updating}>
              <table className={list.table}>
                <caption className="sr-only">Customers, newest first</caption>
                <thead>
                  <tr>
                    <th scope="col">Customer</th><th scope="col">Contact</th><th scope="col">Orders</th>
                    <th scope="col" className={list.money}>Lifetime spend</th><th scope="col">Joined</th>
                    <th scope="col"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody>
                  {shown.items.map((c) => {
                    const a = c.addresses?.[0];
                    const place = [a?.city, a?.state].filter(Boolean).join(', ');
                    return (
                      <tr key={c._id} onClick={(e) => onRowClick(e, c)}>
                        <td>
                          <div className={styles.identity}>
                            <span className={styles.avatar} aria-hidden>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              {c.avatar ? <img src={imageUrl(c.avatar)} alt="" /> : initials(c.name)}
                            </span>
                            <div className="min-w-0">
                              <Link className={list.primary} href={href(c)}>{c.name}</Link>
                              <span className={list.sub}>{place || (c.status !== 'approved' ? `Account ${c.status}` : 'No address saved')}</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={list.primary} style={{ fontWeight: 500 }}>{c.email}</span>
                          <span className={list.sub}>{c.phone || 'No phone'}</span>
                        </td>
                        <td className={c.orderCount ? '' : styles.quiet}>{c.orderCount}</td>
                        <td className={list.money}><strong className={c.lifetimeSpend ? '' : styles.quiet}>₹{inr(c.lifetimeSpend)}</strong></td>
                        <td>{formatDate(c.createdAt)}</td>
                        <td><Link className={list.openLink} href={href(c)} aria-label={`Open ${c.name}`} title="Open customer"><IconArrow /></Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className={`${list.cards} ${updating ? list.stale : ''}`}>
              {shown.items.map((c) => (
                <Link key={c._id} className={list.card} href={href(c)}>
                  <div className={list.cardTop}>
                    <div className={styles.identity}>
                      <span className={styles.avatar} aria-hidden>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {c.avatar ? <img src={imageUrl(c.avatar)} alt="" /> : initials(c.name)}
                      </span>
                      <div className="min-w-0">
                        <span className={list.primary}>{c.name}</span>
                        <span className={list.sub}>{c.email}</span>
                      </div>
                    </div>
                    <strong className="whitespace-nowrap text-[13px]">₹{inr(c.lifetimeSpend)}</strong>
                  </div>
                  <dl className={list.cardGrid}>
                    <div><dt>Orders</dt><dd>{c.orderCount}</dd></div>
                    <div><dt>Joined</dt><dd>{formatDate(c.createdAt)}</dd></div>
                  </dl>
                </Link>
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
function IconAlert() { return <svg {...svg}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>; }
function IconPeople() { return <svg {...svg}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>; }
