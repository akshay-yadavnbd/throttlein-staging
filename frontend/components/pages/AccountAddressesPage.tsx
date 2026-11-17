'use client';

/**
 * Customer Addresses page — `/account/addresses`.
 *
 *  - One card per address: Home/Office, the recipient, the address and the
 *    phone, with Edit / Remove / Set as default in plain sight (the default
 *    is the one checkout picks first).
 *  - Add and edit share one dialog. Typing a 6-digit pincode fills city and
 *    state from India Post; anything the customer typed for themselves stays.
 *    Problems are pointed out on the field, not in a toast.
 */
import { useEffect, useState } from 'react';
import { Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Switch, useDisclosure } from '@heroui/react';
import CustomerShell from '@/components/common/CustomerShell';
import {
  AccountHeader,
  Notice,
  accountInputClasses,
  primaryButtonClass,
  secondaryButtonClass,
} from '@/components/common/AccountUI';
import { customerApi } from '@/lib/customerApi';
import { unwrap } from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import { errorReason, notifyError, notifySuccess } from '@/lib/notify';
import { M } from '@/lib/messages';
import { addressesChanged } from '@/lib/accountSummary';

type Address = {
  _id: string;
  label?: string;
  fullName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  pincode: string;
  country?: string;
  isDefault?: boolean;
};
type Form = Omit<Address, '_id'> & { label: string; line2: string; country: string; isDefault: boolean };
type Field = 'fullName' | 'phone' | 'line1' | 'city' | 'state' | 'pincode';

const EMPTY_FORM: Form = {
  label: 'Home',
  fullName: '',
  phone: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  pincode: '',
  country: 'India',
  isDefault: false,
};
const REQUIRED: Field[] = ['fullName', 'phone', 'line1', 'pincode', 'city', 'state'];

/** 10 digits once spaces, dashes and a leading +91 / 0 are dropped. */
const phoneOk = (v: string) => /^\d{10}$/.test(v.replace(/[\s-]/g, '').replace(/^(\+?91|0)(?=\d{10}$)/, ''));

/** First problem in the form, as the field to mark and the line to show. */
function check(form: Form): { field: Field; text: string } | null {
  const missing = REQUIRED.find((k) => !form[k].trim());
  if (missing) return { field: missing, text: M.accountAddresses.fillTheMarkedFields };
  if (!phoneOk(form.phone)) return { field: 'phone', text: M.accountAddresses.enterA10DigitPhone };
  if (!/^\d{6}$/.test(form.pincode)) return { field: 'pincode', text: M.accountAddresses.enterA6DigitPincode };
  return null;
}

