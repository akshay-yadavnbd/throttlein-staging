/**
 * A seller's KYC block on the User document: GSTIN, PAN, documents, pickup
 * address, bank details and the review state. Used twice by User.js — `kyc`
 * (the live record) and `kycRevision` (a pending change awaiting review).
 */
const mongoose = require('mongoose');

const KYC_STATES = ['not_started', 'pending', 'approved', 'rejected'];

const kycSchema = new mongoose.Schema(
  {
    gstin: { type: String, trim: true, uppercase: true },
    gstCertificate: { type: String, default: '' }, // file URL (S3 or local /uploads)
    pan: { type: String, trim: true, uppercase: true },
    panCard: { type: String, default: '' }, // file URL

    // Pickup address — only the postal fields are seller-entered now. The
    // courier contact (name/phone/email) is mirrored from the seller's user
    // record on save, so sellers don't have to re-type info they already gave
    // during registration. The fields are kept in the schema so couriers and
    // emails can keep reading from a single object.
    pickupAddress: {
      contactName: { type: String, trim: true },
      contactPhone: { type: String, trim: true },
      contactEmail: { type: String, trim: true, lowercase: true },
      line1: { type: String, trim: true },
      line2: { type: String, trim: true, default: '' },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      pincode: { type: String, trim: true },
      country: { type: String, trim: true, default: 'India' },
    },

    // Bank details for payouts. Account number is stored verbatim; we don't
    // mask it server-side so admin can verify against the cancelled cheque.
    // Only show last-4 in customer-facing views (none today, but plan ahead).
    bankDetails: {
      accountHolder: { type: String, trim: true },
      accountNumber: { type: String, trim: true },
      ifsc: { type: String, trim: true, uppercase: true },
      bankName: { type: String, trim: true },
      cancelledCheque: { type: String, default: '' }, // file URL (optional)
    },

    status: { type: String, enum: KYC_STATES, default: 'not_started' },
    submittedAt: { type: Date },
    reviewedAt: { type: Date },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    rejectionReason: { type: String, default: '' },

    // Shiprocket integration — populated after KYC approval when the pickup
    // address is successfully registered with Shiprocket. The nickname is what
    // we reference when creating shipments. `lastSyncError` is captured if
    // the registration fails so admin can see why and retry.
    shiprocket: {
      pickupLocation: { type: String, default: '' }, // nickname on Shiprocket
      pickupId: { type: Number }, // numeric id from listPickupLocations; cached to avoid re-listing
      // Mirrors Shiprocket's own `phone_verified` flag, synced on read by
      // readPickupStatus(). THEIRS, not ours — see pickupSelfVerification
      // below for our own confirmation, and never conflate the two.
      pickupVerifiedAt: { type: Date },
      preferredCourierId: { type: Number }, // seller's default courier_company_id for one-click ship
      syncedAt: { type: Date },
      lastSyncError: { type: String, default: '' },
    },

    /**
     * OUR own seller-driven confirmation of the pickup details, completed by
     * the seller from their dashboard. Deliberately a separate subtree from
     * `shiprocket` above, because it answers a different question:
     *
     *   shiprocket.pickupVerifiedAt  → has the COURIER verified the phone?
     *   pickupSelfVerification       → has the SELLER confirmed these details?
     *
     * Merging them into one boolean is what previously made the dashboard
     * announce "ready to ship" over an address Shiprocket had refused.
     *
     * `method` records how the code was delivered. Today that's 'email' (no
     * SMS provider is configured); if SMS is added later, older records stay
     * honest about what was actually proven.
     *
     * `verifiedPhone` / `verifiedAddressKey` snapshot WHAT was confirmed, so
     * editing the pickup address or phone invalidates the confirmation rather
     * than silently carrying it over to details nobody ever confirmed.
     */
    pickupSelfVerification: {
      // SHA-256 of the OTP — never store the code itself.
      otpHash: { type: String, default: '' },
      otpExpiresAt: { type: Date },
      // Wrong-guess counter for the CURRENT code; reset on each new send.
      attempts: { type: Number, default: 0 },
      lastSentAt: { type: Date },
      // Rolling daily send counter, to stop someone using us as a mail relay.
      sentToday: { type: Number, default: 0 },
      sentTodayDate: { type: String, default: '' }, // 'YYYY-MM-DD'
      verifiedAt: { type: Date },
      verifiedPhone: { type: String, default: '' },
      verifiedAddressKey: { type: String, default: '' },
      method: { type: String, enum: ['email', 'sms', ''], default: '' },
    },
  },
  { _id: false },
);

module.exports = { KYC_STATES, kycSchema };
