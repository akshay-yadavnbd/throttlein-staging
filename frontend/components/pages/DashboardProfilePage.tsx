'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import styles from './DashboardProfile.module.css';
import { Card, CardBody, Input } from '@heroui/react';
import Button from '@/components/common/SellerButton';
import { DetailSkeleton, FilterTabs, StatusChip } from '@/components/ui';
import { formatDate } from '@/lib/dates';
import PasswordInput from '@/components/common/PasswordInput';
import { api, unwrap } from '@/lib/api';
import { useKycStatus, KYC_STATUS_META } from '@/lib/kyc';
import {
  getStoredUser,
  updateStoredUser,
  type SellerUser,
} from '@/lib/auth';
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';

/** Indian states + UTs — chips in the "Delivery area" exclusion picker.
 *  Names must match what customers type/pick in their shipping address
 *  (checkout compares case-insensitively on the exact name). */
const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh',
  'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka',
  'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya',
  'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim',
  'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand',
  'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi',
  'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
];

export default function DashboardProfilePage() {
  const [user, setUser] = useState<SellerUser | null>(null);
  const [loading, setLoading] = useState(true);
  const { kyc } = useKycStatus();

  // Profile form — address is intentionally omitted. The seller's structured
  // pickup address lives on the KYC page (/dashboard/kyc) and is the single
  // source of truth; duplicating an editable plain-text address here would
  // create two sources of truth and confuse sellers about which one ships use.
  const [form, setForm] = useState({
    name: '',
    storeName: '',
    phone: '',
    alternatePhone: '',
    returnPolicyDays: 7,
    exchangePolicyDays: 7,
    codEnabled: true,
    codCharge: 0,
    // false = you pay the courier (customer sees free delivery).
    deliveryPaidByCustomer: false,
    // Delivery exclusions — states this seller won't ship to (array)
    // and exact six-digit PIN codes.
    excludedStates: [] as string[],
    excludedPincodes: [] as string[],
  });
  const [pinDraft, setPinDraft] = useState('');
  const [pinError, setPinError] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const [pwForm, setPwForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [savingPw, setSavingPw] = useState(false);
  const [pwSubmitted, setPwSubmitted] = useState(false);

  /* UX audit S11: three tabs instead of one long two-column page.
     ?tab=policies deep-links from elsewhere (product form, order detail). */
  type Tab = 'account' | 'policies' | 'password';
  const [tab, setTab] = useState<Tab>('account');
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'account' || t === 'policies' || t === 'password') setTab(t);
  }, []);
  /* Searchable state picker (replaces the 36-chip wall). */
  const [stateQuery, setStateQuery] = useState('');

  const pwMismatch = useMemo(
    () =>
      pwForm.confirmPassword.length > 0 &&
      pwForm.newPassword !== pwForm.confirmPassword,
    [pwForm.newPassword, pwForm.confirmPassword]
  );

  useEffect(() => {
    const cached = getStoredUser();
    if (cached) {
      setUser(cached);
      setForm({
        name: cached.name || '',
        storeName: cached.storeName || '',
        phone: cached.phone || '',
        alternatePhone: cached.alternatePhone || '',
        returnPolicyDays: cached.returnPolicyDays ?? 7,
        exchangePolicyDays: cached.exchangePolicyDays ?? 7,
        codEnabled: cached.codEnabled !== false,
        codCharge: cached.codCharge ?? 0,
        deliveryPaidByCustomer: cached.deliveryPaidByCustomer === true,
        excludedStates: cached.excludedStates || [],
        excludedPincodes: cached.excludedPincodes || [],
      });
    }
    api
      .get('/auth/me')
      .then((r) => {
        const data = unwrap<{ user: any }>(r);
        setUser(data.user);
        setForm({
          name: data.user.name || '',
          storeName: data.user.storeName || '',
          phone: data.user.phone || '',
          alternatePhone: data.user.alternatePhone || '',
          returnPolicyDays: data.user.returnPolicyDays ?? 7,
          exchangePolicyDays: data.user.exchangePolicyDays ?? 7,
          codEnabled: data.user.codEnabled !== false,
          codCharge: data.user.codCharge ?? 0,
          deliveryPaidByCustomer: data.user.deliveryPaidByCustomer === true,
          excludedStates: data.user.excludedStates || [],
          excludedPincodes: data.user.excludedPincodes || [],
        });
        updateStoredUser(data.user);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      notifyWarning(M.profile.yourNameIsRequired);
      return;
    }
    const pins = [...new Set([...form.excludedPincodes, ...pinDraft.split(/[,\n]+/).map(p => p.trim()).filter(Boolean)])];
    if (tab === 'policies' && pins.some(p => !/^\d{6}$/.test(p))) {
      setPinError('Each PIN code must contain exactly 6 digits. Remove any older short codes above.');
      return;
    }
    if (tab === 'policies' && pins.length > 500) {
      setPinError('You can exclude up to 500 PIN codes.');
      return;
    }
    setSavingProfile(true);
    try {
      const data = unwrap<any>(await api.put('/auth/profile', {
        ...form,
        excludedPincodes: tab === 'policies' ? pins : undefined,
      }));
      updateStoredUser(data.user);
      setUser(data.user);
      if (tab === 'policies') {
        setForm(current => ({ ...current, excludedPincodes: data.user.excludedPincodes || [] }));
        setPinDraft('');
        setPinError('');
      }
      notifySuccess(M.profile.profileUpdated);
    } catch (e: any) {
      notifyError(e, M.profile.couldntSave);
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwSubmitted(true);
    if (!pwForm.currentPassword) {
      notifyWarning(M.profile.enterYourCurrentPassword);
      return;
    }
    if (pwForm.newPassword.length < 12) {
      notifyWarning(M.profile.useAtLeast12Characters);
      return;
    }
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      notifyWarning(M.profile.passwordsDoNotMatch);
      return;
    }
    setSavingPw(true);
    try {
      const changed = unwrap<any>(await api.post('/auth/change-password', {
        currentPassword: pwForm.currentPassword,
        newPassword: pwForm.newPassword,
      }));
      if (changed.token) {
        const storage = localStorage.getItem('seller_token') ? localStorage : sessionStorage;
        storage.setItem('seller_token', changed.token);
      }
      notifySuccess(M.profile.passwordUpdatedOtherDevicesSignedOut);
      setPwForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setPwSubmitted(false);
    } catch (e: any) {
      notifyError(e, M.profile.couldntChangePassword);
    } finally {
      setSavingPw(false);
    }
  }

  if (loading && !user) {
    return (
      <>
        <DetailSkeleton backPill={false} cards={2} rows={4} />
      </>
    );
  }

  const displayName = user?.storeName || user?.name || 'Your store';
  const kycMeta = KYC_STATUS_META[kyc.status];
  const accountWord =
    user?.status === 'approved' ? 'Live' : user?.status === 'suspended' ? 'Suspended' : 'Not live yet';

  const sq = stateQuery.trim().toLowerCase();
  const stateMatches = sq ? INDIAN_STATES.filter((st) => st.toLowerCase().includes(sq)) : INDIAN_STATES;
  const toggleState = (st: string, on: boolean) =>
    setForm({
      ...form,
      excludedStates: on ? [...form.excludedStates.filter((x) => x !== st), st] : form.excludedStates.filter((x) => x !== st),
    });

  const inputCls = { base:styles.field, inputWrapper: styles.inputWrapper, input: styles.input, label: styles.label, description:styles.description };

  return (
    <div className={styles.page}>
      <h1 className="sr-only">Profile</h1>
      <div className={styles.identity}>
        <div className={styles.avatar} aria-hidden="true">{displayName.split(' ').filter(Boolean).slice(0,2).map(word => word[0]).join('').toUpperCase()}</div>
        <div className={styles.identityText}><h2>{displayName}</h2><p>{user?.email}</p>{user?.createdAt && <span className={styles.joined}>Joined {formatDate(user.createdAt)}</span>}</div>
        <div className={styles.badges}>
          <div className={styles.storeStatus}><span>Store status</span><StatusChip label={accountWord} status={user?.status || 'pending'} /></div>
          <Link href="/dashboard/kyc" className={styles.verification}><span>Verification</span><span className={styles.verificationValue}><StatusChip label={kycMeta.short} status={kyc.status} /><span aria-hidden="true">→</span></span></Link></div>
      </div>
      <div className={styles.tabs}>
      <FilterTabs
        ariaLabel="Profile sections"

        onChange={(id) => setTab(id as Tab)}
        tabs={[
          { id: 'account', label: 'Account' },
          { id: 'policies', label: 'Store policies' },
          { id: 'password', label: 'Password' },
        ]}
        value={tab}
      />

      </div>

      {/* ── ACCOUNT ─────────────────────────────────────────────── */}
      {tab === 'account' && (
        <Card className={styles.card}>
          <div className={styles.sectionHeader}><h2>Store &amp; contact details</h2><p>Keep your customer-facing store name and courier contact details up to date.</p></div>
          <CardBody className={styles.cardBody}>
            <form onSubmit={saveProfile} className={styles.accountForm}>
              <Input variant="bordered" labelPlacement="outside" label="Your name" isRequired value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} classNames={inputCls} />
              <Input variant="bordered" labelPlacement="outside" label="Store name" value={form.storeName}
                onChange={(e) => setForm({ ...form, storeName: e.target.value })} classNames={inputCls}
                description="Shown to customers on your products." />
              <Input variant="bordered" labelPlacement="outside" label="Phone" type="tel" autoComplete="tel" value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })} classNames={inputCls}
                description="Couriers call this number on pickup." />
              <Input variant="bordered" labelPlacement="outside" label="Alternate phone" type="tel" placeholder="Optional" value={form.alternatePhone}
                onChange={(e) => setForm({ ...form, alternatePhone: e.target.value })} classNames={inputCls}
                description="Used if the first number doesn’t answer." />
              <Input variant="bordered" labelPlacement="outside" label="Email" value={user?.email || ''} isReadOnly classNames={inputCls}
                className="sm:col-span-2" description="Contact support to change your email." />
              <p className={styles.accountNote}>
                Your pickup address lives on the{' '}
                <Link href="/dashboard/kyc" className="font-semibold text-brand-700 hover:underline">Verification page</Link>
                , so shipping always uses the verified one.
              </p>
              <div className={styles.actions}>
                <Button type="submit" color="primary" className={styles.primary} isLoading={savingProfile}>
                  Save changes
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {/* ── STORE POLICIES ──────────────────────────────────────── */}
      {tab === 'policies' && (
        <form onSubmit={saveProfile} className={styles.policyForm}>
          <div className={styles.policySettings}>
          <Card className={styles.card}>
            <CardBody className={styles.cardBody}>
              <h2 className="text-sm font-semibold text-foreground">Returns & exchanges</h2>
              <p className="mt-1 text-xs text-muted">Days after delivery a customer can ask. 0 means not offered.</p>
              <div className={styles.windows}>
                <Input variant="bordered" labelPlacement="outside" type="number" label="Return window (days)" value={String(form.returnPolicyDays)}
                  onChange={(e) => setForm({ ...form, returnPolicyDays: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })}
                  classNames={inputCls} />
                <Input variant="bordered" labelPlacement="outside" type="number" label="Exchange window (days)" value={String(form.exchangePolicyDays)}
                  onChange={(e) => setForm({ ...form, exchangePolicyDays: Math.max(0, Math.min(365, Number(e.target.value) || 0)) })}
                  classNames={inputCls} />
              </div>
            </CardBody>
          </Card>

          {/* Who pays the courier. Off = you do, and it comes out of your
              weekly payout; on = the customer picks a courier at checkout
              and pays its rate, which is credited back to you. */}
          <Card className={styles.card}>
            <CardBody className={styles.cardBody}>
              <div className={styles.settingRow}>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Delivery charges</h2>
                  <p className="mt-1 text-xs text-muted">
                    {form.deliveryPaidByCustomer
                      ? 'Customers choose a courier at checkout and pay its rate. You’re credited that amount, so the courier’s bill costs you nothing.'
                      : 'You pay for delivery. Customers see “Free delivery”, and the courier’s charge is deducted from your weekly payout.'}
                  </p>
                </div>
                <label className={styles.toggle}>
                  <span className="text-xs text-muted">{form.deliveryPaidByCustomer ? 'Customer pays' : 'You pay'}</span>
                  <span className="relative inline-block h-5 w-10">
                    <input type="checkbox" aria-label="Customer pays delivery charges" checked={!!form.deliveryPaidByCustomer}
                      onChange={(e) => setForm({ ...form, deliveryPaidByCustomer: e.target.checked })} className="peer sr-only" />
                    <span className="absolute inset-0 rounded-full bg-border transition-colors peer-checked:bg-[#191d21] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-slate-600" />
                    <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
                  </span>
                </label>
              </div>
              {form.deliveryPaidByCustomer && (
                <p className="mt-3 rounded-lg bg-content2 px-3 py-2 text-xs text-muted">
                  Rates come straight from Shiprocket for your pickup pincode, the customer’s pincode and the parcel’s weight — no markup is added. Keep your pickup address and product weights accurate, or the quote won’t match the real bill.
                </p>
              )}
            </CardBody>
          </Card>

          <Card className={styles.card}>
            <CardBody className={styles.cardBody}>
              <div className={styles.settingRow}>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">Cash on delivery</h2>
                  <p className="mt-1 text-xs text-muted">
                    {form.codEnabled ? 'Customers can pay when the parcel arrives.' : 'Customers must pay online for your products.'}
                  </p>
                </div>
                <label className={styles.toggle}>
                  <span className="text-xs text-muted">{form.codEnabled ? 'On' : 'Off'}</span>
                  <span className="relative inline-block h-5 w-10">
                    <input type="checkbox" aria-label="Enable cash on delivery" checked={!!form.codEnabled}
                      onChange={(e) => setForm({ ...form, codEnabled: e.target.checked })} className="peer sr-only" />
                    <span className="absolute inset-0 rounded-full bg-border transition-colors peer-checked:bg-[#191d21] peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-slate-600" />
                    <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
                  </span>
                </label>
              </div>
              {form.codEnabled && (
                <div className="mt-4 max-w-xs">
                  <Input variant="bordered" labelPlacement="outside" type="number" label="Cash on delivery fee (₹)" value={String(form.codCharge ?? 0)}
                    onChange={(e) => setForm({ ...form, codCharge: Math.max(0, Math.min(999, Math.round(Number(e.target.value) || 0))) })}
                    classNames={inputCls} description="Added to the order total. 0 = no fee." />
                </div>
              )}
            </CardBody>
          </Card>

          </div>
          <Card className={`${styles.card} ${styles.deliveryAreas}`}>
            <CardBody className={styles.cardBody}>
              <h2 className="text-sm font-semibold text-foreground">Delivery areas</h2>
              <p className="mt-1 text-xs text-muted">
                You deliver everywhere your courier goes unless you exclude it here. Customers in an excluded area can’t order your products.
              </p>

              {/* Searchable multi-select (UX audit S11) — was a wall of 36
                  chips. Picked states sit above as removable pills; the
                  list below filters as you type. */}
              <div className="mt-4">
                <div className="text-xs font-medium text-muted">Excluded states</div>
                {form.excludedStates.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {form.excludedStates.map((st) => (
                      <button
                        key={st}
                        type="button"
                        onClick={() => toggleState(st, false)}
                        className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2.5 py-1 text-xs font-medium text-danger-soft-foreground hover:bg-danger/20"
                        aria-label={`Stop excluding ${st}`}
                      >
                        {st}
                        <span aria-hidden>×</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-xs text-muted">No states excluded. Delivery depends on courier coverage.</p>
                )}
                <details className={styles.statePicker}>
                  <summary><span>Choose states to exclude</span><span className={styles.selectionCount}>{form.excludedStates.length} selected</span></summary>
                <Input
                  aria-label="Search states"
                  className="mt-3"
                  classNames={inputCls}
                  isClearable
                  onClear={() => setStateQuery('')}
                  onChange={(e) => setStateQuery(e.target.value)}
                  placeholder="Search a state to exclude…"
                  size="sm"
                  value={stateQuery}
                />
                <div className={styles.stateList}>
                  {stateMatches.length === 0 ? (
                    <p className="px-3 py-3 text-xs text-muted">No state matches “{stateQuery.trim()}”.</p>
                  ) : (
                    stateMatches.map((st) => {
                      const on = form.excludedStates.includes(st);
                      return (
                        <label key={st} className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-surface-secondary">
                          <input type="checkbox" checked={on} onChange={(e) => toggleState(st, e.target.checked)} className="h-4 w-4 accent-[#191d21]" />
                          {st}
                        </label>
                      );
                    })
                  )}
                </div>
                </details>
              </div>

              <div className="mt-5">
                <label className={styles.pinLabel} htmlFor="excluded-pincodes">Excluded PIN codes</label>
                {form.excludedPincodes.length > 0 && <ul className={styles.pinChips} aria-label="Excluded PIN codes">
                  {form.excludedPincodes.map(pin => <li key={pin} className={styles.pinChip}>
                    <span>{pin}{!/^\d{6}$/.test(pin) && ' (invalid — remove)'}</span>
                    <button type="button" aria-label={`Remove PIN code ${pin}`} disabled={savingProfile}
                      onClick={() => { setForm(current => ({ ...current, excludedPincodes: current.excludedPincodes.filter(p => p !== pin) })); setPinError(''); }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
                    </button>
                  </li>)}
                </ul>}
                <Input id="excluded-pincodes" variant="bordered" aria-label="Add excluded PIN codes" placeholder="e.g. 190001, 194101"
                  value={pinDraft}
                  onChange={(e) => { setPinDraft(e.target.value); setPinError(''); }}
                  isDisabled={savingProfile}
                  isInvalid={!!pinError} errorMessage={pinError}
                  classNames={inputCls}
                  description="Enter 6-digit PIN codes, separated by commas. Save policies to apply additions or removals." />
              </div>
            </CardBody>
          </Card>

          <div className={styles.actions}>
            <p className={styles.saveHint}>Changes apply after you save your store policies.</p>
            <Button type="submit" color="primary" className={styles.primary} isLoading={savingProfile}>
              Save policies
            </Button>
          </div>
        </form>
      )}

      {/* ── PASSWORD ────────────────────────────────────────────── */}
      {tab === 'password' && (
        <Card className={`${styles.card} ${styles.passwordCard}`}>
          <div className={styles.sectionHeader}><h2>Change password</h2><p>Use a strong password to protect your seller account.</p></div>
          <CardBody className={styles.cardBody}>
            <p className="mb-4 text-xs text-muted">At least 12 characters. Changing it signs out your other devices.</p>
            <form onSubmit={changePassword} className="flex flex-col gap-4">
              <PasswordInput labelPlacement="outside" label="Current password" autoComplete="current-password" variant="bordered" value={pwForm.currentPassword}
                onChange={(e) => setPwForm({ ...pwForm, currentPassword: e.target.value })} isRequired classNames={inputCls} />
              <PasswordInput labelPlacement="outside" label="New password" autoComplete="new-password" variant="bordered" value={pwForm.newPassword}
                onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })} isRequired
                isInvalid={pwSubmitted && pwForm.newPassword.length > 0 && pwForm.newPassword.length < 12}
                errorMessage={pwSubmitted && pwForm.newPassword.length > 0 && pwForm.newPassword.length < 12 ? 'Use at least 12 characters' : undefined}
                classNames={inputCls} />
              <PasswordInput labelPlacement="outside" label="Confirm new password" autoComplete="new-password" variant="bordered" value={pwForm.confirmPassword}
                onChange={(e) => setPwForm({ ...pwForm, confirmPassword: e.target.value })} isRequired
                isInvalid={pwMismatch || (pwSubmitted && !pwForm.confirmPassword)}
                errorMessage={pwMismatch ? 'The two passwords don’t match' : pwSubmitted && !pwForm.confirmPassword ? 'Type the new password again' : undefined}
                classNames={inputCls} />
              <div className={styles.actions}>
                <Button type="submit" color="primary" className={styles.primary} isLoading={savingPw} isDisabled={pwMismatch}>
                  Change password
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
