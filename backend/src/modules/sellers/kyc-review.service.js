/**
 * Staff review of KYC: the queue, one seller's record, approve, reject,
 * and edits on the seller's behalf.
 *
 * Approval also activates a PENDING account in the same stroke (single-step
 * approval, a product decision). A SUSPENDED seller stays suspended:
 * suspension is an explicit admin action with its own reasons, and
 * re-verifying documents must not silently undo it — reactivation stays
 * manual via PATCH /admin/sellers/:id/status.
 */
const shiprocket = require('../../infrastructure/shipping/shiprocket');
const { sendMail } = require('../../config/mail');
const { AppError } = require('../../errors/AppError');
const { logger } = require('../../utils/logger');
const { ownedPrivateKey } = require('../../utils/privateFiles');
const repo = require('./sellers.repository');
const rules = require('./kyc-rules');
const emails = require('./kyc-emails');
const { syncSellerPickupToShiprocket, pickupPayload } = require('./pickup-sync.service');

const { sanitizeKyc, plain } = rules;
const swallow = (what) => (e) => logger.error({ err: e }, `${what} email failed`);
const ADDRESS_KEYS = [
  'contactName',
  'contactPhone',
  'contactEmail',
  'line1',
  'line2',
  'city',
  'state',
  'pincode',
  'country',
];

async function loadSeller(idOrSlug) {
  const seller = await repo.findSellerByIdOrSlug(idOrSlug);
  if (!seller) throw AppError.notFound('Seller not found');
  return seller;
}

/** Sellers awaiting review; a pending change request is shown as the KYC. */
async function pending() {
  const sellers = await repo.listPendingKyc();
  // Defensive: a seller who confirmed and was later revoked to 'pending' would
  // otherwise ship their OTP hash here too.
  for (const s of sellers) {
    if (s.kycRevision?.status === 'pending') s.kyc = { ...s.kycRevision, isRevision: true };
    sanitizeKyc(s.kyc);
    delete s.kycRevision;
  }
  return { sellers };
}

/** Full KYC for one seller. */
async function forSeller(idOrSlug) {
  const seller = await repo.findSellerKycLean(idOrSlug);
  if (!seller) throw AppError.notFound('Seller not found');
  sanitizeKyc(seller.kyc);
  if (seller.kycRevision) sanitizeKyc(seller.kycRevision);
  return { seller };
}

/** Promote a reviewed change request onto the live record. Keeps the
 *  request pending if the courier update fails. */
async function promoteRevision(seller, revision) {
  const previous = plain(seller.kyc);
  const next = plain(revision);
  const addressChanged = ADDRESS_KEYS.some(
    (key) => String(previous.pickupAddress?.[key] || '') !== String(next.pickupAddress?.[key] || ''),
  );
  // Sync the reviewed address before activating it.
  if (addressChanged && previous.shiprocket?.pickupLocation) {
    await shiprocket.updatePickupLocation(pickupPayload(previous.shiprocket.pickupLocation, next.pickupAddress));
  }
  seller.kyc = {
    ...next,
    shiprocket: previous.shiprocket,
    pickupSelfVerification: addressChanged ? undefined : previous.pickupSelfVerification,
  };
  if (addressChanged && seller.kyc.shiprocket) seller.kyc.shiprocket.pickupVerifiedAt = undefined;
  seller.kycRevision = undefined;
}

/** Approve documents (and a pending change request when `revision`). */
async function approve(idOrSlug, { revision: wantsRevision, reviewerId }) {
  const seller = await loadSeller(idOrSlug);
  const revision = seller.kycRevision?.status === 'pending' ? seller.kycRevision : null;
  if (wantsRevision === true && !revision) {
    throw AppError.conflict('This change request has already been reviewed. Refresh the page.');
  }
  if (seller.kyc?.status === 'approved' && !revision) {
    return { kyc: seller.kyc, seller: seller.toSafeJSON() }; // already done
  }
  if (revision) await promoteRevision(seller, revision);

  seller.kyc.status = 'approved';
  seller.kyc.reviewedAt = new Date();
  seller.kyc.reviewedBy = reviewerId;
  seller.kyc.rejectionReason = '';
  const autoActivated = seller.status === 'pending';
  if (autoActivated) seller.status = 'approved';
  await seller.save({ validateBeforeSave: false });

  // Push the pickup address to Shiprocket. Awaited so staff see the result
  // immediately, but never thrown — an outage must not block approval. The
  // outcome lands in seller.kyc.shiprocket, which the seller can retry from.
  const srResult =
    revision && seller.kyc.shiprocket?.pickupLocation
      ? { ok: true, nickname: seller.kyc.shiprocket.pickupLocation }
      : await syncSellerPickupToShiprocket(seller);
  seller.markModified('kyc');
  await seller.save({ validateBeforeSave: false });

  // One email, matching what actually happened.
  const dashboardUrl = emails.dashboardLink('/dashboard');
  sendMail(
    autoActivated
      ? {
          to: seller.email,
          subject: 'Your THROTTLEIN store is live',
          html: emails.kycApprovedAndLiveHtml({ name: seller.name, dashboardUrl }),
          text: `Hi ${seller.name}, your KYC documents have been verified and your store is now active on THROTTLEIN. Visit your dashboard to start listing products.`,
        }
      : {
          to: seller.email,
          subject: 'Your THROTTLEIN KYC is verified',
          html: emails.kycApprovedHtml({ name: seller.name, dashboardUrl }),
          text: `Hi ${seller.name}, your KYC documents have been verified.`,
        },
  ).catch(swallow('kyc-approved'));

  return { kyc: seller.kyc, seller: seller.toSafeJSON(), autoActivated, shiprocket: srResult };
}

