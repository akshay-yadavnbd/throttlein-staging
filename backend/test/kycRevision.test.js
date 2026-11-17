/**
 * KYC change requests (unit project): an approved seller's edits are staged
 * as `kycRevision` and only replace the live record when staff approve.
 * The sellers module is loaded with stubbed User / mail / courier.
 */
const assert = require('node:assert/strict');
const { loadModule } = require('./helpers/controller');

let seller;
let syncFails = false;
let syncCalls = 0;

const controller = loadModule('sellers', {
  '../models/User': { findById: async () => seller, findOne: async () => seller },
  '../modules/notifications': { notifyTeam: async () => {} },
  '../utils/privateFiles': { ownedPrivateKey: async (value) => value },
  '../middleware/upload': { single: () => () => {} },
  '../infrastructure/shipping/shiprocket': {
    addPickupLocation: async () => {},
    updatePickupLocation: async () => {
      syncCalls++;
      if (syncFails) throw new Error('Courier unavailable');
    },
  },
});

const details = {
  gstin: '09ABCDE1234F1Z5',
  pan: 'ABCDE1234F',
  gstCertificate: 'gst.pdf',
  panCard: 'pan.pdf',
  pickupAddress: {
    contactName: 'Seller',
    contactPhone: '9999999999',
    contactEmail: 'seller@example.com',
    line1: 'Old address',
    line2: '',
    city: 'Delhi',
    state: 'Delhi',
    pincode: '110001',
    country: 'India',
  },
  bankDetails: {
    accountHolder: 'Store',
    bankName: 'Bank',
    accountNumber: '123456789',
    ifsc: 'HDFC0001234',
    cancelledCheque: 'cheque.pdf',
  },
};
function reset() {
  syncFails = false;
  syncCalls = 0;
  seller = {
    _id: 'seller',
    role: 'seller',
    status: 'approved',
    name: 'Seller',
    email: 'seller@example.com',
    phone: '9999999999',
    slug: 'store',
    kyc: {
      ...structuredClone(details),
      status: 'approved',
      shiprocket: { pickupLocation: 'store' },
      pickupSelfVerification: { verifiedAt: new Date() },
    },
    async save() {},
    markModified() {},
    toSafeJSON() {
      return { status: this.status };
    },
  };
}
async function call(name, body = {}) {
  const result = { status: 200 };
  const res = {
    status(n) {
      result.status = n;
      return this;
    },
    json(data) {
      result.data = data;
    },
  };
  await controller[name]({ user: { _id: 'seller' }, params: { id: 'store' }, body }, res);
  return result;
}
test('approved changes stay staged, cannot overwrite pending review, rejection allows resubmission', async () => {
  reset();
  const before = structuredClone(seller.kyc);
  const next = structuredClone(details);
  next.bankDetails.accountNumber = '987654321';
  await call('submitKyc', next);
  assert.deepEqual(seller.kyc, before);
  assert.equal(seller.kycRevision.status, 'pending');
  assert.equal(seller.kycRevision.bankDetails.accountNumber, '987654321');
  await assert.rejects(call('submitKyc', next), /already under review/);
  await call('rejectSellerKyc', { reason: 'Document unclear', revision: true });
  assert.deepEqual(seller.kyc, before);
  assert.equal(seller.status, 'approved');
  assert.equal(seller.kycRevision.rejectionReason, 'Document unclear');
  await assert.rejects(call('rejectSellerKyc', { reason: 'Duplicate', revision: true }), /already been reviewed/);
  await call('submitKyc', next);
  assert.equal(seller.kycRevision.status, 'pending');
});
test('approval promotes reviewed values and clears the request; stale review cannot revoke approval', async () => {
  reset();
  const next = structuredClone(details);
  next.pickupAddress.line1 = 'New address';
  await call('submitKyc', next);
  await call('approveSellerKyc', { revision: true });
  assert.equal(seller.kyc.pickupAddress.line1, 'New address');
  assert.equal(seller.kyc.status, 'approved');
  assert.equal(seller.kycRevision, undefined);
  assert.equal(seller.kyc.pickupSelfVerification, undefined);
  assert.equal(syncCalls, 1);
  await assert.rejects(call('rejectSellerKyc', { reason: 'Stale', revision: true }), /already been reviewed/);
  assert.equal(seller.kyc.status, 'approved');
});
test('courier update failure keeps approved details and pending request intact', async () => {
  reset();
  const before = structuredClone(seller.kyc);
  const next = structuredClone(details);
  next.pickupAddress.line1 = 'New address';
  await call('submitKyc', next);
  syncFails = true;
  await assert.rejects(call('approveSellerKyc', { revision: true }), /Courier unavailable/);
  assert.deepEqual(seller.kyc, before);
  assert.equal(seller.kycRevision.status, 'pending');
});
test('bank-only approval preserves pickup verification and a suspended account stays suspended', async () => {
  reset();
  seller.status = 'suspended';
  const verifiedAt = seller.kyc.pickupSelfVerification.verifiedAt;
  const next = structuredClone(details);
  next.bankDetails.accountNumber = '987654321';
  await call('submitKyc', next);
  await call('approveSellerKyc', { revision: true });
  assert.equal(seller.kyc.bankDetails.accountNumber, '987654321');
  assert.equal(seller.kyc.pickupSelfVerification.verifiedAt, verifiedAt);
  assert.equal(syncCalls, 0);
  assert.equal(seller.status, 'suspended');
});
