'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Arrow from '@/components/common/Arrow';
import styles from './DashboardKyc.module.css';
import { Card, CardBody, CardHeader, Input, Spinner, Chip } from '@heroui/react';
import Button from '@/components/common/SellerButton';
import PickupLocationFields from '@/components/common/PickupLocationFields';
import { DetailSkeleton } from '@/components/ui';
import { api, imageUrl, unwrap } from '@/lib/api';
import { useKycStatus, type KycPickupAddress } from '@/lib/kyc';
import { kycChangeSections } from '@/lib/kycChanges';
import { notifyError, notifySuccess, notifyWarning, apiMessage } from '@/lib/notify';
import { M } from '@/lib/messages';

const GST_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const PIN_RE = /^[1-9][0-9]{5}$/;

type BankDetails = {
  accountHolder: string;
  accountNumber: string;
  ifsc: string;
  bankName: string;
  cancelledCheque: string;
};

// PickupAddress here is the postal half only — contact name/phone/email are
// pulled from the seller's account record on the server, so we don't ask
// for what they already gave us at signup.
type PickupAddressPostal = Pick<KycPickupAddress, 'line1' | 'line2' | 'city' | 'state' | 'pincode' | 'country'>;

type Form = {
  gstin: string;
  pan: string;
  gstCertificate: string;
  panCard: string;
  pickupAddress: PickupAddressPostal;
  bankDetails: BankDetails;
};

const EMPTY_FORM: Form = {
  gstin: '',
  pan: '',
  gstCertificate: '',
  panCard: '',
  pickupAddress: {
    line1: '',
    line2: '',
    city: '',
    state: '',
    pincode: '',
    country: 'India',
  },
  bankDetails: {
    accountHolder: '',
    accountNumber: '',
    ifsc: '',
    bankName: '',
    cancelledCheque: '',
  },
};

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACC_NO_RE = /^[0-9]{9,18}$/;

