'use client';

/**
 * Customer Profile page — `/account/profile`.
 *
 * Two separate panels, each saving on its own:
 *  - Personal details: read view with an Edit button; editing changes the
 *    name and phone (email changes go through support).
 *  - Password: change it with the current one; the rules (12+ characters,
 *    at most 72 UTF-8 bytes, both fields equal) show as a live checklist.
 *    A wrong current password is said inline and keeps the customer signed
 *    in (lib/customerApi.ts excludes this endpoint from its 401 sign-out).
 */
import { useEffect, useState } from 'react';
import { Input } from '@heroui/react';
import CustomerShell from '@/components/common/CustomerShell';
import PasswordInput from '@/components/common/PasswordInput';
import {
  AccountHeader,
  Notice,
  Panel,
  accountInputClasses,
  panelLinkClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '@/components/common/AccountUI';
import { customerApi } from '@/lib/customerApi';
import { apiMessage, errorReason, notifySuccess } from '@/lib/notify';
import { unwrap } from '@/lib/api';
import { getStoredCustomer, updateStoredCustomer, updateStoredCustomerToken, type CustomerUser } from '@/lib/customerAuth';
import { formatDate } from '@/lib/dates';
import { M } from '@/lib/messages';

const MIN_CHARS = 12;
const MAX_BYTES = 72;
const bytes = (s: string) => new TextEncoder().encode(s).length;
const EMPTY_PW = { current: '', next: '', confirm: '' };

export default function AccountProfilePage() {
  const [user, setUser] = useState<CustomerUser | null>(null);

  useEffect(() => {
    customerApi
      .get('/auth/me')
      .then((r) => {
        const fresh = unwrap<{ user: CustomerUser }>(r).user;
        updateStoredCustomer(fresh);
        setUser(fresh);
      })
      // Offline or slow: show what this device already knows.
      .catch(() => setUser(getStoredCustomer()));
  }, []);

  const memberSince = (user as any)?.createdAt ? formatDate((user as any).createdAt) : null;

  return (
    <CustomerShell>
      <AccountHeader
        title="Profile"
        description={memberSince ? `Your details and password · member since ${memberSince}` : 'Your details and password'}
      />
      <div className="grid gap-5 xl:grid-cols-2 xl:items-start">
        <DetailsPanel user={user} onSaved={setUser} />
        <PasswordPanel />
      </div>
    </CustomerShell>
  );
}

/* ─── Personal details ─────────────────────────────────────────────── */

function DetailsPanel({ user, onSaved }: { user: CustomerUser | null; onSaved: (u: CustomerUser) => void }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '' });
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  function startEditing() {
    setForm({ name: user?.name || '', phone: user?.phone || '' });
    setProblem(null);
    setEditing(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setProblem(M.accountProfile.nameIsRequired);
      document.getElementById('profile-name')?.focus();
      return;
    }
    setSaving(true);
    setProblem(null);
    try {
      const saved = unwrap<{ user: CustomerUser }>(
        await customerApi.put('/auth/profile', { name: form.name.trim(), phone: form.phone.trim() }),
      ).user;
      updateStoredCustomer(saved);
      onSaved(saved);
      notifySuccess(M.accountProfile.profileUpdated);
      setEditing(false);
    } catch (err) {
      setProblem(errorReason(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      title="Personal details"
      action={
        !editing && user ? (
          <button type="button" onClick={startEditing} className={panelLinkClass}>
            Edit
          </button>
        ) : null
      }
    >
      {!user ? (
        <div className="space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-4 w-2/3 animate-pulse rounded bg-[#f0f2f4]" />
          ))}
        </div>
      ) : editing ? (
        <form onSubmit={save} className="flex flex-col gap-4" noValidate>
          <Input
            id="profile-name"
            label="Name"
            labelPlacement="outside"
            placeholder=" "
            variant="bordered"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            autoComplete="name"
            autoFocus
            isReadOnly={saving}
            isInvalid={problem === M.accountProfile.nameIsRequired}
            classNames={accountInputClasses}
          />
          <Input
            label="Phone"
            labelPlacement="outside"
            placeholder="10-digit mobile number"
            variant="bordered"
            type="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            autoComplete="tel"
            isReadOnly={saving}
            description="Couriers call this number about deliveries."
            classNames={accountInputClasses}
          />
          <Input
            label="Email"
            labelPlacement="outside"
            variant="bordered"
            value={user.email || ''}
            isReadOnly
            isDisabled
            description="Contact support to change your email."
            classNames={accountInputClasses}
          />
          {problem && <Notice>{problem}</Notice>}
          <div className="flex items-center gap-2">
            <button type="submit" className={primaryButtonClass} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
            <button type="button" className={secondaryButtonClass} onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <dl className="grid gap-3 text-[13px]">
          <Row label="Name" value={user.name} />
          <Row label="Email" value={user.email} />
          <Row
            label="Phone"
            value={user.phone}
            empty={
              <button type="button" onClick={startEditing} className={panelLinkClass}>
                Add a phone number
              </button>
            }
          />
        </dl>
      )}
    </Panel>
  );
}

