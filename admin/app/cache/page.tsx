'use client';

/**
 * Admin — Cache inspector (Redis observability), in the workspace layout.
 *
 * Superadmin-only. Two backend endpoints, both gated by
 * `requireRole('superadmin')`:
 *   GET    /api/admin/redis/inspect         → { summary, groups }
 *   DELETE /api/admin/redis/delete-by-prefix?prefix=<p>&confirm=true
 *
 * Header: which Redis DB is connected, Refresh, Delete prefix. Main
 * column: KPI strip, quick visuals (donuts + group bars), largest keys,
 * nearest expiry, groups summary, advice and the keys-by-group rows.
 * Rail: the inspect parameters (prefix, top N, oversize, detail/auto
 * refresh/hide-dominant toggles, metric). Charts are hand-rolled SVG —
 * no chart library.
 */
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import AdminButton from '@/components/AdminButton';
import AdminInput from '@/components/AdminInput';
import AdminSelect from '@/components/AdminSelect';
import AdminShell from '@/components/AdminShell';
import AdminSwitch from '@/components/AdminSwitch';
import { StatusChip } from '@/components/ui';
import { EditorPage, EditorHeader, Field, AccordionRow, IconClose, IconTrash } from '@/components/EditorShell';
import { api, unwrap } from '@/lib/api';
import { getStoredAdmin } from '@/lib/auth';
import { notifyError, notifySuccess, apiMessage } from '@/lib/notify';
import { M } from '@/lib/messages';
import form from '@/components/AdminForm.module.css';
import list from '@/components/WorkspaceList.module.css';
import shared from '@/app/sellers/[slug]/detail.module.css';
import modal from '@/components/AdminModal.module.css';
import styles from './cache.module.css';

