const assert = require('node:assert/strict');
const { sendTeamsNotification, buildCard, validateWebhook } = require('../src/modules/notifications/teams-transport');

const webhook =
  'https://example.aa.environment.api.powerplatform.com/powerautomate/automations/direct/cu/07/workflows/abc123/triggers/manual/paths/invoke?api-version=1&sig=synthetic-secret';
const notice = {
  heading: 'New seller registration',
  rows: [{ label: 'Store', value: 'Example Store' }],
  adminPath: '/sellers/example',
  actionLabel: 'Open seller',
};
beforeEach(() => {
  delete process.env.TEAMS_SELLER_WEBHOOK_URL;
  process.env.ADMIN_ORIGIN = 'https://admin.example.com';
});

test('disabled, unsubscribed, and notices without safe metadata never call Teams', async () => {
  let requests = 0;
  const forbidden = async () => {
    requests += 1;
    return { ok: true };
  };
  await sendTeamsNotification({ event: 'sellerSignupKyc', notice }, forbidden);
  process.env.TEAMS_SELLER_WEBHOOK_URL = webhook;
  await sendTeamsNotification({ event: 'orderPlaced', notice }, forbidden);
  await sendTeamsNotification({ event: 'sellerSignupKyc', html: 'private KYC details' }, forbidden);
  assert.equal(requests, 0);
});

test('reads the seller URL directly, trims whitespace and deduplicates matching events', async () => {
  process.env.TEAMS_SELLER_WEBHOOK_URL = `  ${webhook}  `;
  const seen = [];
  await sendTeamsNotification(
    { event: ['sellerSignupKyc', 'sellerSignupKyc', 'orderPlaced'], notice },
    async (url, options) => {
      seen.push(url);
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(JSON.parse(options.body).attachments[0].content.type, 'AdaptiveCard');
      return { ok: true, status: 202 };
    },
  );
  assert.deepEqual(seen, [webhook]);
  await sendTeamsNotification({ event: 'sellerSignupKyc', notice }, async (url) => {
    seen.push(url);
    return { ok: true };
  });
  assert.deepEqual(seen, [webhook, webhook]);
});

test('cards escape supplied markup and keep action links on the admin origin', () => {
  const card = buildCard({ ...notice, rows: [{ label: 'Store', value: '[click](https://evil.test)' }] }).attachments[0]
    .content;
  assert.equal(card.body[1].text, 'Store: \\[click\\]\\(https://evil.test\\)');
  assert.equal(card.actions[0].url, 'https://admin.example.com/sellers/example');
  assert.ok(card.body.every((block) => block.wrap && !block.color));
  for (const adminPath of ['//evil.test', '/\\evil.test', 'https://evil.test'])
    assert.throws(() => buildCard({ ...notice, adminPath }));
});

test('webhook allowlist rejects arbitrary hosts, credentials, ports and redirects', () => {
  assert.equal(validateWebhook(webhook), webhook);
  assert.ok(
    validateWebhook(
      'https://prod-1.westeurope.logic.azure.com/workflows/abc123/triggers/manual/paths/invoke?api-version=1&sig=example',
    ),
  );
  for (const value of [
    'http://localhost/',
    'https://example.com',
    webhook.replace('.com/', '.com.evil.test/'),
    webhook.replace('https://', 'https://user:pass@'),
    webhook.replace('.com/', '.com:8443/'),
    `${webhook}#x`,
  ])
    assert.throws(() => validateWebhook(value));
});

// The service logs through src/utils/logger (pino); capture its warn lines.
const { rootLogger } = require('../src/utils/logger');
const captureWarn = (logs) =>
  vi
    .spyOn(rootLogger, 'warn')
    .mockImplementation((...args) =>
      logs.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')),
    );

test('invalid configuration is contained and does not log its secret', async () => {
  const logs = [];
  captureWarn(logs);
  let requests = 0;
  for (const value of ['invalid-synthetic-secret', 'null', '[]', 'https://evil.test/?sig=synthetic-secret']) {
    process.env.TEAMS_SELLER_WEBHOOK_URL = value;
    await sendTeamsNotification({ event: 'sellerSignupKyc', notice }, async () => {
      requests += 1;
    });
  }
  assert.equal(requests, 0);
  assert.equal(logs.length, 4);
  assert.ok(!logs.join().includes('synthetic-secret'));
});

test('network and HTTP failures stay contained without reading response bodies or retrying', async () => {
  const logs = [];
  captureWarn(logs);
  process.env.TEAMS_SELLER_WEBHOOK_URL = webhook;
  let attempts = 0;
  await sendTeamsNotification({ event: 'sellerSignupKyc', notice }, async () => {
    attempts += 1;
    throw new Error(webhook);
  });
  await sendTeamsNotification({ event: 'sellerSignupKyc', notice }, async () => ({
    ok: false,
    status: 429,
    text: () => assert.fail('Must not read error body'),
  }));
  assert.equal(attempts, 1);
  assert.ok(logs.some((message) => message.includes('429')));
  assert.ok(!logs.join().includes('synthetic-secret'));
});

function mockEmail(recipients, fail = false) {
  const mail = require('../src/config/mail');
  const Settings = require('../src/modules/notifications/notification-settings.model');
  const sent = vi.spyOn(mail, 'sendMail').mockImplementation(async () => {
    if (fail) throw new Error('Synthetic SMTP failure');
  });
  vi.spyOn(Settings, 'recipientsFor').mockImplementation(async () => recipients);
  vi.spyOn(Settings, 'updateOne').mockImplementation(async () => ({}));
  delete require.cache[require.resolve('../src/modules/notifications/notify-team.service')];
  return { notifyTeam: require('../src/modules/notifications/notify-team.service').notifyTeam, sent };
}

