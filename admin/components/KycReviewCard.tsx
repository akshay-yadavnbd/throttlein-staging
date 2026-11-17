'use client';

import React, { useEffect, useState } from 'react';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import AdminButton from '@/components/AdminButton';
import AdminInput from '@/components/AdminInput';
import AdminTextarea from '@/components/AdminTextarea';
import { StatusChip } from '@/components/ui';
import { api, imageUrl, unwrap } from '@/lib/api';
import styles from './KycReviewCard.module.css';
import modal from './AdminModal.module.css';
import { notifyError, notifySuccess, notifyWarning, apiMessage } from '@/lib/notify';
import { M } from '@/lib/messages';

export type KycStatus = 'not_started' | 'pending' | 'approved' | 'rejected';

export type KycData = {
  isRevision?: boolean;
  status?: KycStatus;
  gstin?: string;
  pan?: string;
  gstCertificate?: string;
  panCard?: string;
  pickupAddress?: {
    contactName?: string;
    contactPhone?: string;
    contactEmail?: string;
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    pincode?: string;
    country?: string;
  };
  bankDetails?: {
    accountHolder?: string;
    accountNumber?: string;
    ifsc?: string;
    bankName?: string;
    cancelledCheque?: string;
  };
  shiprocket?: {
    pickupLocation?: string;
    syncedAt?: string;
    lastSyncError?: string;
    /** Set when the seller completes Shiprocket's OTP check on the
     *  pickup phone. Until then Shiprocket lists the location as
     *  "Unverified" and refuses to ship from it — so a synced-but-
     *  unverified pickup is NOT ready, and the card must say so. */
    pickupVerifiedAt?: string;
  };
  /**
   * OUR OWN pickup-address confirmation, deliberately separate from
   * `shiprocket` above. The seller confirms the address by email OTP from
   * their dashboard; that proves they control the contact address but
   * says nothing about Shiprocket's phone check, which only Shiprocket's
   * panel can satisfy. Merging the two into one flag is what produced the
   * original "Pickup verified · ready to ship" bug on an address
   * Shiprocket still listed as Unverified.
   *
   * `otpHash`, `sentToday` and `sentTodayDate` are stripped server-side
   * and must never appear here — a 6-digit hash is trivially brute-forced.
   */
  pickupSelfVerification?: {
    verifiedAt?: string;
    verifiedPhone?: string;
    method?: string;
  };
  submittedAt?: string;
  reviewedAt?: string;
  rejectionReason?: string;
};

// Common rejection reasons — clicking one appends to the textarea so the admin
// can stack several ("GST blurry. + PAN mismatch.") without retyping boilerplate.
const QUICK_REASONS = [
  'GST certificate is blurry — please re-upload a clearer scan.',
  'PAN card image is unreadable.',
  'GSTIN does not match the business name.',
  'PAN number does not match the GST certificate.',
  'Pickup address is incomplete.',
  'Document appears edited or tampered.',
];

/** Display labels only — the chip COLOUR comes from the project-wide
 *  StatusChip vocabulary, keyed on the raw status. */
const STATUS_LABEL: Record<KycStatus, string> = {
  not_started: 'Not started',
  pending: 'Under review',
  approved: 'Verified',
  rejected: 'Rejected',
};

