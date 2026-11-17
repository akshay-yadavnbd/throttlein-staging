'use client';

/**
 * Security → Master access key, in the workspace form layout: identity
 * header with the key's status, one panel (status facts, then the
 * set / change form) and a rail explaining how the key behaves.
 *
 * The key is a step-up ("sudo") credential for opening a seller's
 * dashboard as that seller (the eye icon on /sellers). It needs BOTH a
 * logged-in superadmin session AND this key, and is only accepted on the
 * admin-initiated impersonation endpoint — never on the seller or
 * customer login forms. The server keeps a bcrypt hash; the plaintext is
 * never stored or returned, so this page can show status and history but
 * never the key itself. Losing it is fine — set a new one.
 */

import { useEffect, useState } from 'react';
import AdminButton from '@/components/AdminButton';
import AdminInput from '@/components/AdminInput';
import AdminShell from '@/components/AdminShell';
import { StatusChip } from '@/components/ui';
import { EditorPage, EditorHeader, EditorSkeleton } from '@/components/EditorShell';
import { api, unwrap } from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import { formatDateTime } from '@/lib/dates';
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';
import form from '@/components/AdminForm.module.css';
import shared from '@/app/sellers/[slug]/detail.module.css';

type Status = {
  configured: boolean;
  setAt: string | null;
  setByEmail: string;
  lastUsedAt: string | null;
  lastUsedFor: string;
  rotations: number;
  loginEnabled: boolean;
  loginUses: number;
  loginLastAt: string | null;
  loginLastEmail: string;
};

const fmt = (d: string | null | undefined) => (d ? formatDateTime(d) : '—');

/** Mirrors the server's floor (adminController.validateMasterKey) so the
 *  form can explain the rules before a round trip. The server is the
 *  authority — this is only a hint. */
function localStrengthIssue(k: string): string | null {
  if (k.length < 12) return 'At least 12 characters';
  if (!/[a-z]/.test(k) || !/[A-Z]/.test(k)) return 'Mix upper and lower case';
  if (!/[0-9]/.test(k)) return 'Add a number';
  if (!/[^A-Za-z0-9]/.test(k)) return 'Add a symbol';
  return null;
}

