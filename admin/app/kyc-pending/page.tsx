'use client';

/**
 * Admin — KYC review queue (the Sellers section's "KYC reviews" tab), in the
 * workspace panel layout. Oldest submission first, each entry labelled as a
 * first-time verification or a change request to already-verified details
 * (`kyc.isRevision`, folded in by GET /api/admin/kyc/pending), and flagged
 * once it has waited two days. The review itself is KycReviewCard.
 *
 * Polls quietly (15 s); a view seen before paints from the list cache.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import ModuleTabs from '@/components/ModuleTabs';
import KycReviewCard, { type KycData } from '@/components/KycReviewCard';
import { api, unwrap } from '@/lib/api';
import { formatDate } from '@/lib/dates';
import { useOrderPolling } from '@/lib/useOrderPolling';
import { readListCache, writeListCache } from '@/lib/listCache';
import list from '@/components/WorkspaceList.module.css';
import styles from '../sellers/sellers.module.css';
import { apiMessage } from '@/lib/notify';

type PendingSeller = {
  _id: string; name: string; email: string; storeName?: string; slug?: string; phone?: string; createdAt: string;
  kyc?: KycData & { isRevision?: boolean };
};

const CACHE_KEY = 'admin-kyc-pending';
const daysSince = (iso?: string) => (iso ? Math.floor((Date.now() - Date.parse(iso)) / 86400000) : 0);

export default function KycPendingPage() {
  const [items, setItems] = useState<PendingSeller[] | null>(() => readListCache<PendingSeller[]>(CACHE_KEY));
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const fetchQueue = useCallback((signal?: AbortSignal) =>
    api.get('/admin/kyc/pending', { signal }).then((r) => {
      const rows: PendingSeller[] = unwrap<{ sellers?: PendingSeller[] }>(r).sellers || [];
      setItems(rows);
      setError(null);
      writeListCache(CACHE_KEY, rows);
    }), []);

  useEffect(() => {
    const controller = new AbortController();
    fetchQueue(controller.signal).catch((e) => {
      if (!controller.signal.aborted) setError(apiMessage(e) || 'The KYC queue is unavailable right now.');
    });
    return () => controller.abort();
  }, [fetchQueue, attempt]);
  // The manual Refresh button is gone (UX audit X5); the queue polls instead.
  useOrderPolling((signal) => fetchQueue(signal), 'kyc-pending');

  const reload = () => { void fetchQueue().catch(() => {}); };
  const oldest = (items || []).reduce((max, v) => Math.max(max, daysSince(v.kyc?.submittedAt)), 0);
  const revisions = (items || []).filter((v) => v.kyc?.isRevision).length;

  return (
    <div className={list.page}>
      <ModuleTabs moduleKey="sellers" />

      <section className={list.workspace} aria-labelledby="kyc-heading">
        <div className={list.listHeader}>
          <div>
            <h2 id="kyc-heading">
              KYC reviews <span className={list.count}>{items ? items.length : '…'}</span>
              {items && oldest >= 2 && <span className={styles.oldest}>Oldest waiting {oldest}d</span>}
            </h2>
            <p>
              Oldest first. Approving a new seller verifies them and puts the store live;
              {revisions > 0 ? ` ${revisions} ${revisions === 1 ? 'is a change request' : 'are change requests'} to already-verified details.` : ' change requests replace already-verified details.'}
            </p>
          </div>
        </div>

        {error && !items ? (
          <div className={list.state} role="alert">
            <span className={`${list.stateIcon} ${list.errorIcon}`}><IconAlert /></span>
            <h3>Couldn’t load the KYC queue</h3>
            <p>{error}</p>
            <button type="button" className={list.stateAction} onClick={() => { setError(null); setAttempt((n) => n + 1); }}>Try again</button>
          </div>
        ) : !items ? (
          <div className={list.skeleton} role="status" aria-label="Loading the KYC queue"><span style={{ height: 140 }} /><span style={{ height: 140 }} /></div>
        ) : items.length === 0 ? (
          <div className={list.state}>
            <span className={list.stateIcon}><IconCheck /></span>
            <h3>All caught up</h3>
            <p>No KYC is waiting for you. New submissions and change requests appear here automatically.</p>
          </div>
        ) : (
          <div className={styles.queue}>
            {error && <p className="text-[11px] text-[#a3413b]" role="status">Couldn’t refresh — showing the last loaded queue.</p>}
            {items.map((v, idx) => {
              const waited = daysSince(v.kyc?.submittedAt);
              const aged = waited >= 2;
              const name = v.storeName || v.name;
              return (
                <article key={v._id} className={`${styles.entry} ${aged ? styles.entryAged : ''}`} aria-label={`KYC for ${name}`}>
                  <div className={styles.entryHead}>
                    <span className={styles.avatar} aria-hidden>{name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase()}</span>
                    <div className={styles.entryWho}>
                      <div className={styles.entryName}>
                        <Link href={`/sellers/${v.slug || v._id}`}>{name}</Link>
                        <span className={`${styles.tag} ${v.kyc?.isRevision ? styles.tagInfo : ''}`}>{v.kyc?.isRevision ? 'Change request' : 'New seller'}</span>
                        <span className={styles.tag}>#{idx + 1} in queue</span>
                        {aged && <span className={`${styles.tag} ${styles.tagWarn}`}>Waiting {waited}d</span>}
                      </div>
                      <p className={styles.entryMeta}>
                        {v.name} · {v.email}{v.phone ? ` · ${v.phone}` : ''} · joined {formatDate(v.createdAt)}
                        {v.kyc?.submittedAt && <> · submitted {formatDate(v.kyc.submittedAt)}</>}
                      </p>
                    </div>
                    <Link className={styles.openSeller} href={`/sellers/${v.slug || v._id}`}>Open seller <IconArrow /></Link>
                  </div>
                  <div className={styles.entryBody}>
                    <KycReviewCard sellerId={v._id} sellerName={name} kyc={v.kyc} onChange={reload} />
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

const svg = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
function IconArrow() { return <svg {...svg}><line x1="5" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></svg>; }
function IconCheck() { return <svg {...svg}><path d="M20 6 9 17l-5-5" /></svg>; }
function IconAlert() { return <svg {...svg}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>; }