const stamp = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export default function KycReviewCard({
  sellerId,
  sellerName,
  kyc,
  onChange,
}: {
  sellerId: string;
  sellerName: string;
  kyc: KycData | undefined;
  onChange?: () => void;
}) {
  const [working, setWorking] = useState<'approve' | 'reject' | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [reason, setReason] = useState('');

  /*
   * REMOVED: retryShiprocketSync().
   *
   * It POSTed to /admin/sellers/:id/shiprocket/sync-pickup, which does
   * not exist — the route was deleted deliberately. See
   * `backend/src/routes/adminRoutes.js` ("admin-side Shiprocket retry
   * routes have been removed … Admin stays out of the shipping loop by
   * design") and `kycController.js` ("Removed: adminSyncPickupLocation.
   * Sellers do this themselves via POST
   * /api/seller/shiprocket/sync-pickup").
   *
   * The button survived the backend deletion, so every click produced a
   * "Not found" toast. The pickup STATUS below is still shown — a
   * reviewer wants to know whether the address registered — but the
   * retry action belongs to the seller.
   */

  // "Edit KYC" — admin modifies KYC + bank details on a seller's request.
  // Verification status is preserved; admin uses Revoke separately if they
  // want a fresh re-review.
  const [editKycOpen, setEditKycOpen] = useState(false);
  const [editKycSaving, setEditKycSaving] = useState(false);
  const [editKyc, setEditKyc] = useState({
    gstin: '', pan: '',
    gstCertificate: '', panCard: '', cancelledCheque: '',
    pickupLine1: '', pickupLine2: '', pickupCity: '', pickupState: '', pickupPincode: '',
    bankAccountHolder: '', bankName: '', bankAccountNumber: '', bankIfsc: '',
  });
  const [uploading, setUploading] = useState<'gst' | 'pan' | 'cheque' | null>(null);

  async function uploadDoc(file: File, slot: 'gst' | 'pan' | 'cheque') {
    setUploading(slot);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const data = unwrap<{ url: string }>(await api.post('/admin/kyc/upload', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }));
      setEditKyc((s) => {
        if (slot === 'gst') return { ...s, gstCertificate: data.url };
        if (slot === 'pan') return { ...s, panCard: data.url };
        return { ...s, cancelledCheque: data.url };
      });
      const label = { gst: 'GST certificate', pan: 'PAN card', cheque: 'Cancelled cheque' }[slot];
      notifySuccess(M.kycReviewCard.uploaded(label));
    } catch (e: any) {
      notifyError(e, M.kycReviewCard.couldntUpload);
    } finally {
      setUploading(null);
    }
  }

  function openEditKyc() {
    setEditKyc({
      gstin: kyc?.gstin || '',
      pan: kyc?.pan || '',
      gstCertificate: kyc?.gstCertificate || '',
      panCard: kyc?.panCard || '',
      cancelledCheque: kyc?.bankDetails?.cancelledCheque || '',
      pickupLine1:  kyc?.pickupAddress?.line1 || '',
      pickupLine2:  kyc?.pickupAddress?.line2 || '',
      pickupCity:   kyc?.pickupAddress?.city || '',
      pickupState:  kyc?.pickupAddress?.state || '',
      pickupPincode:kyc?.pickupAddress?.pincode || '',
      bankAccountHolder: kyc?.bankDetails?.accountHolder || '',
      bankName:          kyc?.bankDetails?.bankName || '',
      bankAccountNumber: kyc?.bankDetails?.accountNumber || '',
      bankIfsc:          kyc?.bankDetails?.ifsc || '',
    });
    setEditKycOpen(true);
  }

  async function saveEditKyc() {
    setEditKycSaving(true);
    try {
      await api.patch(`/admin/sellers/${sellerId}/kyc`, {
        gstin: editKyc.gstin,
        pan: editKyc.pan,
        gstCertificate: editKyc.gstCertificate,
        panCard: editKyc.panCard,
        // cancelledCheque lives under bankDetails on the model
        pickupAddress: {
          line1:   editKyc.pickupLine1,
          line2:   editKyc.pickupLine2,
          city:    editKyc.pickupCity,
          state:   editKyc.pickupState,
          pincode: editKyc.pickupPincode,
        },
        bankDetails: {
          accountHolder:   editKyc.bankAccountHolder,
          bankName:        editKyc.bankName,
          accountNumber:   editKyc.bankAccountNumber,
          ifsc:            editKyc.bankIfsc,
          cancelledCheque: editKyc.cancelledCheque,
        },
      });
      notifySuccess(M.kycReviewCard.kYCUpdated);
      setEditKycOpen(false);
      onChange?.();
    } catch (e: any) {
      notifyError(e, M.kycReviewCard.couldntUpdate);
    } finally {
      setEditKycSaving(false);
    }
  }

  const status = (kyc?.status || 'not_started') as KycStatus;
  const isEmpty = status === 'not_started' || !kyc?.gstin;

  async function approve() {
    setWorking('approve');
    try {
      await api.post(`/admin/sellers/${sellerId}/kyc/approve`, { revision: !!kyc?.isRevision });
      notifySuccess(M.kycReviewCard.kYCApprovedEmailSent);
      setApproveOpen(false);
      onChange?.();
    } catch (e: any) {
      notifyError(e, M.kycReviewCard.couldntApprove);
    } finally {
      setWorking(null);
    }
  }

  async function reject() {
    if (!reason.trim()) {
      notifyWarning(M.kycReviewCard.pleaseWriteAReasonSoTheSeller);
      return;
    }
    setWorking('reject');
    try {
      await api.post(`/admin/sellers/${sellerId}/kyc/reject`, { reason: reason.trim(), revision: !!kyc?.isRevision });
      notifySuccess(M.kycReviewCard.rejectedEmailSent);
      setRejectOpen(false);
      setReason('');
      onChange?.();
    } catch (e: any) {
      notifyError(e, M.kycReviewCard.couldntReject);
    } finally {
      setWorking(null);
    }
  }

  const address = kyc?.pickupAddress;

  return (
    <>
      <section className={styles.card} aria-label={kyc?.isRevision ? 'Verification change request' : 'KYC and pickup details'}>
        <div className={styles.head}>
          <div className="min-w-0">
            <div className={styles.eyebrow}>Verification</div>
            <h2 className={styles.title}>{kyc?.isRevision ? 'Verification change request' : 'KYC & Pickup details'}</h2>
            {kyc?.isRevision && <p className={styles.sub}>Review the proposed details below. Approval replaces the current verified details; rejection keeps them unchanged.</p>}
          </div>
          <div className={styles.headActions}>
            {/* Edit is only meaningful AFTER approval — for fixing typos on a
                verified seller's behalf. Pending submissions go through the
                Approve / Reject buttons instead; mixing Edit in would let
                admin alter what they're reviewing, which muddies the audit. */}
            {status === 'approved' && (
              <AdminButton variant="bordered" onPress={openEditKyc} startContent={<IconEdit />}>Edit</AdminButton>
            )}
            <StatusChip label={STATUS_LABEL[status]} status={status} />
          </div>
        </div>

        <div className={styles.body}>
          {isEmpty ? (
            <div className={styles.empty}>Nothing submitted yet — this appears once the seller sends their KYC.</div>
          ) : (
            <>
              {/* If already rejected, the last reason comes first — it's what
                  the resubmission should be checked against. */}
              {status === 'rejected' && kyc?.rejectionReason && (
                <div className={styles.note}>
                  <p>Last rejection note</p>
                  <p>{kyc.rejectionReason}</p>
                </div>
              )}

              {/* Spec-sheet wells, per product decision ("not clearly
                  readable"): each well has a real header (icon + sentence-
                  case title) and label→value ROWS with dividers, so every
                  fact reads on one line instead of scattered micro-labels
                  over values. Side by side when there's room, stacked when
                  narrow; the Shiprocket panel follows full-width below. */}
              <div className={styles.wells}>
                <section className={styles.well}>
                  <WellHeader icon={<IconDoc />} title="Tax identity" />
                  <dl className={styles.rows}>
                    <InfoRow copy={kyc?.gstin} label="GSTIN" mono>{kyc?.gstin || '—'}</InfoRow>
                    <InfoRow copy={kyc?.pan} label="PAN" mono>{kyc?.pan || '—'}</InfoRow>
                    <InfoRow label="GST certificate"><FilePill url={kyc?.gstCertificate} /></InfoRow>
                    <InfoRow label="PAN card"><FilePill url={kyc?.panCard} /></InfoRow>
                  </dl>
                </section>

                <section className={styles.well}>
                  <WellHeader icon={<IconCard />} title="Bank details · payouts" />
                  <dl className={styles.rows}>
                    <InfoRow copy={kyc?.bankDetails?.accountHolder} label="Account holder">{kyc?.bankDetails?.accountHolder || '—'}</InfoRow>
                    <InfoRow label="Bank">{kyc?.bankDetails?.bankName || '—'}</InfoRow>
                    <InfoRow copy={kyc?.bankDetails?.accountNumber} label="Account number" mono>{kyc?.bankDetails?.accountNumber || '—'}</InfoRow>
                    <InfoRow copy={kyc?.bankDetails?.ifsc} label="IFSC" mono>{kyc?.bankDetails?.ifsc || '—'}</InfoRow>
                    <InfoRow label="Cancelled cheque"><FilePill url={kyc?.bankDetails?.cancelledCheque} /></InfoRow>
                  </dl>
                </section>

                <section className={styles.well}>
                  <WellHeader icon={<IconPin />} title="Pickup address" />
                  <dl className={styles.rows}>
                    <InfoRow label="Contact">{address?.contactName || '—'}</InfoRow>
                    <InfoRow copy={address?.contactPhone} label="Phone" mono>{address?.contactPhone || '—'}</InfoRow>
                    {address?.contactEmail && (
                      <InfoRow copy={address.contactEmail} label="Email">{address.contactEmail}</InfoRow>
                    )}
                    {/* Address — right-aligned like every other row (per
                        product decision), multi-line under the row shape. */}
                    <InfoRow label="Address" top>
                      {/* Index key: sellers do enter the same text in both lines. */}
                      {[address?.line1, address?.line2].filter(Boolean).map((l, i) => <React.Fragment key={i}>{l}<br /></React.Fragment>)}
                      {[address?.city, address?.state].filter(Boolean).join(', ')} {address?.pincode}
                      {address?.country ? <span className={styles.muted}> · {address.country}</span> : null}
                    </InfoRow>
                  </dl>
                </section>
              </div>

              {/* Shiprocket pickup-location status. Visible only when KYC is
                  approved, since that's when the auto-sync would have fired.
                  Re-syncing is the seller's action; the one control here is a
                  read-only re-check, because phone verification happens in
                  Shiprocket's panel and has no API. */}
              {status === 'approved' && (
                <PickupVerificationPanel
                  data={kyc?.shiprocket}
                  selfData={kyc?.pickupSelfVerification}
                  pickupAddress={kyc?.pickupAddress}
                  sellerId={sellerId}
                />
              )}

              {/* Timestamps + actions — the decision row. One solid
                  primary (Approve, with its consequence spelled out
                  underneath), one clearly-secondary outline (Reject). */}
              <div className={styles.decision}>
                <div className={styles.stamps}>
                  {kyc?.submittedAt && <div>Submitted {stamp(kyc.submittedAt)}</div>}
                  {kyc?.reviewedAt && <div>Last reviewed {stamp(kyc.reviewedAt)}</div>}
                </div>
                {(status === 'pending' || status === 'rejected') && (
                  <div className={styles.decide}>
                    <div className={styles.decideButtons}>
                      <AdminButton variant="bordered" className={styles.rejectButton} onPress={() => setRejectOpen(true)} isLoading={working === 'reject'} startContent={<IconX />}>
                        Reject
                      </AdminButton>
                      <AdminButton color="primary" onPress={() => setApproveOpen(true)} isLoading={working === 'approve'} startContent={<IconCheck />}>
                        {kyc?.isRevision ? 'Approve changes' : 'Approve KYC'}
                      </AdminButton>
                    </div>
                    <p className={styles.hint}>
                      {kyc?.isRevision ? 'Approving replaces the current verified details.' : 'Approving verifies the documents and puts the store live.'}
                    </p>
                  </div>
                )}
                {status === 'approved' && (
                  <AdminButton variant="bordered" className={styles.revokeButton} onPress={() => setRejectOpen(true)}>
                    Revoke (require resubmission)
                  </AdminButton>
                )}
              </div>

            </>
          )}
        </div>
      </section>

      {/* Approve confirmation modal — twin of the reject modal */}
      <Modal
        isOpen={approveOpen}
        onClose={() => {
          if (working === 'approve') return;
          setApproveOpen(false);
        }}
        placement="center"
        size="lg"
        hideCloseButton
        classNames={{ base: modal.modal, backdrop: modal.backdrop }}
      >
        <ModalContent>
          <ModalHeader className={modal.header}>
            <span className={`${modal.icon} ${modal.positive}`}><IconCheckCircle /></span>
            <div className="min-w-0 flex-1">
              <div className={modal.eyebrow}>{kyc?.isRevision ? 'Approve changes' : 'Approve KYC'}</div>
              <div className={modal.title}>Verify {sellerName}</div>
              <div className={modal.sub}>This action is reversible — you can revoke approval later if anything looks off.</div>
            </div>
            <CloseButton onPress={() => setApproveOpen(false)} disabled={working === 'approve'} />
          </ModalHeader>

          <ModalBody className={modal.body}>
            {/* What happens on approval — single-step since KYC approval
                auto-activates a pending account (backend approveSellerKyc). */}
            <div className={modal.effects}>
              <p>What this does</p>
              {kyc?.isRevision ? <p>The proposed tax, bank and pickup details replace the current approved details. The seller is notified; their account status stays unchanged.</p> : <ul>
                <ApproveBullet>The KYC badge turns green for this seller across admin and seller dashboards.</ApproveBullet>
                <ApproveBullet>A pending account is <strong>activated automatically</strong> — their products go live on the public storefront immediately.</ApproveBullet>
                <ApproveBullet>A “your store is live” email is sent confirming both.</ApproveBullet>
              </ul>}
            </div>
            <div className={modal.callout}>
              <strong>Exception:</strong> a <strong>suspended</strong> seller stays suspended — only their documents are marked
              verified, and re-activation remains a deliberate action on their profile.
            </div>
          </ModalBody>

          <ModalFooter className={modal.footer}>
            <AdminButton variant="bordered" onPress={() => setApproveOpen(false)} isDisabled={working === 'approve'}>Cancel</AdminButton>
            <AdminButton color="primary" onPress={approve} isLoading={working === 'approve'}>Approve &amp; notify seller</AdminButton>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Reject reason modal */}
      <Modal
        isOpen={rejectOpen}
        onClose={() => {
          if (working === 'reject') return;
          setRejectOpen(false);
        }}
        placement="center"
        size="lg"
        hideCloseButton
        classNames={{ base: modal.modal, backdrop: modal.backdrop }}
      >
        <ModalContent>
          <ModalHeader className={modal.header}>
            <span className={`${modal.icon} ${modal.danger}`}><IconXCircle /></span>
            <div className="min-w-0 flex-1">
              <div className={modal.eyebrow}>{status === 'approved' ? 'Revoke KYC' : 'Reject KYC'}</div>
              <div className={modal.title}>Tell {sellerName} what to fix</div>
              <div className={modal.sub}>They’ll get an email and a banner on their dashboard with this note.</div>
            </div>
            <CloseButton onPress={() => setRejectOpen(false)} disabled={working === 'reject'} />
          </ModalHeader>

          <ModalBody className={modal.body}>
            {/* Quick-pick common reasons */}
            <div>
              <div className={modal.label}>Common reasons · tap to add</div>
              <div className={styles.reasons}>
                {QUICK_REASONS.map((r) => (
                  <button
                    type="button"
                    key={r}
                    className={styles.reason}
                    onClick={() => setReason((cur) => (cur.trim() ? `${cur.replace(/\s+$/, '')} ${r}` : r))}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <AdminTextarea
                autoFocus
                aria-label="Reason for the seller"
                minRows={4}
                maxRows={8}
                maxLength={500}
                placeholder="Example: GST certificate is blurry — please re-upload a higher-resolution scan."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                variant="bordered"
              />
              <div className={styles.counter}>
                <span className="inline-flex items-center gap-1.5"><IconMail /> Seller will be notified by email</span>
                <span className={`tabular-nums ${reason.length > 450 ? styles.over : ''}`}>{reason.length}/500</span>
              </div>
            </div>
          </ModalBody>

          <ModalFooter className={modal.footer}>
            <AdminButton variant="bordered" onPress={() => setRejectOpen(false)} isDisabled={working === 'reject'}>Cancel</AdminButton>
            <AdminButton color="danger" onPress={reject} isLoading={working === 'reject'} isDisabled={!reason.trim()}>
              {status === 'approved' ? 'Revoke & notify seller' : 'Reject & notify seller'}
            </AdminButton>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Edit KYC modal — admin patches KYC + bank on seller's request */}
      <Modal
        isOpen={editKycOpen}
        onClose={() => !editKycSaving && setEditKycOpen(false)}
        placement="center"
        size="3xl"
        scrollBehavior="inside"
        hideCloseButton
        classNames={{ base: modal.modal, backdrop: modal.backdrop }}
      >
        <ModalContent>
          <ModalHeader className={modal.header}>
            <span className={`${modal.icon} ${modal.info}`}><IconEdit /></span>
            <div className="min-w-0 flex-1">
              <div className={modal.eyebrow}>Edit KYC</div>
              <div className={modal.title}>{sellerName}</div>
              <div className={modal.sub}>
                Use this when the seller emails support with a correction. Verification status stays as-is — use <strong>Revoke</strong> if a re-review is needed.
              </div>
            </div>
            <CloseButton onPress={() => setEditKycOpen(false)} disabled={editKycSaving} />
          </ModalHeader>

          <ModalBody className={`${modal.body} gap-5`}>
            <div>
              <div className={styles.sectionLabel}>Tax IDs</div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <AdminInput
                  label="GSTIN" variant="bordered" placeholder="22ABCDE1234F1Z5" description="15 characters"
                  value={editKyc.gstin}
                  onChange={(e) => setEditKyc({ ...editKyc, gstin: e.target.value.toUpperCase() })}
                />
                <AdminInput
                  label="PAN" variant="bordered" placeholder="ABCDE1234F" description="10 characters"
                  value={editKyc.pan}
                  onChange={(e) => setEditKyc({ ...editKyc, pan: e.target.value.toUpperCase() })}
                />
              </div>
            </div>

            <div>
              <div className={styles.sectionLabel}>Documents</div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <DocSlot label="GST certificate" url={editKyc.gstCertificate} uploading={uploading === 'gst'} disabled={editKycSaving}
                  onUpload={(f) => uploadDoc(f, 'gst')} onClear={() => setEditKyc({ ...editKyc, gstCertificate: '' })} />
                <DocSlot label="PAN card" url={editKyc.panCard} uploading={uploading === 'pan'} disabled={editKycSaving}
                  onUpload={(f) => uploadDoc(f, 'pan')} onClear={() => setEditKyc({ ...editKyc, panCard: '' })} />
                <DocSlot label="Cancelled cheque" url={editKyc.cancelledCheque} uploading={uploading === 'cheque'} disabled={editKycSaving}
                  onUpload={(f) => uploadDoc(f, 'cheque')} onClear={() => setEditKyc({ ...editKyc, cancelledCheque: '' })} />
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-[#74808a]">
                Replace a file when the seller emails a fresh document. Verification status is preserved — revoke if you’d rather they resubmit themselves.
              </p>
            </div>

            <div>
              <div className={styles.sectionLabel}>Pickup address</div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <AdminInput
                  label="Address line 1" variant="bordered" placeholder="House / building / street" className="sm:col-span-2"
                  value={editKyc.pickupLine1}
                  onChange={(e) => setEditKyc({ ...editKyc, pickupLine1: e.target.value })}
                />
                <AdminInput
                  label="Address line 2" variant="bordered" placeholder="Landmark, area"
                  value={editKyc.pickupLine2}
                  onChange={(e) => setEditKyc({ ...editKyc, pickupLine2: e.target.value })}
                />
                <AdminInput
                  label="City" variant="bordered"
                  value={editKyc.pickupCity}
                  onChange={(e) => setEditKyc({ ...editKyc, pickupCity: e.target.value })}
                />
                <AdminInput
                  label="State" variant="bordered"
                  value={editKyc.pickupState}
                  onChange={(e) => setEditKyc({ ...editKyc, pickupState: e.target.value })}
                />
                <AdminInput
                  label="Pincode" variant="bordered" placeholder="6 digits" inputMode="numeric"
                  value={editKyc.pickupPincode}
                  onChange={(e) => setEditKyc({ ...editKyc, pickupPincode: e.target.value })}
                />
              </div>
            </div>

            <div>
              <div className={styles.sectionLabel}>Bank details · payouts</div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <AdminInput
                  label="Account holder" variant="bordered" className="sm:col-span-2"
                  value={editKyc.bankAccountHolder}
                  onChange={(e) => setEditKyc({ ...editKyc, bankAccountHolder: e.target.value })}
                />
                <AdminInput
                  label="Bank name" variant="bordered" placeholder="e.g. HDFC Bank"
                  value={editKyc.bankName}
                  onChange={(e) => setEditKyc({ ...editKyc, bankName: e.target.value })}
                />
                <AdminInput
                  label="Account number" variant="bordered" placeholder="9–18 digits" inputMode="numeric" className="sm:col-span-2"
                  value={editKyc.bankAccountNumber}
                  onChange={(e) => setEditKyc({ ...editKyc, bankAccountNumber: e.target.value.replace(/[^0-9 ]/g, '') })}
                />
                <AdminInput
                  label="IFSC code" variant="bordered" placeholder="HDFC0001234" description="4 letters + 0 + 6 alphanumerics"
                  value={editKyc.bankIfsc}
                  onChange={(e) => setEditKyc({ ...editKyc, bankIfsc: e.target.value.toUpperCase() })}
                />
              </div>
            </div>
          </ModalBody>

          <ModalFooter className={modal.footer}>
            <AdminButton variant="bordered" onPress={() => setEditKycOpen(false)} isDisabled={editKycSaving}>Cancel</AdminButton>
            <AdminButton color="primary" onPress={saveEditKyc} isLoading={editKycSaving}>Save changes</AdminButton>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}

/**
 * Upload slot used inside the admin Edit KYC modal. Shows the current file
 * (if any) with a "View file" link + a "Replace" button that re-opens the
 * file picker; an empty slot just shows "Upload". Disabled while saving so
 * admin can't change the URL mid-save.
 */
function DocSlot({
  label, url, uploading, disabled, onUpload, onClear,
}: {
  label: string;
  url?: string;
  uploading: boolean;
  disabled: boolean;
  onUpload: (f: File) => void;
  onClear: () => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const hasFile = !!url;
  return (
    <div className={`${styles.slot} ${hasFile ? styles.slotFilled : ''}`}>
      <span className={styles.slotIcon}>{hasFile ? <IconCheck /> : <IconUpload />}</span>
      <div className="min-w-0 flex-1">
        <strong>{label}</strong>
        {hasFile
          ? <a href={imageUrl(url!)} target="_blank" rel="noopener noreferrer">View current file</a>
          : <small>PNG / JPG / PDF, max 5 MB</small>}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          // reset so picking the same file twice still fires onChange
          if (inputRef.current) inputRef.current.value = '';
        }}
      />
      <div className="flex shrink-0 items-center gap-1">
        <AdminButton variant="bordered" isLoading={uploading} isDisabled={disabled || uploading} onPress={() => inputRef.current?.click()}>
          {hasFile ? 'Replace' : 'Upload'}
        </AdminButton>
        {hasFile && (
          <AdminButton variant="light" color="danger" isIconOnly isDisabled={disabled || uploading} onPress={onClear} aria-label={`Remove ${label.toLowerCase()}`}>
            <IconX />
          </AdminButton>
        )}
      </div>
    </div>
  );
}

/**
 * ONE pickup-verification block for the admin KYC card.
 *
 * Replaces two stacked rows ("Seller confirmation" and "Shiprocket pickup")
 * that between them made staff read three sentences to learn one thing. Same
 * treatment as the seller dashboard: a headline for the overall state, the
 * individual facts as a compact checklist, and the only action staff have.
 *
 * The facts stay separate internally because they answer different questions
 * and can legitimately disagree — flattening them into one boolean is what
 * originally made the seller dashboard announce "ready to ship" over an
 * address Shiprocket had refused:
 *
 *   seller confirmation  → did the SELLER sign off on these details? (ours)
 *   registered           → is the address on Shiprocket at all?
 *   courier verification → Shiprocket's own `phone_verified` flag
 *
 * WHY THERE IS NO "MARK VERIFIED" BUTTON
 * Only Shiprocket's panel can trigger address verification — they expose no
 * OTP endpoint to API users (every variant 404s, and the one that exists
 * returns 403 even with all five modules granted). The code goes to the
 * SELLER's phone. So staff verify there and press Re-check here, which re-reads
 * the flag from Shiprocket. A manual override would let our flag drift from
 * theirs, recreating the original bug.
 */
function PickupVerificationPanel({
  data,
  selfData,
  pickupAddress,
  sellerId,
}: {
  data?: {
    pickupLocation?: string;
    syncedAt?: string;
    lastSyncError?: string;
    pickupVerifiedAt?: string;
  };
  selfData?: {
    verifiedAt?: string;
    verifiedPhone?: string;
    method?: string;
  };
  pickupAddress?: { contactPhone?: string };
  /** Enables the Re-check button. Omit to render read-only. */
  sellerId?: string;
}) {
  const [rechecking, setRechecking] = useState(false);
  const [recheckMsg, setRecheckMsg] = useState<string | null>(null);

  /* Live read from Shiprocket, NOT from our Mongo copy.
   *
   * Everything in `data` is our own mirror: pickupLocation, syncedAt,
   * pickupVerifiedAt. None of it knows about Shiprocket's "Status"
   * on/off toggle, which is a separate column from "Verification
   * Status" and is what decides whether orders actually get collected.
   *
   * Without this fetch the panel below fell through to its all-clear
   * branch and asserted "Pickup verified and active" for an address
   * whose toggle was OFF — while the seller's own dashboard, which
   * reads the live API, correctly said "inactive". Same question, two
   * sources, two answers. The live value wins here. */
  const [live, setLive] = useState<{
    ok?: boolean;
    isActive?: boolean;
    isVerified?: boolean;
    statusRaw?: number;
  } | null>(null);

  useEffect(() => {
    if (!sellerId) return;
    let alive = true;
    api
      .get(`/admin/sellers/${sellerId}/shiprocket/pickup`)
      .then((res) => { if (alive) setLive(unwrap<any>(res) || null); })
      .catch(() => { /* panel still renders from the Mongo mirror */ });
    return () => { alive = false; };
  }, [sellerId]);

  const synced = !!data?.pickupLocation;
  const courierVerified = synced && !!data?.pickupVerifiedAt;
  const errored = !synced && !!data?.lastSyncError;
  /* Only trust an explicit false — a failed or pending live read must
   * not be reported as "disabled". */
  const pickupInactive = live?.ok === true && live.isActive === false;

  const currentPhone = String(pickupAddress?.contactPhone || '').replace(/\D/g, '').slice(-10);
  const sellerConfirmed = !!selfData?.verifiedAt;
  // Phone changed since the seller signed off → their confirmation is stale.
  const confirmStale = sellerConfirmed && !!currentPhone && selfData?.verifiedPhone !== currentPhone;

  async function recheck() {
    if (!sellerId) return;
    setRechecking(true);
    setRecheckMsg(null);
    try {
      const r = unwrap<any>(await api.get(`/admin/sellers/${sellerId}/shiprocket/pickup`));
      if (r?.ok && r.isVerified) {
        setRecheckMsg('Shiprocket now reports this pickup as verified — reload to refresh.');
      } else if (r?.ok) {
        setRecheckMsg('Shiprocket still reports this pickup as unverified.');
      } else {
        setRecheckMsg(`Could not read status (${r?.reason || 'unknown'}).`);
      }
    } catch (e: any) {
      setRecheckMsg(apiMessage(e) || 'Re-check failed.');
    } finally {
      setRechecking(false);
    }
  }

  /* Headline = the most significant unresolved thing. */
  let tone: 'good' | 'info' | 'warn' | 'idle' = 'good';
  /* Don't claim "active" unless the live read actually confirmed it —
   * asserting it from our Mongo mirror alone is what made this panel
   * disagree with the seller's dashboard in the first place. */
  let title = live?.ok === true && live.isActive === true
    ? 'Pickup verified and active'
    : 'Pickup verified';
  let sub = data?.pickupLocation ? `Registered as ${data.pickupLocation}` : '';

  if (errored) {
    tone = 'warn';
    title = 'Not registered with the courier';
    sub = data?.lastSyncError || 'Sync failed.';
  } else if (pickupInactive) {
    /* Ranked above "verification pending" on purpose: a disabled address
     * blocks collection outright, whereas an unverified one still
     * ships. This is also the one state staff can actually fix — the
     * toggle lives in Shiprocket's panel, so say where to go. */
    tone = 'warn';
    title = 'Pickup address is switched off';
    sub =
      `Verified, but the Status toggle for ${data?.pickupLocation || 'this address'} is OFF in ` +
      'Shiprocket, so orders will not be collected. Turn it on under Company Setup → Pick Up Addresses.';
  } else if (!synced) {
    tone = 'idle';
    title = 'Pickup not registered yet';
    sub = 'The seller re-syncs this from their own dashboard.';
  } else if (!courierVerified) {
    tone = 'info';
    title = 'Courier verification pending';
    sub = `Registered as ${data!.pickupLocation}. Shiprocket has not verified the address yet.`;
  }

  /* Chip vocabulary: "Failed" would be wrong for a disabled address —
     nothing failed, someone turned it off. */
  const chip = pickupInactive
    ? { label: 'Switched off', status: 'rejected' }
    : { good: { label: 'Verified', status: 'approved' }, warn: { label: 'Failed', status: 'failed' }, info: { label: 'Pending', status: 'pending' }, idle: { label: 'Not synced', status: 'not_started' } }[tone];

  return (
    <div className={`${styles.pickup} ${tone === 'idle' ? '' : styles[tone]}`}>
      <div className={styles.pickupHead}>
        <span className={styles.pickupIcon}>
          {tone === 'good' ? <IconCheck /> : tone === 'info' ? <IconClock /> : <IconAlert />}
        </span>
        <div className={styles.pickupWho}>
          <div className={styles.eyebrow}>Pickup verification</div>
          <div className={styles.pickupTitle}>{title}</div>
          {sub && <div className={styles.pickupSub}>{sub}</div>}
        </div>
        <StatusChip label={chip.label} status={chip.status} />
      </div>

      {/* ── The three facts, one line each ── */}
      <div className={styles.facts}>
        <AdminFact
          ok={sellerConfirmed && !confirmStale}
          warn={confirmStale}
          label="Seller confirmed details"
          note={
            confirmStale
              ? `Confirmed ${selfData?.verifiedPhone}, now ${currentPhone} — will re-confirm`
              : sellerConfirmed
                ? `${new Date(selfData!.verifiedAt!).toLocaleDateString('en-IN')} · ${selfData?.method === 'sms' ? 'SMS' : 'emailed'} code · ${selfData?.verifiedPhone}`
                : 'Seller does this from their dashboard'
          }
        />
        <AdminFact
          ok={synced && !pickupInactive}
          warn={pickupInactive}
          label="Registered with Shiprocket"
          note={
            pickupInactive
              ? `${data?.pickupLocation || 'Address'} · Status toggle OFF${
                  typeof live?.statusRaw === 'number' ? ` (status ${live.statusRaw})` : ''
                }`
              : synced
                ? `${data!.pickupLocation}${data?.syncedAt ? ` · ${new Date(data.syncedAt).toLocaleDateString('en-IN')}` : ''}`
                : 'Not on Shiprocket yet'
          }
        />
        <AdminFact
          ok={courierVerified}
          label="Courier address check"
          note={
            courierVerified
              ? `Verified ${new Date(data!.pickupVerifiedAt!).toLocaleDateString('en-IN')}`
              : 'Unverified — does not block shipping'
          }
        />
      </div>

      {/* ── The only action staff have, plus where to do the real work ── */}
      {synced && !courierVerified && (
        <div className={styles.pickupHelp}>
          Verified on 2026-08-03 that an unverified pickup still ships — Shiprocket issued an AWB
          from the seller&apos;s own address, so this is not urgent. To clear the flag, verify in{' '}
          <a href="https://app.shiprocket.in/seller/settings/company-setup/pickup-addresses" target="_blank" rel="noopener noreferrer">
            Shiprocket → Pickup Addresses
          </a>
          {' '}(⋯ → Verify Address). The OTP or IVR call goes to the <strong>seller&apos;s</strong> phone, so have them reachable — then press Re-check.
          {sellerId && (
            <div className={styles.recheck}>
              <AdminButton variant="bordered" onPress={recheck} isLoading={rechecking}>Re-check with Shiprocket</AdminButton>
              {recheckMsg && <span role="status">{recheckMsg}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One fact line in the admin pickup panel: charcoal tick = done, amber =
 *  needs a human to look, grey dash = outstanding but harmless. */
function AdminFact({ ok, label, note, warn }: { ok: boolean; label: string; note?: string; warn?: boolean }) {
  return (
    <div className={styles.fact}>
      <span className={`${styles.factDot} ${ok ? styles.factOk : warn ? styles.factWarn : ''}`} aria-hidden>
        {ok ? <IconCheck /> : warn ? <IconBang /> : <IconDash />}
      </span>
      <div className="min-w-0">
        <strong>{label}</strong>
        {note && <small>{note}</small>}
      </div>
    </div>
  );
}

function ApproveBullet({ children }: { children: React.ReactNode }) {
  return <li><IconCheck /><span>{children}</span></li>;
}

/** Well header — icon tile + sentence-case title. */
function WellHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className={styles.wellHead}>
      <span aria-hidden className={styles.wellIcon}>{icon}</span>
      <h3>{title}</h3>
    </div>
  );
}

/** One label→value line in a well. Label left, value right, divider
 *  between rows — the spec-sheet shape that reads fastest. Pass `copy`
 *  to render a copy-to-clipboard button after the value: reviewers
 *  paste GSTINs/PANs/IFSCs into government and bank portals constantly,
 *  and selecting a string by hand is error-prone. */
function InfoRow({
  label,
  children,
  mono = false,
  top = false,
  copy,
}: {
  label: string;
  children: React.ReactNode;
  mono?: boolean;
  /** Align to the top — for multi-line values (the address). */
  top?: boolean;
  /** Raw string put on the clipboard. Omit for non-copyable rows. */
  copy?: string;
}) {
  return (
    <div className={`${styles.row} ${top ? styles.rowTop : ''}`}>
      <dt>{label}</dt>
      <dd>
        <span className={mono ? styles.mono : ''}>{children}</span>
        {copy && <CopyButton label={label} value={copy} />}
      </dd>
    </div>
  );
}

/** Clipboard button used by InfoRow. Flashes a check for 1.5s so the
 *  click visibly landed even before the toast is read. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      className={`${styles.copy} ${copied ? styles.copied : ''}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          notifySuccess(M.kycReviewCard.copied(label));
          setTimeout(() => setCopied(false), 1500);
        } catch {
          notifyWarning(M.kycReviewCard.copyFailedSelectTheTextManually);
        }
      }}
    >
      {copied ? <IconCheck /> : <IconCopy />}
    </button>
  );
}

/** Document link for InfoRow; a missing upload is called out in red. */
function FilePill({ url }: { url?: string }) {
  if (!url) return <span className={styles.missing}>Missing</span>;
  return (
    <a className={styles.file} href={imageUrl(url)} target="_blank" rel="noopener noreferrer">
      <IconExternal /> View file
    </a>
  );
}

function CloseButton({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  return (
    <button type="button" className={modal.close} onClick={onPress} disabled={disabled} aria-label="Close"><IconX /></button>
  );
}

const svg = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
function IconCheck() { return <svg {...svg} width="14" height="14" strokeWidth={2.6}><polyline points="20 6 9 17 4 12" /></svg>; }
function IconX() { return <svg {...svg} width="14" height="14" strokeWidth={2.4}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>; }
function IconBang() { return <svg {...svg} strokeWidth={4}><line x1="12" y1="6" x2="12" y2="14" /><line x1="12" y1="18" x2="12.01" y2="18" /></svg>; }
function IconDash() { return <svg {...svg} strokeWidth={4}><line x1="6" y1="12" x2="18" y2="12" /></svg>; }
function IconEdit() { return <svg {...svg} width="13" height="13"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>; }
function IconDoc() { return <svg {...svg}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><polyline points="14 3 14 8 19 8" /><line x1="9" y1="13" x2="15" y2="13" /><line x1="9" y1="17" x2="13" y2="17" /></svg>; }
function IconCard() { return <svg {...svg}><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg>; }
function IconPin() { return <svg {...svg}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>; }
function IconClock() { return <svg {...svg}><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></svg>; }
function IconAlert() { return <svg {...svg}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>; }
function IconCheckCircle() { return <svg {...svg}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>; }
function IconXCircle() { return <svg {...svg}><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>; }
function IconMail() { return <svg {...svg}><rect x="3" y="5" width="18" height="14" rx="2" /><polyline points="3 7 12 13 21 7" /></svg>; }
function IconUpload() { return <svg {...svg}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>; }
function IconCopy() { return <svg {...svg}><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>; }
function IconExternal() { return <svg {...svg}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>; }