export default function DashboardKycPage() {
  const { kyc: approvedKyc, revision, loading, refresh } = useKycStatus();
  const kyc = revision || approvedKyc;
  const [editing, setEditing] = useState(false);
  const [editSnapshot, setEditSnapshot] = useState<Form | null>(null);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<'gst' | 'pan' | 'cheque' | null>(null);
  const changedSections = editSnapshot ? kycChangeSections(form, editSnapshot) : [];
  const unchangedRevision = approvedKyc.status === 'approved' && changedSections.length === 0;

  // Hydrate form from existing kyc when available (for re-submission after rejection)
  useEffect(() => {
    if (!loading && kyc) {
      setForm({
        gstin: kyc.gstin || '',
        pan: kyc.pan || '',
        gstCertificate: kyc.gstCertificate || '',
        panCard: kyc.panCard || '',
        pickupAddress: {
          line1:   kyc.pickupAddress?.line1 || '',
          line2:   kyc.pickupAddress?.line2 || '',
          city:    kyc.pickupAddress?.city || '',
          state:   kyc.pickupAddress?.state || '',
          pincode: kyc.pickupAddress?.pincode || '',
          country: kyc.pickupAddress?.country || 'India',
        },
        bankDetails: {
          accountHolder:   (kyc as any).bankDetails?.accountHolder || '',
          accountNumber:   (kyc as any).bankDetails?.accountNumber || '',
          ifsc:            (kyc as any).bankDetails?.ifsc || '',
          bankName:        (kyc as any).bankDetails?.bankName || '',
          cancelledCheque: (kyc as any).bankDetails?.cancelledCheque || '',
        },
      });
    }
  }, [loading, kyc]);

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    const g = form.gstin.toUpperCase().trim();
    const p = form.pan.toUpperCase().trim();
    if (!g) e.gstin = 'GSTIN is required';
    else if (!GST_RE.test(g)) e.gstin = 'Format: 22ABCDE1234F1Z5';
    if (!p) e.pan = 'PAN is required';
    else if (!PAN_RE.test(p)) e.pan = 'Format: ABCDE1234F';
    if (!form.gstCertificate) e.gstCertificate = 'Upload GST certificate';
    if (!form.panCard) e.panCard = 'Upload PAN card';

    const a = form.pickupAddress;
    if (!a.line1?.trim())   e['pa.line1'] = 'Required';
    if (!a.city?.trim())    e['pa.city'] = 'Required';
    if (!a.state?.trim())   e['pa.state'] = 'Required';
    if (!a.pincode?.trim()) e['pa.pincode'] = 'Required';
    else if (!PIN_RE.test(a.pincode)) e['pa.pincode'] = '6 digits';

    const b = form.bankDetails;
    if (!b.accountHolder.trim()) e['bd.accountHolder'] = 'Required';
    const an = b.accountNumber.replace(/\s+/g, '');
    if (!an) e['bd.accountNumber'] = 'Account number is required';
    else if (!ACC_NO_RE.test(an)) e['bd.accountNumber'] = 'Account number must contain 9–18 digits';
    const ifsc = b.ifsc.toUpperCase().trim();
    if (!ifsc) e['bd.ifsc'] = 'IFSC code is required';
    else if (!IFSC_RE.test(ifsc)) e['bd.ifsc'] = 'Enter a valid 11-character IFSC code, e.g. HDFC0001234';
    if (!b.bankName.trim()) e['bd.bankName'] = 'Required';
    if (!b.cancelledCheque) e['bd.cancelledCheque'] = 'Upload a cancelled cheque';

    return e;
  }, [form]);

  const hasErrors = Object.keys(errors).length > 0;

  function setAddr<K extends keyof PickupAddressPostal>(k: K, v: string) {
    setForm((f) => ({ ...f, pickupAddress: { ...f.pickupAddress, [k]: v } }));
  }

  function setBank<K extends keyof BankDetails>(k: K, v: string) {
    setForm((f) => ({ ...f, bankDetails: { ...f.bankDetails, [k]: v } }));
    if (k === 'accountNumber' || k === 'ifsc') {
      setTouched((t) => ({ ...t, [`bd.${k}`]: true }));
    }
  }

  async function handleFileUpload(file: File, slot: 'gst' | 'pan' | 'cheque') {
    setUploading(slot);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const data = unwrap<{ url: string }>(await api.post('/seller/kyc/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }));
      if (slot === 'gst') {
        setForm((f) => ({ ...f, gstCertificate: data.url }));
      } else if (slot === 'pan') {
        setForm((f) => ({ ...f, panCard: data.url }));
      } else {
        setForm((f) => ({
          ...f,
          bankDetails: { ...f.bankDetails, cancelledCheque: data.url },
        }));
      }
      notifySuccess(M.kyc.fileUploaded);
    } catch (e: any) {
      notifyError(e, M.kyc.couldntUpload);
    } finally {
      setUploading(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (saving || uploading !== null || unchangedRevision) return;
    // Mark every field touched so all errors show
    const t: Record<string, boolean> = {};
    Object.keys(errors).forEach((k) => { t[k] = true; });
    setTouched((prev) => ({ ...prev, ...t, _submitted: true }));
    if (hasErrors) {
      notifyWarning(M.kyc.pleaseFixTheHighlightedFields);
      return;
    }

    setSaving(true);
    try {
      await api.post('/seller/kyc', {
        gstin: form.gstin.toUpperCase().trim(),
        pan: form.pan.toUpperCase().trim(),
        gstCertificate: form.gstCertificate,
        panCard: form.panCard,
        pickupAddress: form.pickupAddress,
        bankDetails: {
          ...form.bankDetails,
          accountNumber: form.bankDetails.accountNumber.replace(/\s+/g, ''),
          ifsc: form.bankDetails.ifsc.toUpperCase().trim(),
        },
      });
      notifySuccess(M.kyc.kYCSubmittedWellReviewWithin2448);
      setEditing(false);
      await refresh();
    } catch (e: any) {
      notifyError(e, M.kyc.submissionFailed);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <>
        <DetailSkeleton backPill={false} cards={3} rows={4} />
      </>
    );
  }

  const status = kyc.status;
  const isLocked = !editing && (status === 'pending' || status === 'approved' || approvedKyc.status === 'approved');

  return (
    <div className={styles.page}>
      <h1 className="sr-only">Verification</h1>
      {/* Pre-approval states only (not_started / pending / rejected). Once
          approved, SellerReadinessCard below is the single source of status —
          previously an "KYC approved" banner ALSO rendered here, giving the
          seller three stacked green cards that all said "you're fine". */}
      {status !== 'approved' && !revision && (
        <StatusBanner status={status} reason={kyc.rejectionReason} />
      )}

      {/* One card, one answer: can I sell and ship right now? The individual
          facts (KYC, seller confirmation, courier registration, courier phone
          check) are a collapsed checklist inside it. */}
      {approvedKyc.status === 'approved' && !editing && <SellerReadinessCard kycApproved />}
      {approvedKyc.status === 'approved' && <div className={styles.changeRequest}>
        <div><h2>{editing ? 'Update verification details' : revision?.status === 'pending' ? 'Changes awaiting admin review' : revision?.status === 'rejected' ? 'Changes need attention' : 'Need to update your details?'}</h2>
          <p>Your approved tax, bank and pickup details stay active until an admin approves your changes.</p>
          {revision?.rejectionReason && <p role="status">Reason: {revision.rejectionReason}</p>}
        </div>
        {!editing && revision?.status !== 'pending' && <Button color="primary" onPress={() => { setEditSnapshot(structuredClone(form)); setTouched({}); setEditing(true); }}>Edit details</Button>}
        {editing && <Button variant="bordered" isDisabled={saving || uploading !== null} onPress={() => { if (editSnapshot) setForm(editSnapshot); setEditing(false); setTouched({}); }}>Cancel changes</Button>}
      </div>}

      {/* UX audit S10: once submitted or verified, the page is a summary,
          not a form. The old page kept every input on screen with
          isDisabled — grey fields that still looked editable, under
          "Step 1 of 3" headings on an account that finished all three. */}
      {isLocked && <SubmittedDetails form={form} status={status} />}

      {/* Form — only while the seller can still change something */}
      {!isLocked && (
      <form onSubmit={submit} className={styles.form}>
        {/* ── Tax IDs ── */}
        <Card className={styles.card}>
          <CardHeader className={styles.cardHeader}>
            <div>
              <h2 className={styles.formTitle}>Tax IDs & documents</h2>
              <p className={styles.formHint}>Update your tax information and supporting documents.</p>
            </div>
          </CardHeader>
          <CardBody className={styles.cardBody}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input classNames={{ inputWrapper: styles.inputWrapper, input: styles.input, label: styles.label }} labelPlacement="outside"
                label="GSTIN"
                placeholder="22ABCDE1234F1Z5"
                value={form.gstin}
                onChange={(e) => setForm((f) => ({ ...f, gstin: e.target.value.toUpperCase() }))}
                onBlur={() => setTouched((t) => ({ ...t, gstin: true }))}
                isRequired
                isInvalid={(touched.gstin || touched._submitted) && !!errors.gstin}
                errorMessage={touched.gstin || touched._submitted ? errors.gstin : ''}
                variant="bordered"
                description="15 characters"
              />
              <Input classNames={{ inputWrapper: styles.inputWrapper, input: styles.input, label: styles.label }} labelPlacement="outside"
                label="PAN"
                placeholder="ABCDE1234F"
                value={form.pan}
                onChange={(e) => setForm((f) => ({ ...f, pan: e.target.value.toUpperCase() }))}
                onBlur={() => setTouched((t) => ({ ...t, pan: true }))}
                isRequired
                isInvalid={(touched.pan || touched._submitted) && !!errors.pan}
                errorMessage={touched.pan || touched._submitted ? errors.pan : ''}
                variant="bordered"
                description="10 characters"
              />
              <FileSlot
                label="GST certificate"
                value={form.gstCertificate}
                onUpload={(f) => handleFileUpload(f, 'gst')}
                onClear={() => setForm((f) => ({ ...f, gstCertificate: '' }))}
                uploading={uploading === 'gst'}
                error={touched._submitted ? errors.gstCertificate : ''}
              />
              <FileSlot
                label="PAN card"
                value={form.panCard}
                onUpload={(f) => handleFileUpload(f, 'pan')}
                onClear={() => setForm((f) => ({ ...f, panCard: '' }))}
                uploading={uploading === 'pan'}
                error={touched._submitted ? errors.panCard : ''}
              />
            </div>
          </CardBody>
        </Card>

        {/* ── Pickup address ── */}
        <Card className={styles.card}>
          <CardHeader className={styles.cardHeader}>
            <div>
              <h2 className={styles.formTitle}>Pickup address</h2>
              <div className="text-xs text-muted mt-1">
                Where the courier will collect your packages. Must match the address on your GST cert if possible.
              </div>
            </div>
          </CardHeader>
          <CardBody className={styles.cardBody}>
            <div className="mb-4 rounded-lg border border-default-200 bg-default-50/70 px-4 py-2.5 text-xs text-default-600 leading-relaxed">
              The courier will contact you using the <span className="font-semibold text-brand-black">name, phone and email on your profile</span>.
              Update those on the <Link href="/dashboard/profile" className="font-semibold text-brand-700 hover:underline">profile page</Link> if anything has changed.
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Input classNames={{ inputWrapper: styles.inputWrapper, input: styles.input, label: styles.label }} labelPlacement="outside"
                label="Address line 1"
                placeholder="House / building no, street"
                value={form.pickupAddress.line1}
                onChange={(e) => setAddr('line1', e.target.value)}
                isRequired variant="bordered"
                className="sm:col-span-2 lg:col-span-2"
                isInvalid={touched._submitted && !!errors['pa.line1']}
                errorMessage={touched._submitted ? errors['pa.line1'] : ''}
              />
              <Input classNames={{ inputWrapper: styles.inputWrapper, input: styles.input, label: styles.label }} labelPlacement="outside"
                label="Address line 2 (optional)"
                placeholder="Landmark, sector, area"
                value={form.pickupAddress.line2}
                onChange={(e) => setAddr('line2', e.target.value)}
                variant="bordered"
              />
              <PickupLocationFields
                state={form.pickupAddress.state || ''}
                city={form.pickupAddress.city || ''}
                pincode={form.pickupAddress.pincode || ''}
                onChange={(location) => setForm(f => ({
                  ...f,
                  pickupAddress: { ...f.pickupAddress, ...location },
                }))}
                stateError={touched._submitted ? errors['pa.state'] : undefined}
                cityError={touched._submitted ? errors['pa.city'] : undefined}
                pincodeError={touched._submitted ? errors['pa.pincode'] : undefined}
                inputClassNames={{ inputWrapper: styles.inputWrapper, input: styles.input, label: styles.label }}
                labelClassName={styles.label}
              />
            </div>
          </CardBody>
        </Card>

        {/* ── Bank details (payouts) ── */}
        <Card className={styles.card}>
          <CardHeader className={styles.cardHeader}>
            <div>
              <h2 className={styles.formTitle}>Bank details</h2>
              <div className="text-xs text-muted mt-1">
                The account for your payouts. Account holder details must match your PAN.
              </div>
            </div>
          </CardHeader>
          <CardBody className={styles.cardBody}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Input classNames={{ inputWrapper: styles.inputWrapper, input: styles.input, label: styles.label }} labelPlacement="outside"
                label="Account holder name"
                placeholder="As printed on the cheque"
                value={form.bankDetails.accountHolder}
                onChange={(e) => setBank('accountHolder', e.target.value)}
                isRequired variant="bordered"
                isInvalid={touched._submitted && !!errors['bd.accountHolder']}
                errorMessage={touched._submitted ? errors['bd.accountHolder'] : ''}
                className="sm:col-span-2"
              />
              <Input classNames={{ inputWrapper: styles.inputWrapper, input: styles.input, label: styles.label }} labelPlacement="outside"
                label="Bank name"
                placeholder="e.g. HDFC Bank"
                value={form.bankDetails.bankName}
                onChange={(e) => setBank('bankName', e.target.value)}
                isRequired variant="bordered"
                isInvalid={touched._submitted && !!errors['bd.bankName']}
                errorMessage={touched._submitted ? errors['bd.bankName'] : ''}
              />
              <Input classNames={{ inputWrapper: styles.inputWrapper, input: styles.input, label: styles.label }} labelPlacement="outside"
                label="Account number"
                placeholder="9–18 digits"
                value={form.bankDetails.accountNumber}
                onChange={(e) => setBank('accountNumber', e.target.value.replace(/[^0-9 ]/g, ''))}
                onBlur={() => setTouched(t => ({ ...t, 'bd.accountNumber': true }))}
                isRequired variant="bordered"
                inputMode="numeric"
                isInvalid={(touched._submitted || touched['bd.accountNumber']) && !!errors['bd.accountNumber']}
                errorMessage={touched._submitted || touched['bd.accountNumber'] ? errors['bd.accountNumber'] : ''}
                className="sm:col-span-2 lg:col-span-2"
              />
              <Input classNames={{ inputWrapper: styles.inputWrapper, input: styles.input, label: styles.label }} labelPlacement="outside"
                label="IFSC code"
                placeholder="HDFC0001234"
                value={form.bankDetails.ifsc}
                onChange={(e) => setBank('ifsc', e.target.value.toUpperCase())}
                onBlur={() => setTouched(t => ({ ...t, 'bd.ifsc': true }))}
                isRequired variant="bordered"
                isInvalid={(touched._submitted || touched['bd.ifsc']) && !!errors['bd.ifsc']}
                errorMessage={touched._submitted || touched['bd.ifsc'] ? errors['bd.ifsc'] : ''}
                description="11 chars · 4 letters + 0 + 6 alphanumerics"
              />
              {/* Cancelled cheque — full-width slot so it stands out as an upload. */}
              <div className="sm:col-span-2 lg:col-span-3">
                <FileSlot
                  label="Cancelled cheque"
                  value={form.bankDetails.cancelledCheque}
                  onUpload={(f) => handleFileUpload(f, 'cheque')}
                  onClear={() =>
                    setForm((f) => ({
                      ...f,
                      bankDetails: { ...f.bankDetails, cancelledCheque: '' },
                    }))
                  }
                  uploading={uploading === 'cheque'}
                  error={touched._submitted ? errors['bd.cancelledCheque'] : ''}
                />
                <p className="text-xs text-muted mt-1.5 leading-relaxed">
                  Upload a clear photo or scan of a cancelled cheque from this account. Account holder name + account number must be visible — we cross-check what you typed above.
                </p>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* ── Submit ── */}
        <div className={`${styles.actions} ${styles.formActions}`}>
          <p className="text-xs text-muted max-w-md" role="status">
            {editing ? (changedSections.length ? `Changes in: ${changedSections.join(', ')}. Submit to request admin approval.` : 'No changes yet. Update a field or document to submit for review.') : 'Check your details before submitting them for verification.'}
          </p>
          <Button
            type="submit"
            color="primary"
            size="lg"
            className={styles.primary}
            isLoading={saving}
            isDisabled={uploading !== null || saving || unchangedRevision}
          >
            {approvedKyc.status === 'approved' ? 'Submit changes for review' : status === 'rejected' ? 'Resubmit for review' : 'Submit for review'}
          </Button>
        </div>
      </form>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Sub-components                                                           */
/* ──────────────────────────────────────────────────────────────────────── */

/** Read-only view of what the seller submitted (UX audit S10). Three
 *  plain definition lists, documents as links, account number masked.
 *  No "Step N of 3": the steps are over. */
  const Doc = ({ value, label }: { value?: string; label: string }) =>
    value ? (
      <a className={styles.documentLink} href={imageUrl(value)} rel="noopener noreferrer" target="_blank" aria-label={`View ${label} (opens in a new tab)`}>
        <svg className={styles.documentIcon} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></svg>
        <span className={styles.documentText}><strong>{label}</strong><span>View document</span></span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M14 3h7v7M21 3l-10 10M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/></svg>
      </a>
    ) : (
      <div className={styles.missingDocument}>{label}<span>Not uploaded</span></div>
    );
  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className={styles.detailRow}>
      <dt className={styles.detailLabel}>{label}</dt>
      <dd className={styles.detailValue}>{children}</dd>
    </div>
  );
  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <Card className={styles.card}>
      <CardHeader className={styles.cardHeader}>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </CardHeader>
      <CardBody className={styles.cardBody}>
        <dl className={styles.detailList}>{children}</dl>
      </CardBody>
    </Card>
  );

function SubmittedDetails({ form, status }: { form: Form; status: string }) {
  const pa = form.pickupAddress;
  const bd = form.bankDetails;
  const acct = bd.accountNumber ? `•••• ${bd.accountNumber.replace(/\s/g, '').slice(-4)}` : '—';
  const address = [pa.line1, pa.line2, [pa.city, pa.state].filter(Boolean).join(', '), pa.pincode]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className={styles.summary}>
      <div className={styles.summaryColumn}>
      <Section title="Tax IDs">
        <Row label="GSTIN">{form.gstin || '—'}</Row>
        <Row label="PAN">{form.pan || '—'}</Row>
      </Section>
      <Section title="Bank details">
        <Row label="Account holder">{bd.accountHolder || '—'}</Row>
        <Row label="Bank">{bd.bankName || '—'}</Row>
        <Row label="Account number">{acct}</Row>
        <Row label="IFSC">{bd.ifsc || '—'}</Row>
      </Section>
      </div>
      <div className={styles.summaryColumn}>
        <Section title="Pickup address">
          <Row label="Collection address">{address || '—'}</Row>
          <Row label="Courier contact"><span>Name, phone and email from your profile.</span><Link href="/dashboard/profile" className={styles.profileLink}>Manage contact details <Arrow /></Link></Row>
        </Section>
        <Card className={styles.card}>
          <CardHeader className={styles.cardHeader}><h2 className="text-sm font-semibold text-foreground">Verification documents</h2></CardHeader>
          <CardBody className={styles.documents}>
            <Doc label="GST certificate" value={form.gstCertificate} />
            <Doc label="PAN card" value={form.panCard} />
            <Doc label="Cancelled cheque" value={bd.cancelledCheque} />
            <p className={styles.documentHint}>Documents open in a new tab.</p>
          </CardBody>
        </Card>
      </div>
      <div className={styles.summaryNote}>
        {status === 'pending'
          ? 'You can’t edit while we review. If anything needs a change we’ll send it back to you.'
          : 'Use Edit details to request changes. Updated details require admin approval.'}
      </div>
    </div>
  );
}

function StatusBanner({ status, reason }: { status: string; reason?: string }) {
  if (status === 'not_started') {
    return (
      <Card className={`${styles.banner} border-amber-200 bg-amber-50`}>
        <CardBody className="p-4 !flex-row items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 grid place-items-center shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <div className="flex-1">
            <div className="font-semibold text-amber-900 text-sm">Complete your KYC to start selling</div>
            <div className="text-xs text-amber-800 mt-0.5">
              You won't be able to list products until our team verifies your documents.
            </div>
          </div>
        </CardBody>
      </Card>
    );
  }
  if (status === 'pending') {
    return (
      <Card className={`${styles.banner} border-blue-200 bg-blue-50`}>
        <CardBody className="p-4 !flex-row items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 grid place-items-center shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </div>
          <div className="flex-1">
            <div className="font-semibold text-blue-900 text-sm">Under review</div>
            <div className="text-xs text-blue-800 mt-0.5">
              Our team usually responds within 24-48 hours. We'll email you the moment it's approved.
            </div>
          </div>
        </CardBody>
      </Card>
    );
  }
  // NOTE: no 'approved' branch. SellerReadinessCard owns that state now and
  // folds "KYC approved" into its checklist — rendering a banner here too is
  // what produced the wall of green cards.
  if (status === 'rejected') {
    return (
      <Card className={`${styles.banner} border-rose-200 bg-rose-50`}>
        <CardBody className="p-4 !flex-row items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-700 grid place-items-center shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <div className="flex-1">
            <div className="font-semibold text-rose-900 text-sm">KYC rejected — please fix and resubmit</div>
            {reason && (
              <div className="text-xs text-rose-800 mt-1.5 leading-relaxed bg-white/60 rounded-md p-2 border border-rose-100">
                <span className="font-semibold">Admin note:</span> {reason}
              </div>
            )}
          </div>
        </CardBody>
      </Card>
    );
  }
  return null;
}

/**
 * ONE readiness card for an approved seller.
 *
 * This replaces three stacked green banners — "KYC approved", "Pickup details
 * confirmed by you" and "Pickup active · ready to ship" — which between them
 * answered a question no seller was asking. Sellers want one answer: *can I
 * sell and ship right now?* So that is the headline, and the underlying facts
 * become a compact checklist that stays collapsed while everything is fine.
 *
 * The facts are still tracked separately, because they can legitimately
 * disagree and flattening them into one boolean is what caused the original
 * "ready to ship" lie:
 *
 *   1. KYC approved                — our document review
 *   2. Details confirmed by seller — our emailed-code confirmation
 *   3. Pickup registered + active  — Shiprocket `status`
 *
 * Shiprocket's own `phone_verified` flag is deliberately NOT a step.
 * Shiprocket confirmed in writing (Sep 2026) that pickup-location
 * verification is not required for accounts shipping through the API —
 * it works without it. Showing it as "pending" made sellers chase a
 * step that does not exist for them; we still read the flag (it turns
 * step 2 into "not needed" when their agent has verified the address),
 * but it never colours the card or appears as an outstanding task.
 *
 * Only #2 is actionable by the seller, so its action is inline here and the
 * card opens itself when that step is outstanding.
 */
function SellerReadinessCard({ kycApproved }: { kycApproved: boolean }) {
  type SelfState = {
    ok: boolean; verified: boolean; staleAfterEdit?: boolean; verifiedAt?: string | null;
    method?: string; email?: string; phone?: string; otpPending?: boolean; attemptsLeft?: number;
  };
  type SrState = {
    ok: boolean; reason?: string; nickname?: string; isVerified?: boolean; isActive?: boolean;
    /** Shiprocket's raw pickup `status` — their "Status" on/off toggle.
     *  1 = on; anything else = off. Independent of `isVerified`, which
     *  is their separate "Verification Status" column. */
    statusRaw?: number;
    phone?: string; city?: string; pincode?: string; error?: string;
  };

  const [self, setSelf] = useState<SelfState | null>(null);
  const [sr, setSr] = useState<SrState | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [otp, setOtp] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [open, setOpen] = useState(false);

  async function load() {
    // Independent reads — one failing must not blank the whole card, so
    // allSettled rather than all.
    const [a, b] = await Promise.allSettled([
      api.get('/seller/kyc/pickup/self-verification'),
      api.get('/seller/shiprocket/pickup'),
    ]);
    setSelf(a.status === 'fulfilled' ? unwrap<any>(a.value) : null);
    setSr(b.status === 'fulfilled' ? unwrap<any>(b.value) : { ok: false, reason: 'fetch-error' });
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  async function sendCode() {
    setSending(true);
    try {
      const data = unwrap<{ sentTo: string }>(await api.post('/seller/kyc/pickup/send-otp'));
      notifySuccess(M.kyc.codeSentToItExpiresIn10(data.sentTo));
      setCooldown(60);
      await load();
    } catch (e: any) {
      notifyError(e, M.kyc.couldntSendTheCode);
      // The 429 reason carries the remaining cooldown ("wait 42s").
      const m = String(apiMessage(e)).match(/wait (\d+)s/);
      if (m) setCooldown(Number(m[1]));
    } finally {
      setSending(false);
    }
  }

  async function submitCode() {
    if (!/^\d{6}$/.test(otp)) { notifyWarning(M.kyc.enterThe6DigitCode); return; }
    setVerifying(true);
    try {
      await api.post('/seller/kyc/pickup/verify-otp', { otp });
      notifySuccess(M.kyc.pickupDetailsConfirmed);
      setOtp('');
      await load();
    } catch (e: any) {
      notifyError(e, M.kyc.couldntConfirmTheCode);
      await load();
    } finally {
      setVerifying(false);
    }
  }

  if (loading) {
    return (
      <Card className="mb-6 border border-default-200">
        <CardBody className="p-4 !flex-row items-center gap-3">
          <Spinner size="sm" />
          <span className="text-sm text-muted">Checking your selling status…</span>
        </CardBody>
      </Card>
    );
  }

  const pickupMissing = !sr?.ok;
  const pickupInactive = !!sr?.ok && sr.isActive === false;
  /* The courier's own address verification SUPERSEDES our email-OTP
     self-confirmation: once Shiprocket has verified the address (their
     agent called the pickup phone), asking the seller to also confirm
     the same details by email code is redundant nagging — so the prompt
     stands down. Self-confirmation still shows for the window before
     courier verification, where it's the only signal we have. */
  const courierVerified = !!sr?.ok && sr.isVerified === true;
  const needsConfirm = !!self?.ok && !self.verified && !courierVerified;
  const where = sr?.city ? `${sr.city}, ${sr.pincode}` : '';

  /* Headline = the single most important unresolved thing, else all-clear.
     Ordered by how much it actually costs the seller. */
  let tone: 'good' | 'info' | 'warn' = 'good';
  let title = 'Your store is live';
  let blurb = where
    ? `Orders will be collected from ${where}.`
    : 'Your account is fully verified.';

  if (pickupInactive) {
    tone = 'warn';
    title = 'Your pickup address is inactive';
    blurb = 'Orders can’t be collected until it’s reactivated. Please contact support.';
  } else if (pickupMissing) {
    tone = 'warn';
    title = 'Setting up your pickup address';
    blurb = sr?.reason === 'not-synced'
      ? 'We’re registering it with our courier — this usually takes a minute.'
      : 'We couldn’t confirm it with our courier. Please contact support.';
  } else if (needsConfirm) {
    tone = 'info';
    title = self?.staleAfterEdit
      ? 'Please re-confirm your pickup details'
      : 'One quick step: confirm your pickup details';
    blurb = self?.staleAfterEdit
      ? 'Your address or phone changed since you last confirmed them.'
      : 'Check the address and phone below are correct — couriers call this number on arrival.';
  }

  // Auto-open only when someone has to DO something (seller confirmation, or a
  // problem needing support).
  const expanded = open || tone === 'warn' || needsConfirm;

  const skin = {
    good: { card: 'border-[#dfe8cc] bg-[#f3f7ea]', icon: 'bg-emerald-100 text-emerald-700', head: 'text-emerald-900', body: 'text-emerald-800', rule: 'border-emerald-200/70' },
    info: { card: 'border-blue-200 bg-blue-50/70',   icon: 'bg-blue-100 text-blue-700',       head: 'text-blue-900',    body: 'text-blue-800',    rule: 'border-blue-200/70' },
    warn: { card: 'border-amber-200 bg-amber-50/80', icon: 'bg-amber-100 text-amber-700',     head: 'text-amber-900',   body: 'text-amber-800',   rule: 'border-amber-200/70' },
  }[tone];

  return (
    <Card className={`${styles.readiness} ${skin.card}`}>
      {/* items-start: HeroUI's CardBody is a flex COLUMN, so without this it
          centres every child on the cross axis — which left the details toggle
          floating in the middle of the card. */}
      <CardBody className="p-4 md:p-5 items-start">
        {/* ── Headline: the one thing a seller actually wants to know ── */}
        <div className="flex items-start gap-3 w-full">
          <div className={`w-10 h-10 rounded-xl grid place-items-center shrink-0 ${skin.icon}`}>
            {tone === 'good' ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : tone === 'info' ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16v16H4z" /><polyline points="4 7 12 13 20 7" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className={`font-semibold text-[15px] ${skin.head}`}>{title}</div>
            <div className={`text-xs mt-0.5 leading-relaxed ${skin.body}`}>{blurb}</div>
          </div>

          <Chip
            color={tone === 'good' ? 'success' : tone === 'info' ? 'primary' : 'warning'}
            variant="flat"
            className="font-semibold shrink-0"
          >
            {tone === 'good' ? 'Live' : tone === 'warn' ? 'Action needed' : 'Pending'}
          </Chip>
        </div>

        {/* ── Inline action: the only step the seller can act on ── */}
        {needsConfirm && !pickupMissing && !pickupInactive && (
          <div className="mt-3 w-full rounded-xl bg-white/70 border border-blue-200/70 p-3">
            <div className="text-xs text-blue-900">
              We&apos;ll email a 6-digit code to{' '}
              <span className="font-semibold">{self?.email || 'your registered email'}</span>.
            </div>
            <div className="mt-2.5 flex flex-col sm:flex-row gap-2 sm:items-center">
              <Button
                size="sm"
                color="primary"
                variant={self?.otpPending ? 'bordered' : 'solid'}
                className={self?.otpPending ? styles.secondary : styles.primary}
                onPress={sendCode}
                isLoading={sending}
                isDisabled={cooldown > 0}
              >
                {cooldown > 0
                  ? `Resend in ${cooldown}s`
                  : self?.otpPending ? 'Resend code' : 'Email me a code'}
              </Button>

              {self?.otpPending && (
                <>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="6-digit code"
                    aria-label="Email verification code"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                    onKeyDown={(e) => e.key === 'Enter' && submitCode()}
                    className={styles.codeInput}
                  />
                  <Button
                    size="sm"
                    color="success"
                    className={styles.primary}
                    onPress={submitCode}
                    isLoading={verifying}
                    isDisabled={otp.length < 6}
                  >
                    Confirm
                  </Button>
                  {typeof self?.attemptsLeft === 'number' && self.attemptsLeft < 5 && (
                    <span className="text-xs text-blue-800">{self.attemptsLeft} attempts left</span>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Checklist: collapsed while everything is fine, so the happy path
               is one line instead of three banners ── */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={expanded}
          disabled={tone === 'warn' || needsConfirm}
          className={`${styles.detailsToggle} ${skin.head}`}
        >
          {expanded ? (tone === 'warn' || needsConfirm ? 'Verification details' : 'Hide details') : 'Verification details'}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" style={{transform:expanded ? 'rotate(180deg)' : undefined}}><path d="m6 9 6 6 6-6" /></svg>
        </button>

        {expanded && (
          <div className={`mt-2.5 pt-3 border-t w-full ${skin.rule} grid grid-cols-1 sm:grid-cols-2 gap-y-2.5 gap-x-6`}>
            <Fact ok={kycApproved} label="KYC approved" note="Documents verified by our team" />
            <Fact
              ok={!!self?.verified || courierVerified}
              label="Details confirmed by you"
              note={
                self?.verified && self.verifiedAt
                  ? `On ${new Date(self.verifiedAt).toLocaleDateString('en-IN')}`
                  : courierVerified
                    ? 'Not needed — the courier verified this address'
                    : 'Confirm the address and phone above'
              }
            />
            <Fact
              ok={!pickupMissing && !pickupInactive}
              label="Registered with courier"
              note={where || 'Awaiting registration'}
            />
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/** One line in the readiness checklist. `neutral` renders a grey dash rather
 *  than a red cross, for facts that are outstanding but harmless. */
function Fact({
  ok, label, note, neutral,
}: { ok: boolean; label: string; note?: string; neutral?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <span
        className={`w-4 h-4 mt-0.5 rounded-full grid place-items-center shrink-0 text-white ${
          ok ? 'bg-emerald-500' : neutral ? 'bg-default-300' : 'bg-amber-500'
        }`}
      >
        {ok ? (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : neutral ? (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round">
            <line x1="12" y1="6" x2="12" y2="14" /><line x1="12" y1="18" x2="12.01" y2="18" />
          </svg>
        )}
      </span>
      <div className="min-w-0">
        <div className="text-xs font-semibold text-default-800">{label}</div>
        {note && <div className="text-xs text-muted leading-snug">{note}</div>}
      </div>
    </div>
  );
}


function FileSlot({
  label, value, onUpload, onClear, uploading, error, disabled,
}: {
  label: string;
  value?: string;
  onUpload: (f: File) => void;
  onClear: () => void;
  uploading: boolean;
  error?: string;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div>
      <label className="text-xs text-default-600 font-medium">{label} *</label>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,application/pdf"
        className="sr-only"
        aria-label={label}
        disabled={disabled || uploading}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          if (inputRef.current) inputRef.current.value = '';
        }}
      />
      <div
        className={`mt-1.5 flex items-center gap-3 rounded-xl border px-3 py-2.5 ${
          error ? 'border-rose-300 bg-rose-50' : 'border-default-200 bg-white'
        } ${disabled ? 'opacity-60' : ''}`}
      >
        <div className={`w-9 h-9 rounded-lg grid place-items-center shrink-0 ${
          value ? 'bg-emerald-100 text-emerald-700' : 'bg-default-100 text-muted'
        }`}>
          {value ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
          )}
        </div>
        <div className="flex-1 min-w-0">
          {value ? (
            <>
              <div className="text-xs font-semibold text-foreground">Document attached</div>
              <a href={imageUrl(value)} target="_blank" rel="noopener noreferrer" className="text-xs text-muted hover:underline truncate block" aria-label={`View ${label} (opens in a new tab)`}>
                View document <Arrow dir="up-right" />
              </a>
            </>
          ) : (
            <div className="text-xs text-muted">PNG / JPG / PDF, max 5 MB</div>
          )}
        </div>
        {value && !disabled && (
          <div className={styles.fileActions}>
            <Button size="sm" variant="bordered" onPress={() => inputRef.current?.click()} isLoading={uploading} isDisabled={uploading}>Replace</Button>
            <Button size="sm" variant="light" color="danger" onPress={onClear} isDisabled={uploading} aria-label={`Remove ${label}`}>Remove</Button>
          </div>
        )}
        {!value && (
          <Button
            size="sm"
            variant="flat"
            className={styles.secondary}
            onPress={() => inputRef.current?.click()}
            isLoading={uploading}
            isDisabled={disabled || uploading}
          >
            Choose file
          </Button>
        )}
      </div>
      {error && <div className="text-xs text-rose-600 mt-1">{error}</div>}
    </div>
  );
}
