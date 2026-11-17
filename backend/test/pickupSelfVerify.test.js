/**
 * Seller pickup self-verification (unit project).
 *
 * Covers the security-relevant behaviour of the emailed-OTP flow, since this
 * is the one place a seller can change their own verification state:
 *
 *   - resend cooldown + daily cap (can't be used to spam an inbox)
 *   - code expiry
 *   - wrong-guess attempt limit, then lockout
 *   - the code is stored hashed, never in clear
 *   - a correct code records WHAT was confirmed
 *   - editing the address or phone invalidates a previous confirmation
 *   - failed email delivery doesn't leave a live code behind the cooldown
 *
 * No DB and no SMTP: the sellers module is loaded through the VM loader
 * (test/helpers/controller.js) with `User.findById` and `sendMail` stubbed.
 * The tests in the first block share one seller and run in file order.
 */
const assert = require('assert');
const crypto = require('crypto');
const { loadModule } = require('./helpers/controller');

/* ── doubles ─────────────────────────────────────────────────────────── */

let mailOutbox = [];
let mailShouldFail = false;

let currentSeller = null;
const UserStub = {
  findById: (_id) => {
    const q = Promise.resolve(currentSeller);
    q.select = () => Promise.resolve(currentSeller);
    return q;
  },
};

const kyc = loadModule('sellers', {
  '../models/User': UserStub,
  '../config/mail': {
    sendMail: async (msg) => {
      if (mailShouldFail) throw new Error('SMTP refused');
      mailOutbox.push(msg);
      return { messageId: 'x' };
    },
    readConfig: () => ({}),
  },
  '../middleware/upload': { single: () => (req, res, next) => next() },
  mongoose: { isValidObjectId: (v) => /^[a-f0-9]{24}$/i.test(String(v)) },
});

/* ── helpers ─────────────────────────────────────────────────────────── */

function makeSeller(overrides = {}) {
  return {
    _id: 'seller1',
    name: 'Ankur',
    email: 'ankur@example.com',
    saved: 0,
    kyc: {
      status: 'approved',
      pickupAddress: {
        contactName: 'Ankur',
        contactPhone: '9968323408',
        line1: 'Shop 5-6',
        line2: '',
        city: 'Greater Noida West',
        state: 'Uttar Pradesh',
        pincode: '201318',
      },
      pickupSelfVerification: {},
      ...overrides,
    },
    save: async function () {
      this.saved += 1;
    },
  };
}

/** Minimal express res double that also captures thrown errors like the real
 *  asyncHandler+errorHandler pair would. */
async function call(handler, { seller, body = {} } = {}) {
  currentSeller = seller;
  let statusCode = 200,
    payload = null,
    error = null;
  const res = {
    status(c) {
      statusCode = c;
      return res;
    },
    // Seller endpoints answer the { data } envelope; the assertions read the payload inside it.
    json(b) {
      payload = b && typeof b === 'object' && 'data' in b ? b.data : b;
      return res;
    },
  };
  try {
    await handler({ user: { _id: seller?._id }, body }, res, () => {});
  } catch (e) {
    error = e.message;
    // Refusals are thrown as AppError (status on the error); the real
    // errorHandler turns that into the response status.
    if (e.status) statusCode = e.status;
  }
  return { statusCode, payload, error };
}

const codeIn = (mail) => (mail.text.match(/code is (\d{6})/) || [])[1];

/* ── one seller, start to finish ─────────────────────────────────────── */

