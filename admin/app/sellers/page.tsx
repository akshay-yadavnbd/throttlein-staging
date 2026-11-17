'use client';

/**
 * Admin — seller roster, in the workspace list layout (components/
 * WorkspaceList.module.css, same as Orders): one panel with header, stage
 * tabs with counts, search and the table; rows open the seller; narrow
 * panels show cards.
 *
 * Unchanged behaviour: `?stage=` deep links (dashboard card, bell), the
 * pipeline counts from /admin/sellers/queues (same numbers as the
 * dashboard), server-side search + paging, and the row menu — onboarding
 * reminder (stalled sellers only, 429 cooldown → confirm → force), "Sign in
 * as this seller" (audited, master key or admin password), and delete with
 * the deletion-impact preview.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ModuleTabs from '@/components/ModuleTabs';
import { RowActions, type RowAction } from '@/components/ui';
import { api, imageUrl, unwrap, unwrapMeta } from '@/lib/api';
import { formatDate } from '@/lib/dates';
import { readListCache, writeListCache } from '@/lib/listCache';
import { confirmDialog } from '@/lib/confirm';
import { storefrontOrigin } from '@/lib/storefrontUrl';
import list from '@/components/WorkspaceList.module.css';
import styles from './sellers.module.css';
import { notifyError, notifySuccess, notifyWarning, apiMessage } from '@/lib/notify';
import { M } from '@/lib/messages';

type KycStatus = 'not_started' | 'pending' | 'approved' | 'rejected';
/** Where a seller stalled in onboarding, or null — computed server-side
 *  (backend/src/utils/sellerOnboarding.js) so this list and the remind
 *  endpoint can never disagree about who's stalled. */
type OnboardingStage = 'unverified' | 'no_kyc' | 'kyc_rejected' | null;

type Seller = {
  _id: string;
  name: string;
  email: string;
  storeName?: string;
  slug?: string;
  phone?: string;
  avatar?: string;
  status: 'pending' | 'approved' | 'suspended';
  emailVerified?: boolean;
  kyc?: { status?: KycStatus; submittedAt?: string };
  onboardingStage?: OnboardingStage;
  onboardingReminder?: { lastSentAt?: string; count?: number };
  createdAt: string;
};
type Result = { items: Seller[]; total: number };

const PAGE_SIZE = 15;

/** Prefer the server's stage; derive it only when an older API omits the key
 *  (`null` is a real "not stalled" answer and must not trigger the fallback). */
function stageOf(s: Seller): OnboardingStage {
  if ('onboardingStage' in s) return s.onboardingStage ?? null;
  if (!s.emailVerified) return 'unverified';
  const k = s.kyc?.status || 'not_started';
  if (k === 'rejected') return 'kyc_rejected';
  if (k === 'not_started') return 'no_kyc';
  return null;
}

/**
 * ONE lifecycle, one column (UX audit A2): verify email → submit KYC → we
 * approve → live, as one position on one track plus a word for it.
 * Suspended is the only off-track state.
 */
type Lifecycle = { step: 0 | 1 | 2 | 3; label: string; tone: 'muted' | 'attention' | 'negative' | 'positive'; suspended?: boolean };
function lifecycleOf(s: Seller): Lifecycle {
  if (s.status === 'suspended') return { step: 3, label: 'Suspended', tone: 'negative', suspended: true };
  if (s.status === 'approved') return { step: 3, label: 'Live', tone: 'positive' };
  const k = s.kyc?.status || 'not_started';
  if (k === 'pending') return { step: 2, label: 'KYC waiting for you', tone: 'attention' };
  if (k === 'rejected') return { step: 1, label: 'KYC sent back', tone: 'negative' };
  if (s.emailVerified === false || stageOf(s) === 'unverified') return { step: 0, label: 'Email not verified', tone: 'muted' };
  return { step: 1, label: 'KYC not started', tone: 'muted' };
}
const STEP_NAMES = ['Email verified', 'KYC submitted', 'Live'];