export default function SecurityPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);

  const [adminPassword, setAdminPassword] = useState('');
  const [newKey, setNewKey] = useState('');
  const [confirmKey, setConfirmKey] = useState('');
  const [reveal, setReveal] = useState(false);

  const load = () => api.get('/admin/security/master-key')
    .then((r) => { setStatus(unwrap<Status>(r)); setError(false); })
    .catch((e: any) => { notifyError(e, M.security.couldntLoadSecuritySettings); setError(true); });
  useEffect(() => { void load(); }, []);

  const strengthIssue = newKey ? localStrengthIssue(newKey) : null;
  const mismatch = Boolean(confirmKey) && newKey !== confirmKey;
  const canSubmit = !!adminPassword && !!newKey && !!confirmKey && !strengthIssue && !mismatch && !saving;
  /* Why the primary button is off, in words. */
  const blocker = !adminPassword
    ? 'Enter your admin password to continue.'
    : !newKey
      ? 'Enter the new key.'
      : !strengthIssue && !confirmKey
        ? 'Type the key again to confirm.'
        : null;

  function clearForm() {
    // Never leave the plaintext sitting in component state.
    setAdminPassword(''); setNewKey(''); setConfirmKey(''); setReveal(false);
  }

  async function save() {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await api.put('/admin/security/master-key', { adminPassword, newKey });
      notifySuccess(M.security.masterKeySaved);
      clearForm();
      void load();
    } catch (e: any) {
      notifyError(e, M.security.couldntSaveTheMasterKey);
    } finally {
      setSaving(false);
    }
  }

  /** Uses the admin-password field already on this form rather than a
   *  browser prompt, so the confirmation looks like the rest of the panel. */
  async function disable() {
    if (!adminPassword) {
      notifyWarning(M.security.enterYourAdminPasswordAboveToRemove);
      return;
    }
    const ok = await confirmDialog({
      title: 'Remove the master key?',
      message: 'Signing in as a seller falls back to asking for your own admin password. The seller dashboard stays protected either way — only the step-up credential changes.',
      confirmLabel: 'Remove key',
      destructive: true,
    });
    if (!ok) return;
    setSaving(true);
    try {
      await api.delete('/admin/security/master-key', { data: { adminPassword } });
      notifySuccess(M.security.masterKeyRemoved);
      clearForm();
      void load();
    } catch (e: any) {
      notifyError(e, M.security.couldntRemoveTheMasterKey);
    } finally {
      setSaving(false);
    }
  }

  const configured = !!status?.configured;

  return (
    <AdminShell>
      <EditorPage>
        <EditorHeader
          icon={<IconKey />}
          title={<>Master key{status && <StatusChip label={configured ? 'Active' : 'Not set'} status={configured ? 'active' : 'pending'} />}</>}
          meta={[
            'Opens any seller’s dashboard as that seller, from the eye icon on the Sellers page.',
            status && !configured ? 'Until one is set, signing in as a seller asks for your own admin password.' : null,
          ]}
        />

        {!status && !error ? (
          <EditorSkeleton label="Loading security settings" />
        ) : (
          <form className={form.layout} onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <section className={form.panel}>
              <div className={form.grid}>
                <div className={form.section}><h3>Status</h3><p>Who set the current key and when it was last used. The key itself is never shown — it’s stored hashed.</p></div>
                <dl className={`${form.full} ${shared.fields}`}>
                  <div className={shared.field}><dt>Set on</dt><dd>{fmt(status?.setAt)}</dd></div>
                  <div className={shared.field}><dt>Set by</dt><dd>{status?.setByEmail || '—'}</dd></div>
                  <div className={shared.field}><dt>Last used</dt><dd>{fmt(status?.lastUsedAt)}</dd></div>
                  <div className={shared.field}><dt>Times changed</dt><dd>{status?.rotations ?? 0}</dd></div>
                  {status?.lastUsedFor && <div className={`${shared.field} ${shared.wide}`}><dt>Last action</dt><dd>{status.lastUsedFor}</dd></div>}
                </dl>
                {/* The seller login form no longer accepts the key; the count
                    stays as history while it is non-zero. */}
                {configured && (status?.loginUses || 0) > 0 && (
                  <p className={`${form.full} ${form.info}`}>
                    Used on the old login form {status!.loginUses} time{status!.loginUses === 1 ? '' : 's'}
                    {status!.loginLastAt && <> · last {fmt(status!.loginLastAt)}</>}
                    {status!.loginLastEmail && <> as <b>{status!.loginLastEmail}</b></>}. The login form no longer accepts it.
                  </p>
                )}

                <div className={form.section}><h3>{configured ? 'Change the master key' : 'Set the master key'}</h3><p>Confirm with your own admin password. The new key replaces the old one immediately; running impersonation sessions end within 30 minutes on their own.</p></div>
                <div className={form.full}>
                  <AdminInput label="Your admin password" type="password" autoComplete="current-password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} placeholder="Your own login password" />
                </div>
                <div>
                  <AdminInput
                    label={configured ? 'New master key' : 'Master key'}
                    type={reveal ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    placeholder="12+ characters, mixed case, a number and a symbol"
                    endContent={<button type="button" className={form.linkBtn} onClick={() => setReveal((v) => !v)}>{reveal ? 'Hide' : 'Show'}</button>}
                  />
                  <div className={form.counter}>
                    <span className={newKey ? (strengthIssue ? form.counterWarn : form.counterOk) : ''}>{newKey ? (strengthIssue || 'Meets the minimum requirements') : 'At least 12 characters, mixed case, a number and a symbol.'}</span>
                  </div>
                </div>
                <div>
                  <AdminInput label="Confirm master key" type={reveal ? 'text' : 'password'} autoComplete="new-password" value={confirmKey} onChange={(e) => setConfirmKey(e.target.value)} placeholder="Type it again" isInvalid={mismatch} errorMessage={mismatch ? 'The two keys don’t match.' : undefined} />
                </div>
                <div className={`${form.full} ${form.accFoot}`}>
                  <span className={form.railMeta}>{!canSubmit && !saving && blocker ? blocker : ''}</span>
                  <div className="flex items-center gap-2">
                    {configured && <AdminButton variant="bordered" onPress={disable} isDisabled={saving} className="text-[#a3413b]">Remove key…</AdminButton>}
                    <AdminButton color="primary" type="submit" isDisabled={!canSubmit} isLoading={saving}>{configured ? 'Change key' : 'Set key'}</AdminButton>
                  </div>
                </div>
              </div>
            </section>

            <aside className={form.rail} aria-label="How the master key behaves">
              <div className={form.railTitle}>How it behaves</div>
              <ul className="flex flex-col gap-3 text-[12px] leading-relaxed text-[#55616b]">
                <li><b className="text-[#252c32]">Sellers only</b> — never customer, staff or admin accounts.</li>
                <li><b className="text-[#252c32]">Their password wins</b> — a seller’s own password is checked first, so normal sign-ins never touch the key.</li>
                <li><b className="text-[#252c32]">Sessions last 30 minutes</b> and the seller dashboard shows whose account you are in, with an exit button.</li>
                <li><b className="text-[#252c32]">Everything is recorded</b> — every use and failed attempt, with your account, IP and time.</li>
                <li><b className="text-[#252c32]">It can’t take an account over</b> — password, email, KYC and bank details are locked during the session.</li>
                <li><b className="text-[#252c32]">Only super admins</b> can see this page or use the key.</li>
                <li><b className="text-[#252c32]">If you think it leaked</b>, change it here; running sessions end within 30 minutes.</li>
              </ul>
            </aside>
          </form>
        )}
      </EditorPage>
    </AdminShell>
  );
}

function IconKey() { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="8" cy="15" r="4" /><path d="M10.85 12.15 19 4" /><path d="M18 5l2 2" /><path d="M15 8l2 2" /></svg>; }