describe('send → verify flow on one seller', () => {
  const s = makeSeller();
  let sent, code;

  test('send: returns ok, queues one masked email with a hashed 6-digit code', async () => {
    mailOutbox = [];
    mailShouldFail = false;
    const r = await call(kyc.sendPickupSelfVerifyOtp, { seller: s });
    assert.strictEqual(r.payload?.ok, true);
    assert.strictEqual(mailOutbox.length, 1);
    assert.match(r.payload.sentTo, /^an\*\*\*@example\.com$/);
    sent = mailOutbox[0];
    code = codeIn(sent);
    assert.ok(code, 'no code in body');
    const sv = s.kyc.pickupSelfVerification;
    assert.strictEqual(sv.otpHash, crypto.createHash('sha256').update(code).digest('hex'));
    assert.ok(!JSON.stringify(sv).includes(code), 'raw code found in the stored record');
    assert.ok(sent.text.includes('201318'), 'email states the address being confirmed');
    assert.match(sent.text, /do not enter the code/i);
  });

  test('send: a second send inside 60s is refused with 429 and names the wait', async () => {
    const r = await call(kyc.sendPickupSelfVerifyOtp, { seller: s });
    assert.strictEqual(r.statusCode, 429);
    assert.match(r.error, /wait \d+s/);
  });

  test('verify: a wrong code burns an attempt', async () => {
    const wrong = String((Number(code) + 1) % 1000000).padStart(6, '0');
    const r = await call(kyc.verifyPickupSelfVerifyOtp, { seller: s, body: { otp: wrong } });
    assert.strictEqual(r.statusCode, 400);
    assert.match(r.error, /attempts? left/);
    assert.strictEqual(s.kyc.pickupSelfVerification.attempts, 1);
  });

  test('verify: the correct code is accepted and records what was confirmed', async () => {
    const r = await call(kyc.verifyPickupSelfVerifyOtp, { seller: s, body: { otp: code } });
    assert.strictEqual(r.payload?.ok, true);
    const sv = s.kyc.pickupSelfVerification;
    // The module runs in its own VM realm, so `instanceof Date` would be false here.
    assert.strictEqual(Object.prototype.toString.call(sv.verifiedAt), '[object Date]');
    assert.strictEqual(sv.verifiedPhone, '9968323408');
    assert.strictEqual(sv.method, 'email');
    assert.strictEqual(sv.otpHash, '', 'code is burnt — no replay');
  });

  test('verify: replaying a used code fails', async () => {
    const r = await call(kyc.verifyPickupSelfVerifyOtp, { seller: s, body: { otp: code } });
    assert.strictEqual(r.statusCode, 400);
  });

  test('valid: confirmation holds for unchanged details and falls with an edited address or phone', () => {
    assert.strictEqual(kyc.selfVerificationValid(s.kyc), true);
    const edited = JSON.parse(JSON.stringify(s.kyc));
    edited.pickupSelfVerification.verifiedAt = new Date();
    edited.pickupAddress.pincode = '110001';
    assert.strictEqual(kyc.selfVerificationValid(edited), false);
    const edited2 = JSON.parse(JSON.stringify(s.kyc));
    edited2.pickupSelfVerification.verifiedAt = new Date();
    edited2.pickupAddress.contactPhone = '9000000000';
    assert.strictEqual(kyc.selfVerificationValid(edited2), false);
    assert.strictEqual(kyc.selfVerificationValid(makeSeller().kyc), false);
  });

  test('status: reports verified, masks the email, exposes the confirmed phone', async () => {
    const r = await call(kyc.getPickupSelfVerification, { seller: s });
    assert.strictEqual(r.payload?.verified, true);
    assert.match(r.payload.email, /\*\*\*/);
    assert.strictEqual(r.payload.phone, '9968323408');
  });
});

/* ── independent cases ───────────────────────────────────────────────── */

test('verify: an expired code is rejected and cleared', async () => {
  const s2 = makeSeller();
  await call(kyc.sendPickupSelfVerifyOtp, { seller: s2 });
  const code2 = codeIn(mailOutbox[mailOutbox.length - 1]);
  s2.kyc.pickupSelfVerification.otpExpiresAt = new Date(Date.now() - 1000);
  const r = await call(kyc.verifyPickupSelfVerifyOtp, { seller: s2, body: { otp: code2 } });
  assert.match(r.error, /expired/i);
  assert.strictEqual(s2.kyc.pickupSelfVerification.otpHash, '');
});

test('verify: locks out after 5 attempts (429) and clears the code', async () => {
  const s3 = makeSeller();
  await call(kyc.sendPickupSelfVerifyOtp, { seller: s3 });
  s3.kyc.pickupSelfVerification.attempts = 5;
  const r = await call(kyc.verifyPickupSelfVerifyOtp, { seller: s3, body: { otp: '000000' } });
  assert.strictEqual(r.statusCode, 429);
  assert.strictEqual(s3.kyc.pickupSelfVerification.otpHash, '');
});

test('send: the daily cap is enforced (429) and mentions tomorrow', async () => {
  const s4 = makeSeller();
  s4.kyc.pickupSelfVerification = { sentToday: 8, sentTodayDate: new Date().toISOString().slice(0, 10) };
  const r = await call(kyc.sendPickupSelfVerifyOtp, { seller: s4 });
  assert.strictEqual(r.statusCode, 429);
  assert.match(r.error, /tomorrow/i);
});

test('send: a stale daily counter resets on a new date', async () => {
  const s5 = makeSeller();
  s5.kyc.pickupSelfVerification = { sentToday: 8, sentTodayDate: '2000-01-01' };
  const r = await call(kyc.sendPickupSelfVerifyOtp, { seller: s5 });
  assert.strictEqual(r.payload?.ok, true);
});

test('send: refuses without a pickup address', async () => {
  const s6 = makeSeller();
  s6.kyc.pickupAddress = {};
  const r = await call(kyc.sendPickupSelfVerifyOtp, { seller: s6 });
  assert.match(r.error, /pickup address first/i);
});

test('send: an SMTP failure surfaces 502 and leaves no live code, cooldown or daily count behind', async () => {
  mailShouldFail = true;
  const s7 = makeSeller();
  const r = await call(kyc.sendPickupSelfVerifyOtp, { seller: s7 });
  mailShouldFail = false;
  assert.strictEqual(r.statusCode, 502);
  assert.strictEqual(s7.kyc.pickupSelfVerification.otpHash, '');
  assert.ok(!s7.kyc.pickupSelfVerification.lastSentAt);
  assert.strictEqual(s7.kyc.pickupSelfVerification.sentToday, 0);
});

test('status: flags a confirmation that went stale after an edit distinctly', async () => {
  const s8 = makeSeller();
  s8.kyc.pickupSelfVerification = { verifiedAt: new Date(), verifiedPhone: '9000000000', verifiedAddressKey: 'nope' };
  const r = await call(kyc.getPickupSelfVerification, { seller: s8 });
  assert.strictEqual(r.payload.verified, false);
  assert.strictEqual(r.payload.staleAfterEdit, true);
});