/** Reject the pending change request, or the live KYC (account back to pending). */
async function reject(idOrSlug, { reason: rawReason, revision: wantsRevision, reviewerId }) {
  const reason = String(rawReason || '').trim();
  if (!reason) throw AppError.badRequest('Rejection reason is required so the seller knows what to fix');
  const seller = await loadSeller(idOrSlug);
  if (wantsRevision === true && seller.kycRevision?.status !== 'pending') {
    throw AppError.conflict('This change request has already been reviewed. Refresh the page.');
  }
  const stamp = (target) => {
    target.status = 'rejected';
    target.reviewedAt = new Date();
    target.reviewedBy = reviewerId;
    target.rejectionReason = reason;
  };
  const kycUrl = emails.dashboardLink('/dashboard/kyc');

  if (seller.kycRevision?.status === 'pending') {
    stamp(seller.kycRevision);
    await seller.save({ validateBeforeSave: false });
    sendMail({
      to: seller.email,
      subject: 'Verification changes need attention',
      text: `Your verification changes need attention: ${reason}. Your approved details remain active. Update at ${kycUrl}`,
    }).catch(swallow('kyc-revision-rejected'));
    return { kyc: seller.kyc, revision: seller.kycRevision };
  }

  stamp(seller.kyc);
  // Reverting an already-approved seller → account goes back to pending until they resubmit.
  if (seller.status !== 'suspended') seller.status = 'pending';
  await seller.save({ validateBeforeSave: false });
  sendMail({
    to: seller.email,
    subject: 'KYC needs attention',
    html: emails.kycRejectedHtml({ name: seller.name, reason, dashboardUrl: kycUrl }),
    text: `Hi ${seller.name}, your KYC needs changes:\n${reason}\n\nUpdate at ${kycUrl}`,
  }).catch(swallow('kyc-rejected'));
  return { kyc: seller.kyc };
}

/**
 * Staff edit a seller's KYC + bank details on their behalf (a typo in the
 * IFSC, a wrong pickup pincode). Approval state is preserved — this does
 * NOT revoke verification; Reject does. Each group is optional and only
 * the keys sent are written, so a partial edit doesn't blank the rest.
 */
async function edit(idOrSlug, body, reviewerId) {
  const seller = await loadSeller(idOrSlug);
  seller.kyc = seller.kyc || /** @type {any} */ ({});
  const kyc = seller.kyc;
  const priorFiles = [kyc.gstCertificate, kyc.panCard, kyc.bankDetails?.cancelledCheque].filter(Boolean);
  const own = (key) => ownedPrivateKey(key, reviewerId, 'kyc', priorFiles);
  const { gstin, pan, gstCertificate, panCard, pickupAddress, bankDetails } = body;

  if (gstin !== undefined) {
    const g = rules.upper(gstin);
    if (g && !rules.GST_RE.test(g)) throw AppError.badRequest('GSTIN format is invalid');
    kyc.gstin = g;
  }
  if (pan !== undefined) {
    const p = rules.upper(pan);
    if (p && !rules.PAN_RE.test(p)) throw AppError.badRequest('PAN format is invalid');
    kyc.pan = p;
  }
  if (gstCertificate !== undefined) kyc.gstCertificate = await own(gstCertificate);
  if (panCard !== undefined) kyc.panCard = await own(panCard);

  if (pickupAddress && typeof pickupAddress === 'object') {
    kyc.pickupAddress = kyc.pickupAddress || /** @type {any} */ ({});
    const a = pickupAddress;
    for (const key of ['line1', 'line2', 'city', 'state', 'country']) {
      if (a[key] !== undefined) kyc.pickupAddress[key] = a[key];
    }
    if (a.pincode !== undefined) {
      const pc = String(a.pincode);
      if (pc && !rules.PIN_RE.test(pc)) throw AppError.badRequest('Pincode must be 6 digits');
      kyc.pickupAddress.pincode = pc;
    }
  }

  if (bankDetails && typeof bankDetails === 'object') {
    kyc.bankDetails = kyc.bankDetails || /** @type {any} */ ({});
    const b = bankDetails;
    if (b.accountHolder !== undefined) kyc.bankDetails.accountHolder = String(b.accountHolder).trim();
    if (b.bankName !== undefined) kyc.bankDetails.bankName = String(b.bankName).trim();
    if (b.accountNumber !== undefined) {
      const an = rules.digitsOnly(b.accountNumber);
      if (an && !rules.ACC_NO_RE.test(an)) throw AppError.badRequest('Account number must be 9–18 digits');
      kyc.bankDetails.accountNumber = an;
    }
    if (b.ifsc !== undefined) {
      const ifsc = rules.upper(b.ifsc);
      if (ifsc && !rules.IFSC_RE.test(ifsc)) throw AppError.badRequest('IFSC format is invalid (e.g. HDFC0001234)');
      kyc.bankDetails.ifsc = ifsc;
    }
    if (b.cancelledCheque !== undefined) kyc.bankDetails.cancelledCheque = await own(b.cancelledCheque);
  }

  seller.markModified('kyc');
  await seller.save({ validateBeforeSave: false });
  return { seller: seller.toSafeJSON() };
}

module.exports = { pending, forSeller, approve, reject, edit };