function Row({ label, value, empty }: { label: string; value?: string; empty?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] items-baseline gap-3">
      <dt className="text-[#74808a]">{label}</dt>
      <dd className="min-w-0 truncate font-medium text-[#252c32]">{value || empty || '—'}</dd>
    </div>
  );
}

/* ─── Password ─────────────────────────────────────────────────────── */

function PasswordPanel() {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState(EMPTY_PW);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<{ text: string; field?: 'current' | 'next' | 'confirm' } | null>(null);

  const longEnough = pw.next.length >= MIN_CHARS;
  const notTooLong = bytes(pw.next) <= MAX_BYTES;
  const matches = pw.confirm.length > 0 && pw.confirm === pw.next;

  const fail = (text: string, field?: 'current' | 'next' | 'confirm') => {
    setProblem({ text, field });
    if (field) {
      const el = document.getElementById(`pw-${field}`) as HTMLInputElement | null;
      el?.focus();
      el?.select();
    }
  };

  function close() {
    setOpen(false);
    setPw(EMPTY_PW);
    setProblem(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!pw.current) return fail(M.accountProfile.enterYourCurrentPassword, 'current');
    if (!longEnough) return fail(M.accountProfile.newPasswordMustBeAtLeast12, 'next');
    if (!notTooLong) return fail(M.accountProfile.passwordTooLong, 'next');
    if (!matches) return fail(M.accountProfile.passwordsDoNotMatch, 'confirm');
    setSaving(true);
    setProblem(null);
    try {
      const res = unwrap<{ token?: string }>(
        await customerApi.post('/auth/change-password', { currentPassword: pw.current, newPassword: pw.next }),
      );
      // The server signs out every other session and hands this device a new token.
      if (res?.token) updateStoredCustomerToken(res.token);
      notifySuccess(M.accountProfile.passwordUpdatedOtherDevicesSignedOut);
      close();
    } catch (err: any) {
      const status = Number(err?.response?.status) || 0;
      if (status === 401) fail(M.accountProfile.currentPasswordIsWrong, 'current');
      else if (status === 429) fail(apiMessage(err) || M.accountProfile.tooManyPasswordAttempts);
      else fail(errorReason(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      title="Password"
      action={
        !open ? (
          <button type="button" onClick={() => setOpen(true)} className={panelLinkClass}>
            Change
          </button>
        ) : null
      }
    >
      {!open ? (
        <p className="text-[13px] text-[#5d6871]">
          Changing it signs you out everywhere else; this device stays signed in.
        </p>
      ) : (
        <form onSubmit={save} className="flex flex-col gap-4" noValidate>
          <PasswordInput
            id="pw-current"
            label="Current password"
            labelPlacement="outside"
            placeholder=" "
            value={pw.current}
            onChange={(e) => setPw({ ...pw, current: e.target.value })}
            autoComplete="current-password"
            autoFocus
            isReadOnly={saving}
            isInvalid={problem?.field === 'current'}
            classNames={accountInputClasses}
          />
          <PasswordInput
            id="pw-next"
            label="New password"
            labelPlacement="outside"
            placeholder="At least 12 characters"
            value={pw.next}
            onChange={(e) => setPw({ ...pw, next: e.target.value })}
            autoComplete="new-password"
            isReadOnly={saving}
            isInvalid={problem?.field === 'next'}
            classNames={accountInputClasses}
          />
          <PasswordInput
            id="pw-confirm"
            label="Confirm new password"
            labelPlacement="outside"
            placeholder="Type it again"
            value={pw.confirm}
            onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
            autoComplete="new-password"
            isReadOnly={saving}
            isInvalid={problem?.field === 'confirm'}
            classNames={accountInputClasses}
          />
          <ul className="grid gap-1.5" aria-label="Password requirements">
            <Rule met={longEnough}>At least 12 characters</Rule>
            {!notTooLong && <Rule met={false}>At most 72 characters</Rule>}
            <Rule met={matches}>Both new passwords match</Rule>
          </ul>
          {problem && <Notice>{problem.text}</Notice>}
          <div className="flex items-center gap-2">
            <button type="submit" className={primaryButtonClass} disabled={saving}>
              {saving ? 'Updating…' : 'Update password'}
            </button>
            <button type="button" className={secondaryButtonClass} onClick={close} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </Panel>
  );
}

function Rule({ met, children }: { met: boolean; children: React.ReactNode }) {
  return (
    <li className={`flex items-center gap-2 text-xs ${met ? 'text-[#4b6b16]' : 'text-[#74808a]'}`}>
      <span
        aria-hidden
        className={`grid h-3.5 w-3.5 place-items-center rounded-full border-[1.5px] ${
          met ? 'border-[#5c7d1c] bg-[#5c7d1c] text-white' : 'border-[#c3cad0]'
        }`}
      >
        {met && (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" className="h-2 w-2">
            <path d="m5 12 5 5 9-10" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      {children}
    </li>
  );
}
