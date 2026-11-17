'use client';

/**
 * Notifications → who else gets told, in the workspace form layout: the
 * recipients panel on the left (one row per address with its event
 * chips, pause and test controls), "Always notified" under it, and the
 * add-an-address form in the rail.
 *
 * Order emails go to the seller who owns the items and to the customer.
 * Addresses here receive an ADDITIONAL internal copy — they never replace
 * or suppress what sellers and customers get. Subscriptions are
 * per-address rather than one global list: an ops inbox that wants every
 * order is a different audience from a finance address that only wants
 * refunds.
 */

import { useEffect, useState } from 'react';
import AdminButton from '@/components/AdminButton';
import AdminInput from '@/components/AdminInput';
import AdminShell from '@/components/AdminShell';
import { RowActions, StatusChip } from '@/components/ui';
import { EditorPage, EditorHeader, EditorSkeleton, IconButton, IconTrash } from '@/components/EditorShell';
import { api, unwrap } from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import { formatDate } from '@/lib/dates';
import { notifyError, notifySuccess } from '@/lib/notify';
import { M } from '@/lib/messages';
import form from '@/components/AdminForm.module.css';
import list from '@/components/WorkspaceList.module.css';

type EventDef = { key: string; label: string; description: string };
type Recipient = {
  _id: string;
  email: string;
  label?: string;
  events: Record<string, boolean>;
  active: boolean;
  addedByEmail?: string;
  addedAt?: string;
  lastSentAt?: string | null;
};
type Settings = { events: EventDef[]; recipients: Recipient[]; alwaysNotified: string[] };

const fmt = (d?: string | null) => (d ? formatDate(d) : '—');