/* ─── formatters ─────────────────────────────────────────────────── */
const fmtBytes = (n: number | null | undefined) => {
  if (n == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let x = Number(n) || 0;
  while (x >= 1024 && i < u.length - 1) { x /= 1024; i += 1; }
  return `${x.toFixed(2)} ${u[i]}`;
};
const fmtSecs = (s: number | null | undefined) => {
  if (s == null || s < 0) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
};
const parseHumanBytes = (str?: string | null) => {
  if (!str) return 0;
  const m = String(str).trim().match(/^([\d.]+)\s*([KMGT]?B?|[KMGT])$/i);
  if (!m) return 0;
  const num = parseFloat(m[1]);
  const unit = m[2].toUpperCase().replace('B', '');
  const pow = ({ '': 0, K: 1, M: 2, G: 3, T: 4 } as Record<string, number>)[unit] ?? 0;
  return Math.round(num * (1024 ** pow));
};

/* ─── types (subset of backend response) ─────────────────────────── */
type KeyRow = { key: string; sizeBytes: number; size?: string; ttlSeconds: number };
type GroupItem = { key: string; ttl: string; ttlSeconds: number; type: string; size: string; sizeBytes: number | null };
type GroupSummary = {
  group: string;
  count: number;
  totalSize: string;
  totalSizeBytes: number;
  expiring: number;
  noExpiry: number;
  percentOfKeys: number;
  percentOfSize: number;
};
type Summary = {
  pattern?: string;
  /** Which logical Redis DB the backend is connected to. */
  connection?: { db: number | null };
  totals?: { keys: number; groups: number; sizeBytes: number; sizeHuman: string };
  expiry?: { expiring: number; noExpiry: number; avgTTLSeconds: number; minTTLSeconds: number; maxTTLSeconds: number };
  memory?: { used_memory_human?: string | null; used_memory_rss_human?: string | null; maxmemory_human?: string | null };
  topLargestKeys?: KeyRow[];
  topNearestExpiry?: KeyRow[];
  groupsSummary?: GroupSummary[];
  advice?: string[];
  error?: string;
};
type InspectResponse = { summary: Summary; groups: Record<string, GroupItem[]> };

/* ─── SVG donut ──────────────────────────────────────────────────── */
function Donut({ percent = 0, label, sub }: { percent?: number; label: string; sub?: string }) {
  const size = 72; const stroke = 8;
  const r = (size - stroke) / 2;
  const c = Math.PI * 2 * r;
  const p = Math.max(0, Math.min(100, percent));
  const dash = (p / 100) * c;
  return (
    <div className={styles.donut}>
      <svg width={size} height={size} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#eef1f3" strokeWidth={stroke} fill="none" />
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#191d21" strokeWidth={stroke} fill="none" strokeDasharray={`${dash} ${c - dash}`} strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize="13" fontWeight="600" fill="#252c32">{Math.round(p)}%</text>
      </svg>
      <dl className="min-w-0"><dt>{label}</dt>{sub && <dd>{sub}</dd>}</dl>
    </div>
  );
}

function KeyTable({ rows, ttlFirst }: { rows: KeyRow[]; ttlFirst?: boolean }) {
  return (
    <div className={`${form.full} ${form.tableWrap}`}>
      <table className={form.table} style={{ minWidth: 0 }}>
        <thead><tr><th scope="col">Key</th><th scope="col" className={styles.num}>{ttlFirst ? 'TTL' : 'Size'}</th><th scope="col" className={styles.num}>{ttlFirst ? 'Size' : 'TTL'}</th></tr></thead>
        <tbody>
          {rows.map((k) => (
            <tr key={k.key}>
              <td className={styles.mono}>{k.key}</td>
              <td className={styles.num}>{ttlFirst ? fmtSecs(k.ttlSeconds) : fmtBytes(k.sizeBytes)}</td>
              <td className={styles.num}>{ttlFirst ? fmtBytes(k.sizeBytes) : fmtSecs(k.ttlSeconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CacheInspectorPage() {
  const router = useRouter();

  // Client-side guard — matches AdminShell's own check. Staff who hit the
  // URL directly still get bounced to the dashboard.
  useEffect(() => {
    const u = getStoredAdmin();
    if (u && u.role !== 'superadmin') router.replace('/dashboard');
  }, [router]);

  const [prefix, setPrefix] = useState('');
  const [topN, setTopN] = useState(10);
  const [oversizeKB, setOversizeKB] = useState(512);
  const [includeGroupItems, setIncludeGroupItems] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [hideDominant, setHideDominant] = useState(true);
  const [metric, setMetric] = useState<'keys' | 'size'>('keys');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [attempt, setAttempt] = useState(0);

  /* The result is keyed by the parameters that produced it, so "loading"
     is derived (key mismatch) rather than set inside the effect. */
  const paramsKey = JSON.stringify({ prefix, topN, includeGroupItems, oversizeKB, attempt });
  const [result, setResult] = useState<{ key: string; data: InspectResponse | null; error: string } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const params: Record<string, string> = { topN: String(topN), includeGroupItems: includeGroupItems ? 'true' : 'false', oversizeKB: String(oversizeKB) };
    if (prefix) params.prefix = prefix; else params.pattern = '*';
    api.get('/admin/redis/inspect', { params })
      .then((r) => { if (!cancelled) setResult({ key: paramsKey, data: unwrap<InspectResponse>(r), error: '' }); })
      .catch((e: any) => { if (!cancelled) setResult({ key: paramsKey, data: null, error: apiMessage(e) || 'Redis couldn’t be inspected right now.' }); });
    return () => { cancelled = true; };
  }, [paramsKey, prefix, topN, includeGroupItems, oversizeKB]);
  useEffect(() => {
    if (!autoRefresh) return undefined;
    const id = setInterval(() => setAttempt((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, [autoRefresh]);
  const refresh = () => setAttempt((n) => n + 1);
  const loading = !result || result.key !== paramsKey;
  const data = result?.data || null;
  const error = result?.error || '';

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const summary = data?.summary;
  const groups = data?.groups ?? null;
  const groupNames = useMemo(() => (summary?.groupsSummary || []).map((g) => g.group), [summary]);

  const totalKeys = summary?.totals?.keys || 0;
  const totalSizeBytes = summary?.totals?.sizeBytes || 0;
  const expiring = summary?.expiry?.expiring || 0;
  const expiringPct = totalKeys ? (expiring / totalKeys) * 100 : 0;
  const groupsRaw = useMemo(() => summary?.groupsSummary || [], [summary]);

  const dominantGroup = useMemo(() => {
    if (!groupsRaw.length) return null;
    return groupsRaw.reduce((max, g) => {
      const v = metric === 'size' ? g.totalSizeBytes : g.count;
      const mv = metric === 'size' ? max.totalSizeBytes : max.count;
      return v > mv ? g : max;
    }, groupsRaw[0]);
  }, [groupsRaw, metric]);

  const topGroupSharePct = useMemo(() => {
    if (!dominantGroup) return 0;
    const pct = metric === 'size' ? dominantGroup.percentOfSize : dominantGroup.percentOfKeys;
    return hideDominant ? 0 : pct;
  }, [dominantGroup, metric, hideDominant]);

  const groupsBars = useMemo(() => {
    let arr = groupsRaw;
    if (hideDominant && dominantGroup) arr = arr.filter((g) => g.group !== dominantGroup.group);
    if (!arr.length) return [] as { label: string; percent: number; value: string }[];
    const getValue = (g: GroupSummary) => (metric === 'size' ? g.totalSizeBytes : g.count);
    const maxVisible = Math.max(...arr.map(getValue)) || 1;
    return [...arr]
      .sort((a, b) => getValue(b) - getValue(a))
      .slice(0, 8)
      .map((g) => ({
        label: g.group,
        percent: (getValue(g) / maxVisible) * 100,
        value: metric === 'size' ? `${g.percentOfSize}% · ${g.totalSize}` : `${g.percentOfKeys}% · ${g.count} keys`,
      }));
  }, [groupsRaw, dominantGroup, hideDominant, metric]);

  const usedRSSBytes = parseHumanBytes(summary?.memory?.used_memory_rss_human);
  const cacheVsRssPct = usedRSSBytes ? Math.min(100, (totalSizeBytes / usedRSSBytes) * 100) : 0;
  const topN_ = summary?.topLargestKeys || [];
  const topNBytes = topN_.reduce((s, k) => s + (k.sizeBytes || 0), 0);
  const topNSharePct = totalSizeBytes ? (topNBytes / totalSizeBytes) * 100 : 0;

  async function doDeletePrefix() {
    setDeleting(true);
    try {
      const res = await api.delete('/admin/redis/delete-by-prefix', { params: { prefix, confirm: 'true' } });
      notifySuccess(M.cache.deletedKeys(unwrap<{ totalDeleted?: number }>(res).totalDeleted ?? 0));
      setConfirmOpen(false);
      refresh();
    } catch (e: any) {
      notifyError(e, M.cache.couldntDelete);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AdminShell>
      <EditorPage>
        <EditorHeader
          icon={<IconServer />}
          title={<>Cache inspector{summary?.connection?.db != null && <StatusChip label={`Redis DB ${summary.connection.db}`} status="info" />}{loading && <span className={list.updating} style={{ fontSize: 12, fontWeight: 400 }}>Updating…</span>}</>}
          meta={['Redis keys, expiry health and the largest entries. Superadmin only.', prefix ? `Prefix ${prefix}` : 'All keys', summary?.memory?.used_memory_human ? `Redis using ${summary.memory.used_memory_human}` : null]}
          actions={
            <div className="flex items-center gap-2">
              <AdminButton variant="bordered" onPress={refresh} isDisabled={loading}>Refresh</AdminButton>
              <AdminButton variant="bordered" onPress={() => setConfirmOpen(true)} isDisabled={!prefix} className="text-[#a3413b]" title={prefix ? `Delete every key under ${prefix}` : 'Pick a prefix in the rail first'}><IconTrash /> Delete prefix…</AdminButton>
            </div>
          }
        />

        <div className={form.layout}>
          <div className={form.main}>
            {error && <div className={form.note}>{error}</div>}
            {summary?.error && <div className={form.note}>Redis inspection returned an error: <span className={styles.mono}>{summary.error}</span></div>}

            {summary && !summary.error && (
              <section className={form.panel}>
                <dl className={shared.metrics} style={{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))' }}>
                  <div className={shared.metric}><dt>Keys</dt><dd>{summary.totals?.keys ?? 0}</dd></div>
                  <div className={shared.metric}><dt>Groups</dt><dd>{summary.totals?.groups ?? 0}</dd></div>
                  <div className={shared.metric}><dt>Cached size</dt><dd>{summary.totals?.sizeHuman || '—'}</dd></div>
                  <div className={shared.metric}><dt>Average TTL</dt><dd>{fmtSecs(summary.expiry?.avgTTLSeconds)}</dd><p className={form.railMeta}>Min {fmtSecs(summary.expiry?.minTTLSeconds)} · max {fmtSecs(summary.expiry?.maxTTLSeconds)}</p></div>
                </dl>
              </section>
            )}

            {summary && !summary.error && (
              <section className={form.panel}>
                <div className={form.head}><h2>Quick visuals</h2><p>Expiry coverage, the dominant group, cache vs Redis memory and how much the largest keys weigh.</p></div>
                <div className={form.grid}>
                  <div className={`${form.full} ${styles.visuals}`}>
                    <div className={styles.donuts}>
                      <Donut percent={expiringPct} label="Keys with an expiry" sub={`${expiring} of ${totalKeys}`} />
                      <Donut percent={topGroupSharePct} label={hideDominant ? 'Dominant group hidden' : `Top group: ${dominantGroup?.group || '—'}`} sub={hideDominant ? 'Bars exclude it' : `${Math.round(topGroupSharePct)}% of ${metric}`} />
                      <Donut percent={cacheVsRssPct} label="Cache vs Redis RSS" sub={`${fmtBytes(totalSizeBytes)} of ${summary.memory?.used_memory_rss_human || '—'}`} />
                      <Donut percent={topNSharePct} label={`Top ${topN_.length} keys by size`} sub={`${fmtBytes(topNBytes)} of ${fmtBytes(totalSizeBytes)}`} />
                    </div>
                    <div className={styles.bars}>
                      <div className={styles.barsHead}><b>Groups by {metric === 'size' ? 'size' : 'keys'}</b>{dominantGroup && <span>Dominant: <b>{dominantGroup.group}</b> · {hideDominant ? 'hidden' : 'shown'}</span>}</div>
                      {groupsBars.length === 0 ? <div className={form.empty}>No groups to plot.</div> : groupsBars.map((g) => (
                        <div key={g.label} className={styles.bar}>
                          <div className={styles.barLabel}><span>{g.label}</span><span>{g.value}</span></div>
                          <div className={styles.track}><div className={styles.fill} style={{ width: `${g.percent}%` }} /></div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {summary?.topLargestKeys?.length ? (
              <section className={form.panel}>
                <div className={form.head}><h2>Largest keys <span className={form.pill}>{summary.topLargestKeys.length}</span></h2></div>
                <div className={form.grid}><KeyTable rows={summary.topLargestKeys} /></div>
              </section>
            ) : null}

            {summary?.topNearestExpiry?.length ? (
              <section className={form.panel}>
                <div className={form.head}><h2>Expiring soonest <span className={form.pill}>{summary.topNearestExpiry.length}</span></h2></div>
                <div className={form.grid}><KeyTable rows={summary.topNearestExpiry} ttlFirst /></div>
              </section>
            ) : null}

            {summary?.groupsSummary?.length ? (
              <section className={form.panel}>
                <div className={form.head}><h2>Groups <span className={form.pill}>{summary.groupsSummary.length}</span></h2><p>Keys share a group by their prefix.</p></div>
                <div className={form.grid}>
                  <div className={`${form.full} ${form.tableWrap}`}>
                    <table className={form.table} style={{ minWidth: 560 }}>
                      <thead><tr><th scope="col">Group</th><th scope="col" className={styles.num}>Keys</th><th scope="col" className={styles.num}>Size</th><th scope="col" className={styles.num}>% keys</th><th scope="col" className={styles.num}>% size</th><th scope="col" className={styles.num}>Expiring</th></tr></thead>
                      <tbody>
                        {summary.groupsSummary.map((g) => (
                          <tr key={g.group}>
                            <td><button type="button" className={form.chip} onClick={() => setPrefix(g.group)} title="Filter by this prefix">{g.group}</button></td>
                            <td className={styles.num}>{g.count}</td><td className={styles.num}>{g.totalSize}</td><td className={styles.num}>{g.percentOfKeys}%</td><td className={styles.num}>{g.percentOfSize}%</td><td className={styles.num}>{g.expiring}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            ) : null}

            {summary?.advice?.length ? (
              <section className={form.panel}>
                <div className={form.head}><h2>Advice</h2></div>
                <div className={form.grid}><ul className={`${form.full} ${styles.advice}`}>{summary.advice.map((t, i) => <li key={i}>{t}</li>)}</ul></div>
              </section>
            ) : null}

            {includeGroupItems && groups && Object.keys(groups).length > 0 && (
              <section className={form.panel}>
                <div className={form.head}><h2>Keys by group</h2><p>Groups with more than ten keys start collapsed.</p></div>
                <div className={form.grid}>
                  <div className={`${form.full} ${form.rows}`}>
                    {Object.entries(groups).map(([grp, items]) => {
                      const count = items?.length || 0;
                      const open = expandedGroups[grp] ?? count <= 10;
                      return (
                        <AccordionRow key={grp} open={open} onToggle={() => setExpandedGroups((p) => ({ ...p, [grp]: !open }))} title={grp} meta={`${count} ${count === 1 ? 'key' : 'keys'}`}>
                          <KeyTable rows={items.map((it) => ({ key: it.key, sizeBytes: it.sizeBytes || 0, ttlSeconds: it.ttlSeconds }))} />
                        </AccordionRow>
                      );
                    })}
                  </div>
                </div>
              </section>
            )}
          </div>

          <aside className={form.rail} aria-label="Inspect parameters">
            <div className={form.railGroup}>
              <div className={form.railTitle}>Scope</div>
              <Field label="Prefix" htmlFor="cache-prefix" hint="Narrows every panel and enables Delete prefix.">
                <AdminSelect id="cache-prefix" fullWidth ariaLabel="Prefix" value={prefix} onChange={setPrefix} options={[{ value: '', label: 'All keys' }, ...groupNames.map((g) => ({ value: g, label: g }))]} />
              </Field>
              <AdminInput label="Top N" type="number" min={1} value={String(topN)} onValueChange={(v) => setTopN(Number(v || 0))} description="Rows in the largest / soonest lists." />
              <AdminInput label="Oversize threshold (KB)" type="number" min={1} value={String(oversizeKB)} onValueChange={(v) => setOversizeKB(Number(v || 0))} description="Keys above this get flagged in Advice." />
            </div>
            <div className={form.railGroup}>
              <div className={form.railTitle}>View</div>
              <div className={form.toggleRow}><div><strong>Key details</strong><span>Load every key per group (slower on big caches).</span></div><AdminSwitch isSelected={includeGroupItems} onValueChange={setIncludeGroupItems} aria-label="Key details" /></div>
              <div className={form.toggleRow}><div><strong>Auto refresh</strong><span>Every 60 seconds.</span></div><AdminSwitch isSelected={autoRefresh} onValueChange={setAutoRefresh} aria-label="Auto refresh" /></div>
              <div className={form.toggleRow}><div><strong>Hide dominant group</strong><span>So the bars aren’t flattened by one huge group.</span></div><AdminSwitch isSelected={hideDominant} onValueChange={setHideDominant} aria-label="Hide dominant group" /></div>
              <Field label="Chart metric">
                <div className={form.segment} role="group" aria-label="Chart metric">
                  <button type="button" aria-pressed={metric === 'keys'} onClick={() => setMetric('keys')}>By keys</button>
                  <button type="button" aria-pressed={metric === 'size'} onClick={() => setMetric('size')}>By size</button>
                </div>
              </Field>
            </div>
          </aside>
        </div>

        <Modal isOpen={confirmOpen} onClose={() => !deleting && setConfirmOpen(false)} placement="center" size="lg" hideCloseButton classNames={{ base: modal.modal, backdrop: modal.backdrop }}>
          <ModalContent>
            <ModalHeader className={modal.header}>
              <span className={`${modal.icon} ${modal.danger}`}><IconTrash /></span>
              <div className="min-w-0 flex-1">
                <div className={modal.eyebrow}>Delete prefix</div>
                <div className={modal.title}>Delete every key under <span className={styles.mono}>{prefix}</span>?</div>
                <div className={modal.sub}>Includes the bare key <span className={styles.mono}>{prefix}</span> if it exists. This can’t be undone — the app rebuilds cached values on the next request.</div>
              </div>
              <button type="button" className={modal.close} onClick={() => setConfirmOpen(false)} aria-label="Close" disabled={deleting}><IconClose /></button>
            </ModalHeader>
            <ModalBody className={modal.body} />
            <ModalFooter className={modal.footer}>
              <AdminButton variant="bordered" onPress={() => setConfirmOpen(false)} isDisabled={deleting}>Cancel</AdminButton>
              {/* Closes itself on success and stays open on failure so the admin can retry. */}
              <AdminButton color="danger" isLoading={deleting} onPress={() => void doDeletePrefix()}>Delete keys</AdminButton>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </EditorPage>
    </AdminShell>
  );
}

function IconServer() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><line x1="7" y1="7.5" x2="7.01" y2="7.5" /><line x1="7" y1="16.5" x2="7.01" y2="16.5" /></svg>; }