function StageCell({ s }: { s: Seller }) {
  const lc = lifecycleOf(s);
  const sent = s.onboardingReminder?.lastSentAt;
  const count = s.onboardingReminder?.count || 0;
  const sub = lc.label === 'KYC waiting for you' && s.kyc?.submittedAt
    ? `Submitted ${formatDate(s.kyc.submittedAt)}`
    : sent && lc.step < 2 ? `Reminded ${formatDate(sent)}${count > 1 ? ` · ${count}×` : ''}` : '';
  return (
    <div className={styles.stage}>
      <div className={`${styles.track} ${styles[lc.tone]}`} role="img" aria-label={`${lc.label} — ${lc.step} of 3 steps done`}>
        <span className={styles.dots} aria-hidden>
          {STEP_NAMES.map((name, i) => {
            const done = i < lc.step;
            const current = i === lc.step && !lc.suspended;
            return (
              <span key={name} className="flex items-center" title={name}>
                <span className={`${styles.dot} ${lc.suspended ? styles.dotSuspended : done ? styles.dotDone : current ? styles.dotCurrent : ''}`} />
                {i < STEP_NAMES.length - 1 && <span className={`${styles.link} ${done && !lc.suspended ? styles.linkDone : ''}`} />}
              </span>
            );
          })}
        </span>
        <span className={styles.stageLabel}>{lc.label}</span>
      </div>
      {sub && <span className={styles.stageSub}>{sub}</span>}
    </div>
  );
}

/** The seller pipeline, in the same words the dashboard card and the bell use (UX audit A1). */
type Stage = 'all' | 'signups' | 'kycWaiting' | 'live' | 'suspended';
const STAGES: { id: Stage; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'signups', label: 'Sign-ups in progress' },
  { id: 'kycWaiting', label: 'KYC waiting for you' },
  { id: 'live', label: 'Live' },
  { id: 'suspended', label: 'Suspended' },
];
type Queues = { signups: number; unverified: number; kycWaiting: number; live: number; suspended: number };