test('Teams is attempted with no email recipients and when SMTP fails', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  process.env.TEAMS_SELLER_WEBHOOK_URL = webhook;
  let teams = 0;
  vi.spyOn(global, 'fetch').mockImplementation(async () => {
    teams += 1;
    return { ok: true };
  });
  let helper = mockEmail([]);
  assert.equal((await helper.notifyTeam({ event: 'sellerSignupKyc', notice })).sent, false);
  assert.equal(teams, 1);
  helper = mockEmail(['ops@example.com'], true);
  assert.equal((await helper.notifyTeam({ event: 'sellerSignupKyc', notice })).sent, false);
  assert.equal(teams, 2);
});

test('email completes while Teams is still waiting, and disabling Teams preserves email', async () => {
  process.env.TEAMS_SELLER_WEBHOOK_URL = webhook;
  let finish;
  const fetchMock = vi.spyOn(global, 'fetch').mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { notifyTeam, sent } = mockEmail(['ops@example.com']);
  const result = await notifyTeam({ event: 'sellerSignupKyc', notice, subject: 'test' });
  assert.equal(result.sent, true);
  assert.equal(sent.mock.calls.length, 1);
  finish({ ok: true });
  delete process.env.TEAMS_SELLER_WEBHOOK_URL;
  assert.equal((await notifyTeam({ event: 'sellerSignupKyc', notice })).sent, true);
  assert.equal(fetchMock.mock.calls.length, 1);
});

test('real signup supplies safe metadata; re-registration sends email without a second Teams card', async () => {
  const User = require('../src/models/User');
  const { sent } = mockEmail(['ops@example.com']);
  process.env.TEAMS_SELLER_WEBHOOK_URL = webhook;
  const payloads = [];
  vi.spyOn(global, 'fetch').mockImplementation(async (_url, options) => {
    payloads.push(JSON.parse(options.body));
    return { ok: true };
  });
  let stored;
  vi.spyOn(User, 'findOne').mockImplementation(async () => stored || null);
  vi.spyOn(User.prototype, 'save').mockImplementation(async function () {
    stored = this;
    return this;
  });
  delete require.cache[require.resolve('../src/modules/auth')];
  const { registerSeller } = require('../src/modules/auth');
  const req = {
    body: { name: 'Example Seller', storeName: 'Example Store', email: 'private@example.com', phone: 'private-phone' },
  };
  const res = {
    status() {
      return this;
    },
    json() {
      return this;
    },
  };
  await registerSeller(req, res, (err) => {
    throw err;
  });
  await registerSeller(req, res, (err) => {
    throw err;
  });
  assert.equal(payloads.length, 1);
  assert.ok(!JSON.stringify(payloads).includes('private@example.com'));
  assert.ok(!JSON.stringify(payloads).includes('private-phone'));
  assert.equal(sent.mock.calls.length, 4); // verification + internal email on both attempts
});

test('KYC submits through the existing save path and sends a card without financial details', async () => {
  const User = require('../src/models/User');
  mockEmail(['ops@example.com']);
  process.env.TEAMS_SELLER_WEBHOOK_URL = webhook;
  const payloads = [];
  vi.spyOn(global, 'fetch').mockImplementation(async (_url, options) => {
    payloads.push(JSON.parse(options.body));
    return { ok: true };
  });
  /* KYC documents are private-upload keys, and submitKyc puts each one
   * through ownedPrivateKey(): it must canonicalise (so `kyc/<name>`, not
   * a bare `/<name>`) and belong to this seller. Seeding the same keys as
   * the seller's PRIOR files takes the "already on your own record" branch,
   * which keeps this test on its actual subject — the Teams card — instead
   * of reaching for PrivateUpload and a database. */
  const files = { gst: 'kyc/test-gst.pdf', pan: 'kyc/test-pan.pdf', cheque: 'kyc/test-cheque.pdf' };
  const seller = new User({
    name: 'Example Seller',
    email: 'private@example.com',
    role: 'seller',
    kyc: {
      status: 'not_started',
      gstCertificate: files.gst,
      panCard: files.pan,
      bankDetails: { cancelledCheque: files.cheque },
    },
  });
  vi.spyOn(User, 'findById').mockImplementation(async () => seller);
  const save = vi.spyOn(seller, 'save').mockImplementation(async () => seller);
  const { submitKyc } = require('../src/modules/sellers');
  const req = {
    user: { _id: seller._id },
    body: {
      gstin: '27ABCDE1234F1Z5',
      pan: 'ABCDE1234F',
      gstCertificate: files.gst,
      panCard: files.pan,
      pickupAddress: { line1: 'Example Address', city: 'Mumbai', state: 'Maharashtra', pincode: '400001' },
      bankDetails: {
        accountHolder: 'Example Seller',
        accountNumber: '12345678901',
        ifsc: 'HDFC0001234',
        bankName: 'Example Bank',
        cancelledCheque: files.cheque,
      },
    },
  };
  const res = {
    status() {
      return this;
    },
    json() {
      return this;
    },
  };
  await submitKyc(req, res, (err) => {
    throw err;
  });
  assert.equal(save.mock.calls.length, 1);
  assert.equal(payloads.length, 1);
  const text = JSON.stringify(payloads);
  for (const privateValue of ['private@example.com', 'ABCDE1234F', '12345678901', files.pan])
    assert.ok(!text.includes(privateValue));
  assert.ok(payloads[0].attachments[0].content.actions[0].url.endsWith('?tab=kyc'));
});