export default function AccountAddressesPage() {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [busyId, setBusyId] = useState<string | null>(null);

  const { isOpen, onOpen, onClose } = useDisclosure();
  const [editing, setEditing] = useState<Address | null>(null);

  function load() {
    return customerApi
      .get('/addresses')
      .then((r) => {
        setAddresses(unwrap<{ addresses?: Address[] }>(r).addresses || []);
        setState('ready');
      })
      .catch(() => setState((s) => (s === 'ready' ? s : 'failed')));
  }
  useEffect(() => {
    load();
  }, []);

  function openForm(a: Address | null) {
    setEditing(a);
    onOpen();
  }

  async function setDefault(a: Address) {
    setBusyId(a._id);
    try {
      await customerApi.patch(`/addresses/${a._id}/default`);
      await load();
      addressesChanged();
      notifySuccess(M.accountAddresses.defaultAddressSet);
    } catch (e) {
      notifyError(e, M.accountAddresses.thatDidntWork);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(a: Address) {
    const ok = await confirmDialog({
      title: 'Remove this address?',
      message: `${a.label || 'Home'} · ${[a.line1, a.city].filter(Boolean).join(', ')}`,
      destructive: true,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    setBusyId(a._id);
    try {
      await customerApi.delete(`/addresses/${a._id}`);
      await load();
      addressesChanged();
      notifySuccess(M.accountAddresses.addressRemoved);
    } catch (e) {
      notifyError(e, M.accountAddresses.thatDidntWork);
    } finally {
      setBusyId(null);
    }
  }

  // Default first, then the order they were added.
  const sorted = [...addresses].sort((a, b) => Number(!!b.isDefault) - Number(!!a.isDefault));

  return (
    <CustomerShell>
      <AccountHeader
        title="Addresses"
        description={
          state === 'ready' && addresses.length
            ? `${addresses.length} saved · checkout uses your default first`
            : 'Where your orders get delivered'
        }
        actions={
          state === 'ready' && addresses.length > 0 ? (
            <button type="button" className={primaryButtonClass} onClick={() => openForm(null)}>
              <PlusIcon />
              Add address
            </button>
          ) : null
        }
      />

      {state === 'loading' ? (
        <div className="grid gap-4 md:grid-cols-2" aria-busy="true" aria-label="Loading addresses">
          {[0, 1].map((i) => (
            <div key={i} className="space-y-3 rounded-2xl border border-[#e3e7eb] bg-white p-5">
              <div className="h-4 w-1/4 animate-pulse rounded bg-[#f0f2f4]" />
              <div className="h-3.5 w-2/3 animate-pulse rounded bg-[#f0f2f4]" />
              <div className="h-3.5 w-1/2 animate-pulse rounded bg-[#f0f2f4]" />
            </div>
          ))}
        </div>
      ) : state === 'failed' ? (
        <Empty
          title="Couldn't load your addresses"
          text="Check your connection and try again."
          action={
            <button type="button" className={secondaryButtonClass} onClick={() => window.location.reload()}>
              Try again
            </button>
          }
        />
      ) : addresses.length === 0 ? (
        <Empty
          title="No saved addresses"
          text="Save one now and checkout takes a tap next time."
          action={
            <button type="button" className={primaryButtonClass} onClick={() => openForm(null)}>
              <PlusIcon />
              Add address
            </button>
          }
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {sorted.map((a) => (
            <AddressCard
              key={a._id}
              address={a}
              busy={busyId === a._id}
              onEdit={() => openForm(a)}
              onSetDefault={() => setDefault(a)}
              onRemove={() => remove(a)}
            />
          ))}
        </ul>
      )}

      {/* Keyed so each open starts from the address being edited (or a blank form). */}
      <AddressDialog
        key={isOpen ? editing?._id || 'new' : 'closed'}
        isOpen={isOpen}
        onClose={onClose}
        editing={editing}
        firstAddress={addresses.length === 0}
        onSaved={load}
      />
    </CustomerShell>
  );
}

/* ─── One address ──────────────────────────────────────────────────── */

function AddressCard({
  address: a,
  busy,
  onEdit,
  onSetDefault,
  onRemove,
}: {
  address: Address;
  busy: boolean;
  onEdit: () => void;
  onSetDefault: () => void;
  onRemove: () => void;
}) {
  const isOffice = (a.label || '').toLowerCase() === 'office';
  const street = [a.line1, a.line2].filter((s) => s && s.trim()).join(', ');
  const place = [a.city, a.state].filter(Boolean).join(', ') + (a.pincode ? ` ${a.pincode}` : '');

  return (
    <li
      aria-busy={busy}
      className={`flex flex-col rounded-2xl border bg-white transition ${
        a.isDefault ? 'border-[#191d21]' : 'border-[#e3e7eb]'
      } ${busy ? 'opacity-60' : ''}`}
    >
      <div className="flex-1 p-5">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-[#f3f4f2] text-[#39434c]">
            {isOffice ? <OfficeIcon /> : <HomeIcon />}
          </span>
          <span className="text-sm font-semibold text-[#252c32]">{a.label || 'Home'}</span>
          {a.isDefault && (
            <span className="rounded-full bg-[#191d21] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              Default
            </span>
          )}
        </div>
        <address className="mt-3 not-italic text-[13px] leading-relaxed text-[#5d6871]">
          <span className="block font-semibold text-[#252c32]">{a.fullName}</span>
          {street && <span className="block">{street}</span>}
          <span className="block">{place}</span>
          {a.phone && <span className="mt-1 block tabular-nums text-[#74808a]">Phone {a.phone}</span>}
        </address>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[#edf0f2] px-5 py-3 text-xs font-semibold">
        <button type="button" onClick={onEdit} disabled={busy} className="rounded text-[#252c32] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#59656f]">
          Edit
        </button>
        <button type="button" onClick={onRemove} disabled={busy} className="rounded text-[#74808a] hover:text-rose-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#59656f]">
          Remove
        </button>
        {!a.isDefault && (
          <button type="button" onClick={onSetDefault} disabled={busy} className="ml-auto rounded text-[#53632d] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#59656f]">
            Set as default
          </button>
        )}
      </div>
    </li>
  );
}

/* ─── Add / edit dialog ────────────────────────────────────────────── */

type PinLookup = 'idle' | 'loading' | 'ok' | 'not-found' | 'error';

function AddressDialog({
  isOpen,
  onClose,
  editing,
  firstAddress,
  onSaved,
}: {
  isOpen: boolean;
  onClose: () => void;
  editing: Address | null;
  firstAddress: boolean;
  onSaved: () => Promise<unknown>;
}) {
  const [form, setForm] = useState<Form>(() =>
    editing
      ? {
          label: editing.label || 'Home',
          fullName: editing.fullName || '',
          phone: editing.phone || '',
          line1: editing.line1 || '',
          line2: editing.line2 || '',
          city: editing.city || '',
          state: editing.state || '',
          pincode: editing.pincode || '',
          country: editing.country || 'India',
          isDefault: !!editing.isDefault,
        }
      : { ...EMPTY_FORM, isDefault: firstAddress },
  );
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<{ field?: Field; text: string } | null>(null);
  const [lookup, setLookup] = useState<PinLookup>('idle');

  // The pincode city/state were last filled from, so a lookup only replaces
  // values it put there itself — never what the customer typed. A saved
  // address counts as already looked up, so opening it changes nothing.
  const [filledFrom, setFilledFrom] = useState<string>(editing?.pincode || '');

  const pin = form.pincode;
  useEffect(() => {
    if (!isOpen || !/^\d{6}$/.test(pin) || pin === filledFrom) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLookup('loading');
      try {
        const r = await fetch(`https://api.postalpincode.in/pincode/${pin}`, { signal: ctrl.signal });
        if (!r.ok) throw new Error('lookup-failed');
        const data = await r.json();
        const entry = Array.isArray(data) ? data[0] : null;
        const office = entry?.PostOffice?.[0];
        if (entry?.Status !== 'Success' || !office) return setLookup('not-found');
        const replace = filledFrom !== '';
        setForm((f) => ({
          ...f,
          city: replace || !f.city ? office.District || office.Division || office.Block || '' : f.city,
          state: replace || !f.state ? office.State || '' : f.state,
        }));
        setFilledFrom(pin);
        setLookup('ok');
      } catch (err) {
        if ((err as any)?.name !== 'AbortError') setLookup('error');
      }
    }, 350);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [pin, isOpen, filledFrom]);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    if (problem?.field === key) setProblem(null);
  }

  function setPincode(raw: string) {
    const next = raw.replace(/\D/g, '').slice(0, 6);
    if (next.length < 6) {
      setLookup('idle');
      // City/state that came from the old pincode go with it.
      if (filledFrom) {
        setFilledFrom('');
        setForm((f) => ({ ...f, city: '', state: '' }));
      }
    }
    set('pincode', next);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const bad = check(form);
    if (bad) {
      setProblem(bad);
      document.getElementById(`addr-${bad.field}`)?.focus();
      return;
    }
    setSaving(true);
    setProblem(null);
    try {
      if (editing) await customerApi.put(`/addresses/${editing._id}`, form);
      else await customerApi.post('/addresses', form);
      await onSaved();
      addressesChanged();
      notifySuccess(editing ? M.accountAddresses.addressUpdated : M.accountAddresses.addressAdded);
      onClose();
    } catch (err) {
      setProblem({ text: errorReason(err) });
    } finally {
      setSaving(false);
    }
  }

  const field = (key: Field, label: string, extra: Partial<React.ComponentProps<typeof Input>> = {}) => (
    <Input
      id={`addr-${key}`}
      label={label}
      labelPlacement="outside"
      placeholder=" "
      variant="bordered"
      isRequired
      value={form[key]}
      onChange={(e) => set(key, e.target.value)}
      isReadOnly={saving}
      isInvalid={problem?.field === key}
      classNames={accountInputClasses}
      {...extra}
    />
  );

  const pinHint: Record<PinLookup, string | undefined> = {
    idle: undefined,
    loading: 'Looking up city and state…',
    ok: 'City and state filled in. Edit if needed.',
    'not-found': 'Pincode not found. Enter city and state yourself.',
    error: "Couldn't look it up. Enter city and state yourself.",
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" placement="center" scrollBehavior="inside" isDismissable={!saving}>
      <ModalContent>
        <form onSubmit={save} noValidate className="contents">
          <ModalHeader className="flex flex-col gap-0.5 pb-2">
            <span className="text-base font-semibold text-[#252c32]">{editing ? 'Edit address' : 'Add address'}</span>
            <span className="text-xs font-normal text-[#74808a]">Couriers use these details to reach you.</span>
          </ModalHeader>
          <ModalBody className="gap-4">
            <fieldset>
              <legend className="mb-2 text-xs font-medium text-[#39434c]">Address type</legend>
              <div className="grid grid-cols-2 gap-2">
                {(['Home', 'Office'] as const).map((opt) => {
                  const selected = form.label.toLowerCase() === opt.toLowerCase();
                  return (
                    <label
                      key={opt}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[#59656f] ${
                        selected ? 'border-[#191d21] bg-[#f6f7f5]' : 'border-[#e2e7eb] hover:border-[#c9d1d8]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="address-type"
                        value={opt}
                        checked={selected}
                        onChange={() => set('label', opt)}
                        className="sr-only"
                      />
                      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-md ${selected ? 'bg-[#191d21] text-white' : 'bg-[#f3f4f2] text-[#39434c]'}`}>
                        {opt === 'Home' ? <HomeIcon /> : <OfficeIcon />}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold text-[#252c32]">{opt}</span>
                        <span className="block text-[11px] leading-snug text-[#74808a]">
                          {opt === 'Home' ? 'Any day' : 'Weekdays, 10am–6pm'}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              {field('fullName', 'Full name', { autoComplete: 'name', autoFocus: !editing })}
              {field('phone', 'Phone', {
                type: 'tel',
                inputMode: 'tel',
                autoComplete: 'tel',
                placeholder: '10-digit mobile number',
              })}
              <div className="sm:col-span-2">
                {field('line1', 'Address line 1', { autoComplete: 'address-line1', placeholder: 'House / flat, building, street' })}
              </div>
              <div className="sm:col-span-2">
                <Input
                  label="Address line 2"
                  labelPlacement="outside"
                  placeholder="Area, landmark (optional)"
                  variant="bordered"
                  value={form.line2}
                  onChange={(e) => set('line2', e.target.value)}
                  autoComplete="address-line2"
                  isReadOnly={saving}
                  classNames={accountInputClasses}
                />
              </div>
              {field('pincode', 'Pincode', {
                inputMode: 'numeric',
                autoComplete: 'postal-code',
                maxLength: 6,
                onChange: (e) => setPincode(e.target.value),
                description: pinHint[lookup],
              })}
              {field('city', 'City', { autoComplete: 'address-level2' })}
              {field('state', 'State', { autoComplete: 'address-level1' })}
              <Input
                label="Country"
                labelPlacement="outside"
                variant="bordered"
                value={form.country}
                onChange={(e) => set('country', e.target.value)}
                autoComplete="country-name"
                isReadOnly={saving}
                classNames={accountInputClasses}
              />
            </div>

            <Switch
              size="sm"
              isSelected={form.isDefault}
              onValueChange={(v) => set('isDefault', v)}
              isDisabled={saving || !!editing?.isDefault}
              classNames={{ label: 'text-[13px] text-[#39434c]' }}
            >
              {editing?.isDefault ? 'This is your default address' : 'Make this my default address'}
            </Switch>

            {problem && <Notice>{problem.text}</Notice>}
          </ModalBody>
          <ModalFooter className="pt-2">
            <button type="button" className={secondaryButtonClass} onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className={primaryButtonClass} disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Save address'}
            </button>
          </ModalFooter>
        </form>
      </ModalContent>
    </Modal>
  );
}

/* ─── Bits ─────────────────────────────────────────────────────────── */

function Empty({ title, text, action }: { title: string; text: string; action: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-[#d5dbe0] bg-white px-6 py-12 text-center">
      <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-[#f3f4f2] text-[#59656f]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" className="h-5 w-5" aria-hidden>
          <path d="M12 22s-7-7-7-12a7 7 0 0 1 14 0c0 5-7 12-7 12z" strokeLinejoin="round" />
          <circle cx="12" cy="10" r="2.5" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-[#252c32]">{title}</p>
      <p className="mx-auto mt-1 max-w-xs text-[13px] text-[#74808a]">{text}</p>
      <div className="mt-4 flex justify-center">{action}</div>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5" aria-hidden>
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
      <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
    </svg>
  );
}

function OfficeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M10 21v-3h4v3" />
    </svg>
  );
}