export default function NotificationsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // New-recipient form — defaults to "new orders", the common case.
  const [email, setEmail] = useState('');
  const [label, setLabel] = useState('');
  const [picked, setPicked] = useState<Record<string, boolean>>({ orderPlaced: true });
  const [adding, setAdding] = useState(false);

  const load = () => api.get('/admin/notifications')
    .then((r) => {
      const data = unwrap<{ events?: any[]; recipients?: Recipient[]; alwaysNotified?: any[] }>(r);
      setSettings({ events: data.events || [], recipients: data.recipients || [], alwaysNotified: data.alwaysNotified || [] }); setError(false);
    })
    .catch((e: any) => { notifyError(e, M.notifications.couldntLoadNotificationSettings); setError(true); });
  useEffect(() => { void load(); }, []);

  const events = settings?.events || [];
  const rows = settings?.recipients || [];
  const setRows = (recipients: Recipient[]) => setSettings((s) => (s ? { ...s, recipients } : s));
  const anyPicked = Object.values(picked).some(Boolean);

  async function add() {
    if (!email.trim() || !anyPicked) return;
    setAdding(true);
    try {
      const data = unwrap<{ recipients?: Recipient[] }>(await api.post('/admin/notifications', { email: email.trim(), label: label.trim(), events: picked }));
      setRows(data.recipients || []);
      setEmail(''); setLabel(''); setPicked({ orderPlaced: true });
      notifySuccess(M.notifications.recipientAdded);
    } catch (e: any) {
      notifyError(e, M.notifications.couldntAddThatAddress);
    } finally {
      setAdding(false);
    }
  }

  /** Re-render from the server's copy so the UI can't drift from what is stored. */
  async function patch(r: Recipient, body: Partial<Recipient> | { events: Record<string, boolean> }) {
    setBusy(r._id);
    try {
      const data = unwrap<{ recipients?: Recipient[] }>(await api.patch(`/admin/notifications/${r._id}`, body));
      setRows(data.recipients || []);
    } catch (e: any) {
      notifyError(e, M.notifications.couldntUpdateThatAddress);
    } finally {
      setBusy(null);
    }
  }

  async function remove(r: Recipient) {
    const ok = await confirmDialog({
      title: `Remove ${r.email}?`,
      message: 'It stops receiving these copies. You can add it back any time.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    setBusy(r._id);
    try {
      const data = unwrap<{ recipients?: Recipient[] }>(await api.delete(`/admin/notifications/${r._id}`));
      setRows(data.recipients || []);
      notifySuccess(M.notifications.recipientRemoved);
    } catch (e: any) {
      notifyError(e, M.notifications.couldntRemoveThatAddress);
    } finally {
      setBusy(null);
    }
  }

  async function sendTest(r: Recipient) {
    setBusy(r._id);
    try {
      await api.post(`/admin/notifications/${r._id}/test`);
      notifySuccess(M.notifications.testEmailSent(r.email || 'the inbox'));
      void load();
    } catch (e: any) {
      notifyError(e, M.notifications.couldntSendTheTestEmail);
    } finally {
      setBusy(null);
    }
  }

  const activeCount = rows.filter((r) => r.active).length;

  return (
    <AdminShell>
      <EditorPage>
        <EditorHeader
          icon={<IconBell />}
          title="Notifications"
          meta={[
            'Internal copies of order, return and seller activity. Sellers and customers keep getting their own emails either way.',
            settings ? `${rows.length} ${rows.length === 1 ? 'address' : 'addresses'} · ${activeCount} active` : null,
          ]}
        />

        {!settings && !error ? (
          <EditorSkeleton label="Loading notification settings" />
        ) : (
          <div className={form.layout}>
            <div className={form.main}>
              <section className={form.panel} aria-labelledby="recipients-heading">
                <div className={form.head}>
                  <h2 id="recipients-heading">Recipients</h2>
                  <p>Each address picks its own events. Recipients are blind-copied, so they don’t see each other; an order with several sellers sends one summary email.</p>
                </div>
                {rows.length === 0 ? (
                  <div className={list.state}><h3>No extra addresses yet</h3><p>Add one on the right to get an internal copy of order, return and seller activity.</p></div>
                ) : (
                  <div className={form.grid} style={{ gap: 12 }}>
                    {rows.map((r) => {
                      const isBusy = busy === r._id;
                      return (
                        <div key={r._id} className={`${form.full} ${form.rowStack}`} style={{ opacity: isBusy ? 0.6 : 1 }}>
                          <div className={form.sectionRow}>
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={list.primary} style={{ fontSize: 13, textDecoration: r.active ? undefined : 'line-through' }}>{r.email}</span>
                                {r.label && <span className={form.pill}>{r.label}</span>}
                                {!r.active && <StatusChip label="Paused" status="pending" />}
                              </div>
                              <div className={form.railMeta} style={{ marginTop: 2 }}>Added {fmt(r.addedAt)}{r.addedByEmail ? ` by ${r.addedByEmail}` : ''} · Last sent {fmt(r.lastSentAt)}</div>
                            </div>
                            <div className="flex items-center gap-1">
                              <RowActions ariaLabel={`More actions for ${r.email}`} items={[
                                { key: 'test', label: 'Send a test email', hint: r.email, onSelect: () => sendTest(r) },
                                r.active
                                  ? { key: 'pause', label: 'Pause copies', hint: 'Keeps the address and its events', onSelect: () => patch(r, { active: false }) }
                                  : { key: 'resume', label: 'Resume copies', onSelect: () => patch(r, { active: true }) },
                              ]} />
                              <IconButton label={`Remove ${r.email}`} danger disabled={isBusy} onClick={() => remove(r)}><IconTrash /></IconButton>
                            </div>
                          </div>
                          <div className={form.chips}>
                            {events.map((ev) => {
                              const on = !!r.events?.[ev.key];
                              return (
                                <button key={ev.key} type="button" className={on ? form.chip : form.suggest} disabled={isBusy} title={ev.description} aria-pressed={on} onClick={() => patch(r, { events: { ...r.events, [ev.key]: !on } })}>
                                  {on ? '✓ ' : '+ '}{ev.label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Server-configured addresses, read-only, so the list above
                  doesn't look wrong when signup/KYC mail arrives at an
                  address that isn't in it. */}
              {(settings?.alwaysNotified.length || 0) > 0 && (
                <section className={form.panel} aria-labelledby="always-heading">
                  <div className={form.head}>
                    <h2 id="always-heading">Always notified</h2>
                    <p>These addresses get every seller sign-up and KYC alert. The tech team manages this list — ask them to add or remove an address.</p>
                  </div>
                  <div className={form.grid}><div className={`${form.full} ${form.chips}`}>{settings!.alwaysNotified.map((a) => <span key={a} className={form.chip} style={{ paddingRight: 10 }}>{a}</span>)}</div></div>
                </section>
              )}
            </div>

            <aside className={form.rail} aria-label="Add an address">
              <div className={form.railTitle}>Add an address</div>
              <AdminInput label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && anyPicked) void add(); }} placeholder="ops@yourcompany.com" />
              <AdminInput label="Label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ops inbox" description="Optional — who this inbox is for." />
              <div>
                <div className={form.label}>Send them</div>
                <div className={form.checkList} style={{ maxHeight: 'none' }}>
                  {events.map((ev) => (
                    <label key={ev.key} className={form.checkRow} style={{ alignItems: 'flex-start' }} title={ev.description}>
                      <input type="checkbox" checked={!!picked[ev.key]} onChange={(e) => setPicked((p) => ({ ...p, [ev.key]: e.target.checked }))} style={{ marginTop: 2 }} />
                      <span><span className="block">{ev.label}</span><span className={form.railHint}>{ev.description}</span></span>
                    </label>
                  ))}
                </div>
              </div>
              <div className={form.railActions}>
                <AdminButton color="primary" onPress={add} isLoading={adding} isDisabled={!email.trim() || !anyPicked}>Add recipient</AdminButton>
                {!anyPicked && <p className={form.railNote}>Pick at least one event.</p>}
              </div>
            </aside>
          </div>
        )}
      </EditorPage>
    </AdminShell>
  );
}

function IconBell() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>; }