const initials = (s: Seller) => (s.storeName || s.name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();

export default function SellersPage() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [stage, setStage] = useState<Stage>('all');
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lastShown, setLastShown] = useState<Result | null>(null);
  const [queues, setQueues] = useState<Queues | null>(null);
  // Which row has an action in flight, so only that row shows progress.
  const [reminding, setReminding] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [impersonating, setImpersonating] = useState<string | null>(null);
  /* Which step-up credential "Sign in as seller" asks for: once a master
     access key exists it REPLACES the admin password, so the prompt must
     name the right secret. `null` = not known yet. */
  const [masterKeyOn, setMasterKeyOn] = useState<boolean | null>(null);

  const key = `admin-sellers:${stage}:${page}:${q.trim()}`;

  // Deep link from the dashboard / bell: /sellers?stage=signups
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('stage') as Stage | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (s && STAGES.some((t) => t.id === s)) setStage(s);
  }, []);

  useEffect(() => {
    api.get('/admin/security/master-key')
      .then((r) => setMasterKeyOn(Boolean(unwrap<{ configured?: boolean }>(r)?.configured)))
      .catch(() => setMasterKeyOn(false)); // non-superadmin or older server
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { setQ(query); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const request = (signal?: AbortSignal) =>
    api.get('/admin/sellers', { signal, params: { q: q.trim() || undefined, stage: stage === 'all' ? undefined : stage, page, limit: PAGE_SIZE } })
      .then((r): Result => {
        const { data, meta } = unwrapMeta<{ items: Seller[] }, { totalItems: number }>(r);
        return { items: data.items || [], total: meta?.totalItems || 0 };
      });
  const apply = (forKey: string, r: Result) => {
    setResults((all) => ({ ...all, [forKey]: r }));
    setErrors((e) => { const next = { ...e }; delete next[forKey]; return next; });
    setLastShown(r);
    writeListCache(forKey, r);
  };
  const loadQueues = () => api.get('/admin/sellers/queues').then((r) => setQueues(unwrap<{ queues?: Queues }>(r).queues || null)).catch(() => {});

  useEffect(() => {
    const controller = new AbortController();
    request(controller.signal).then((r) => apply(key, r)).catch((e) => {
      if (controller.signal.aborted) return;
      setErrors((prev) => ({ ...prev, [key]: apiMessage(e) || 'The seller list is unavailable right now.' }));
    });
    void loadQueues();
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const refresh = () => setAttempt((n) => n + 1);
  const current = results[key] ?? readListCache<Result>(key);
  const error = errors[key];
  const shown = current ?? lastShown;
  const updating = !current && !error && !!lastShown;
  const total = current?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(page * PAGE_SIZE, total);
  const count = (id: Stage) => !queues ? '…' : id === 'all' ? queues.signups + queues.kycWaiting + queues.live + queues.suspended : queues[id];

  /** Onboarding reminder; `force` only after a 429 cooldown and an explicit confirm. */
  async function remind(seller: Seller, force = false) {
    setReminding(seller._id);
    try {
      await api.post(`/admin/sellers/${seller.slug || seller._id}/remind`, force ? { force: true } : {});
      notifySuccess(M.sellers.reminderSent(seller.email));
      refresh();
    } catch (e: any) {
      if (e?.response?.status === 429 && !force) {
        const message = apiMessage(e) || 'A reminder went out recently.';
        const again = await confirmDialog({ title: 'Send the reminder again?', message, confirmLabel: 'Send anyway' });
        if (again) { setReminding(null); return remind(seller, true); }
      } else {
        notifyError(e, M.sellers.couldntSendTheReminder);
      }
    } finally {
      setReminding(null);
    }
  }

  /**
   * Delete a seller at any stage. The API is asked first what deleting would
   * remove (and whether it's allowed), so the confirmation names real numbers;
   * the same checks re-run server-side. Orders are never removed.
   */
  async function remove(seller: Seller) {
    const k = seller.slug || seller._id;
    setDeleting(seller._id);
    try {
      const impact = unwrap<{ canDelete: boolean; blockers: string[]; counts?: Record<string, number>; ordersPreserved: number }>(
        await api.get(`/admin/sellers/${k}/deletion-impact`),
      );
      if (!impact.canDelete) {
        notifyWarning(M.sellers.cantDeleteYetN(seller.storeName || seller.name, impact.blockers.join('\n• ')));
        return;
      }
      const c = impact.counts || {};
      const owned = [
        c.products && `${c.products} product(s)`, c.offers && `${c.offers} offer(s)`, c.sellerMedia && `${c.sellerMedia} media file(s)`,
        c.offlineSales && `${c.offlineSales} offline sale(s)`, c.brandRequests && `${c.brandRequests} brand request(s)`,
      ].filter(Boolean) as string[];
      const lines = [
        `Permanently delete ${seller.storeName || seller.name} (${seller.email})?`, '',
        owned.length ? `This also deletes: ${owned.join(', ')}, and every file they uploaded.` : 'This account owns no products or uploads.',
      ];
      if (impact.ordersPreserved > 0) lines.push('', `${impact.ordersPreserved} past order(s) will be KEPT for customer and accounting history.`);
      lines.push('', 'This cannot be undone.');
      const ok = await confirmDialog({ title: 'Delete seller account', message: lines.join('\n'), confirmLabel: 'Delete permanently', destructive: true });
      if (!ok) return;
      const data = unwrap<{ shiprocketWarning?: string | null; storageWarning?: string | null }>(await api.delete(`/admin/sellers/${k}`));
      notifySuccess(M.sellers.sellerDeleted(seller.storeName || seller.name));
      // Best-effort cleanup problems need a human to finish the job — said
      // in our words (the server's text carries raw provider errors).
      if (data?.shiprocketWarning) notifyWarning(M.sellers.removeTheirPickupAddressInShiprocket);
      if (data?.storageWarning) notifyWarning(M.sellers.someUploadedFilesWerentRemoved);
      refresh();
    } catch (e: any) {
      notifyError(e, M.sellers.couldntDeleteTheSeller);
    } finally {
      setDeleting(null);
    }
  }

  /**
   * "See what they see" — audited, 30-minute seller session opened in a new
   * tab. The token travels in the URL fragment (never sent to a server) and
   * the seller dashboard strips it on arrival.
   */
  async function signInAsSeller(seller: Seller) {
    const who = seller.storeName || seller.name;
    const password = window.prompt(
      masterKeyOn
        ? `Enter the MASTER ACCESS KEY to sign in as ${who}.\n\nThis is the key you set on the Security page — not your admin password, and not the seller's own password.\n\nRecorded in the audit log against your account. The session expires in 30 minutes.`
        : `Confirm YOUR admin password to sign in as ${who}.\n\nNo master access key is set up yet — set one on the Security page to use that instead.\n\nRecorded in the audit log against your account. The session expires in 30 minutes.`,
    );
    if (!password) return;
    setImpersonating(seller._id);
    try {
      const data = unwrap<{ token: string; expiresInMinutes?: number; seller?: { storeName?: string; name?: string; email?: string } }>(
        await api.post(`/admin/sellers/${seller.slug || seller._id}/impersonate`, { password }),
      );
      const frag = new URLSearchParams({
        impersonate: data.token,
        name: data.seller?.storeName || data.seller?.name || 'seller',
        email: data.seller?.email || '',
        ttl: String(data.expiresInMinutes || 30),
      });
      window.open(`${storefrontOrigin('main')}/dashboard#${frag.toString()}`, '_blank', 'noopener');
      notifySuccess(M.sellers.openedInANewTab(data.seller?.storeName || data.seller?.name || who));
    } catch (e: any) {
      notifyError(e, M.sellers.couldntStartTheSellerSession);
    } finally {
      setImpersonating(null);
    }
  }

  const menuFor = (v: Seller): RowAction[] => {
    const items: RowAction[] = [];
    if (stageOf(v)) items.push({ key: 'remind', label: 'Send onboarding reminder', hint: `Emails ${v.email}`, onSelect: () => remind(v), busy: reminding === v._id, busyLabel: 'Sending…' });
    items.push({ key: 'impersonate', label: 'Sign in as this seller', hint: 'Audited, 30-minute session', onSelect: () => signInAsSeller(v), busy: impersonating === v._id, busyLabel: 'Opening…' });
    items.push({ key: 'delete', label: 'Delete seller…', hint: 'Asks for confirmation', tone: 'danger', onSelect: () => remove(v), busy: deleting === v._id, busyLabel: 'Deleting…' });
    return items;
  };

  const href = (v: Seller) => `/sellers/${v.slug || v._id}`;
  const onRowClick = (e: React.MouseEvent, v: Seller) => {
    if ((e.target as HTMLElement).closest('a,button,[role="menu"]')) return;
    router.push(href(v));
  };
  const emptyTitle = q.trim() ? `No sellers match “${q.trim()}”`
    : stage === 'signups' ? 'No sign-ups in progress' : stage === 'kycWaiting' ? 'No KYC waiting for you'
    : stage === 'live' ? 'No live sellers yet' : stage === 'suspended' ? 'No suspended sellers' : 'No sellers yet';

  return (
    <div className={list.page}>
      <ModuleTabs moduleKey="sellers" />

      <section className={list.workspace} aria-labelledby="sellers-heading">
        <div className={list.listHeader}>
          <div>
            <h2 id="sellers-heading">All sellers <span className={list.count}>{count('all')}</span></h2>
            <p>Every seller account and where it stands in onboarding.</p>
          </div>
        </div>

        <div className={list.stageFilters} role="group" aria-label="Filter by seller stage">
          {STAGES.map((t) => (
            <button key={t.id} type="button" aria-pressed={stage === t.id} onClick={() => { setStage(t.id); setPage(1); }}>
              {t.label}<span>{count(t.id)}</span>
            </button>
          ))}
        </div>

        <div className={list.toolbar}>
          <div className={list.toolbarLeft}>
            <label className={list.search}>
              <IconSearch />
              <span className="sr-only">Search sellers</span>
              <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, email or store" />
              {query && <button type="button" className={list.clearSearch} onClick={() => setQuery('')} aria-label="Clear search"><IconClose /></button>}
            </label>
          </div>
          <div className={list.results} aria-live="polite">
            {updating ? <span className={list.updating}>Updating…</span> : current && <span>{total ? `Showing ${from}–${to} of ${total}` : 'No results'}</span>}
            {(q.trim() || stage !== 'all') && <button type="button" className={list.clearFilters} onClick={() => { setQuery(''); setQ(''); setStage('all'); setPage(1); }}><IconClose /> Clear filters</button>}
          </div>
        </div>

        {error && !shown ? (
          <div className={list.state} role="alert">
            <span className={`${list.stateIcon} ${list.errorIcon}`}><IconAlert /></span>
            <h3>Couldn’t load sellers</h3>
            <p>{error}</p>
            <button type="button" className={list.stateAction} onClick={() => { setErrors((e) => { const n = { ...e }; delete n[key]; return n; }); refresh(); }}>Try again</button>
          </div>
        ) : !shown ? (
          <div className={list.skeleton} role="status" aria-label="Loading sellers"><span /><span /><span /><span /></div>
        ) : shown.items.length === 0 && !updating ? (
          <div className={list.state}>
            <span className={list.stateIcon}><IconUsers /></span>
            <h3>{emptyTitle}</h3>
            <p>{q.trim() ? 'Try a different name, email or store.' : stage === 'signups' ? 'Every seller has finished onboarding or is waiting for your review.' : 'Seller registrations will show here as they come in.'}</p>
          </div>
        ) : (
          <>
            <div className={`${list.tableWrap} ${updating ? list.stale : ''}`} aria-busy={updating}>
              <table className={list.table}>
                <caption className="sr-only">Sellers, newest first</caption>
                <thead>
                  <tr><th scope="col">Seller</th><th scope="col">Contact</th><th scope="col">Stage</th><th scope="col">Joined</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {shown.items.map((v) => (
                    <tr key={v._id} onClick={(e) => onRowClick(e, v)}>
                      <td>
                        <div className={styles.identity}>
                          <span className={styles.avatar} aria-hidden>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            {v.avatar ? <img src={imageUrl(v.avatar)} alt="" /> : initials(v)}
                          </span>
                          <div className="min-w-0">
                            <Link className={list.primary} href={`${href(v)}?tab=profile`}>{v.storeName || v.name}</Link>
                            {v.storeName && <span className={list.sub}>Owner · {v.name}</span>}
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className={list.sub} style={{ marginTop: 0, color: '#39434c' }}>{v.email}</span>
                        {v.phone && <span className={list.sub}>{v.phone}</span>}
                      </td>
                      <td><StageCell s={v} /></td>
                      <td><span className={list.sub} style={{ marginTop: 0 }}>{formatDate(v.createdAt)}</span></td>
                      <td>
                        <div className={styles.rowEnd}>
                          <RowActions ariaLabel={`More actions for ${v.storeName || v.name}`} items={menuFor(v)} />
                          <Link className={list.openLink} href={href(v)} aria-label={`Open ${v.storeName || v.name}`} title="Open seller" style={{ marginLeft: 0 }}><IconArrow /></Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={`${list.cards} ${updating ? list.stale : ''}`}>
              {shown.items.map((v) => (
                <div key={v._id} className={list.card}>
                  <div className={list.cardTop}>
                    <div className={styles.identity}>
                      <span className={styles.avatar} aria-hidden>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        {v.avatar ? <img src={imageUrl(v.avatar)} alt="" /> : initials(v)}
                      </span>
                      <div className="min-w-0">
                        <Link className={list.primary} href={href(v)}>{v.storeName || v.name}</Link>
                        <span className={list.sub}>{v.email}</span>
                        <span className={list.sub}>Joined {formatDate(v.createdAt)}</span>
                      </div>
                    </div>
                    <RowActions ariaLabel={`More actions for ${v.storeName || v.name}`} items={menuFor(v)} />
                  </div>
                  <div className="mt-3">
                    <StageCell s={v} />
                  </div>
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
function IconUsers() { return <svg {...svg}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></svg>; }
function IconAlert() { return <svg {...svg}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>; }
