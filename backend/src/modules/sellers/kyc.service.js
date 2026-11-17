/**
 * The seller's side of KYC: read their state, submit documents (first
 * submission or a change request), pick the upload folder.
 *
 * Allowed transitions on submit:
 *   not_started -> pending
 *   rejected    -> pending  (resubmission)
 * Approved sellers submit a separate revision (`kycRevision`); live details
 * change only when staff approve it (kyc-review.service.js).
 */
const { sendMail } = require('../../config/mail');
const { AppError } = require('../../errors/AppError');
const { logger } = require('../../utils/logger');
const { ownedPrivateKey } = require('../../utils/privateFiles');
const { notifyTeam } = require('../notifications');
const repo = require('./sellers.repository');
const { validateKycPayload, sanitizeKyc, upper, digitsOnly, plain } = require('./kyc-rules');
const { kycSubmittedHtml, kycSubmittedAdminHtml } = require('./kyc-emails');

const swallow = (what) => (e) => logger.error({ err: e }, `${what} email failed`);

/** Current KYC state + account status, so the dashboard can show the
 *  two-step flow ("KYC verified · account activation pending"). */
async function myKyc(userId) {
  const user = await repo.findById(userId);
  if (!user) throw AppError.notFound('Seller not found');
  return {
    // sanitizeKyc: never ship the pending-OTP hash, not even to the seller who
    // owns it — a 6-digit hash is brute-forceable, so they could confirm
    // without receiving the email.
    kyc: user.kyc ? sanitizeKyc(plain(user.kyc)) : { status: 'not_started' },
    accountStatus: user.status, // 'pending' | 'approved' | 'suspended'
    revision: user.kycRevision ? sanitizeKyc(plain(user.kycRevision)) : null,
  };
}

/** The normalised submission record built from a validated payload. */
async function buildSubmission(user, body) {
  const { gstin, pan, gstCertificate, panCard, pickupAddress = {}, bankDetails = {} } = body;
  const priorFiles = [user.kyc, user.kycRevision]
    .flatMap((k) => [k?.gstCertificate, k?.panCard, k?.bankDetails?.cancelledCheque])
    .filter(Boolean);
  const own = (key) => ownedPrivateKey(key, user._id, 'kyc', priorFiles);
  return {
    gstin: upper(gstin),
    pan: upper(pan),
    gstCertificate: await own(gstCertificate),
    panCard: await own(panCard),
    // Mirror contact from the seller's account record — never trust client-sent
    // values for fields that already exist on the User model.
    pickupAddress: {
      contactName: user.name,
      contactPhone: user.phone || '',
      contactEmail: user.email,
      line1: pickupAddress.line1,
      line2: pickupAddress.line2 || '',
      city: pickupAddress.city,
      state: pickupAddress.state,
      pincode: String(pickupAddress.pincode),
      country: pickupAddress.country || 'India',
    },
    bankDetails: {
      accountHolder: String(bankDetails.accountHolder || '').trim(),
      accountNumber: digitsOnly(bankDetails.accountNumber),
      ifsc: upper(bankDetails.ifsc),
      bankName: String(bankDetails.bankName || '').trim(),
      cancelledCheque: await own(bankDetails.cancelledCheque),
    },
    status: 'pending',
    submittedAt: new Date(),
    reviewedAt: undefined,
    reviewedBy: undefined,
    rejectionReason: '',
  };
}

/** Tell the seller and the operations team. Fire-and-forget: a mail outage
 *  must not fail a submission the seller has already completed. */
function announceSubmission(user, submission, isRevision) {
  sendMail({
    to: user.email,
    subject: 'KYC received — under review',
    html: kycSubmittedHtml({ name: user.name }),
    text: `Hi ${user.name}, we received your KYC. Review usually takes 24-48 hours.`,
  }).catch(swallow('kyc-submitted'));

  // notifyTeam reaches the env-configured list AND anything added under
  // super-admin → Notifications, deduped; it no-ops on an empty list.
  const acct = String(submission.bankDetails?.accountNumber || '');
  notifyTeam({
    event: 'sellerSignupKyc',
    notice: {
      heading: isRevision ? 'Verification changes submitted for review' : 'KYC submitted for review',
      rows: [
        { label: 'Store', value: user.storeName || 'Not provided' },
        { label: 'Seller', value: user.name || 'Not provided' },
        { label: 'KYC', value: 'Under review' },
      ],
      adminPath: `/sellers/${encodeURIComponent(user.slug || String(user._id))}?tab=kyc`,
      actionLabel: 'Review KYC',
    },
    subject: `${isRevision ? 'Verification changes' : 'KYC'} submitted for review — ${user.storeName || user.name}`,
    html: kycSubmittedAdminHtml({ user, kyc: submission }),
    text:
      `${user.storeName || user.name} has submitted KYC for review.\n\n` +
      `Seller: ${user.name || '-'}\n` +
      `Store: ${user.storeName || '-'}\n` +
      `Email: ${user.email}\n` +
      `Phone: ${user.phone || '-'}\n` +
      `GSTIN: ${submission.gstin || '-'}\n` +
      `PAN: ${submission.pan || '-'}\n` +
      `Bank: ${submission.bankDetails?.bankName || '-'}\n` +
      `Account: ${acct ? `**** ${acct.slice(-4)}` : '-'}\n`,
  }).catch(swallow('kyc-submitted admin'));
}

/** Submit or update KYC. Returns the live `kyc` (unchanged for a revision). */
async function submit(userId, body) {
  const user = await repo.findById(userId);
  if (!user) throw AppError.notFound('Seller not found');
  if (user.role !== 'seller') throw AppError.forbidden('Only sellers can submit KYC');
  const isRevision = user.kyc?.status === 'approved';
  if (user.kyc?.status === 'pending' || user.kycRevision?.status === 'pending') {
    throw AppError.conflict('Your KYC is already under review. Please wait for the admin response.');
  }
  const errs = validateKycPayload(body);
  if (errs.length) throw AppError.badRequest(errs.join(', '));

  const submission = await buildSubmission(user, body);
  if (isRevision) user.kycRevision = submission;
  else user.kyc = submission;
  await user.save({ validateBeforeSave: false });

  announceSubmission(user, submission, isRevision);
  return { kyc: user.kyc };
}

/**
 * Where a KYC document lands: sellers/<sellerSlug>/kyc, so the cascade
 * delete removes it with the seller and the S3 console reads as the store
 * name. A seller uploads under their own slug; an admin uploading on a
 * seller's behalf (?sellerId=) has the slug looked up. Falls back to the id
 * for accounts that predate slugs.
 */
async function uploadFolderFor({ user, sellerId }) {
  let folder;
  if (user && user.role === 'seller') {
    folder = user.slug || user._id;
  } else if (sellerId) {
    const seller = await repo.findSlug(sellerId);
    folder = (seller && seller.slug) || sellerId;
  }
  return folder ? `sellers/${folder}/kyc` : 'kyc';
}

module.exports = { myKyc, submit, uploadFolderFor };
