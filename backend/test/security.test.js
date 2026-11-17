const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { Readable } = require('node:stream');
const { assertSafeInput, validateRequest, emailRateKey } = require('../src/middleware/requestSecurity');
const { matchesFileHeader, validateStorage } = require('../src/utils/uploadValidation');
const { canonicalPrivateKey, signDiskFile, privateDiskHandler } = require('../src/utils/privateFiles');
const { response } = require('./helpers/controller');
process.env.JWT_SECRET = 'security-test-only-'.repeat(4);
process.env.REDIS_DISABLED = 'true';

function loadFrontend(file) {
  const root = path.resolve(__dirname, '../../frontend');
  const req = createRequire(path.join(root, 'package.json'));
  const ts = req('typescript');
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  }).outputText;
  const ctx = vm.createContext({
    exports: {},
    URL,
    console,
    require: (id) => (id.startsWith('@/') ? loadFrontend(`${id.slice(2)}.ts`) : req(id)),
  });
  vm.runInContext(code, ctx);
  return ctx.exports;
}

test('operator and prototype injection is rejected at every nesting depth', () => {
  for (const input of [
    '{"email":{"$ne":null}}',
    '{"items":[{"product":{"$gt":""}}]}',
    '{"__proto__":{"admin":true}}',
    '{"profile.role":"superadmin"}',
    '{"constructor":{"prototype":{"x":1}}}',
  ]) {
    assert.throws(() => assertSafeInput(JSON.parse(input)), /Invalid request field/);
  }
  assert.doesNotThrow(() => assertSafeInput({ description: 'Price $50. <p>Copy</p>', items: [{ product: 'abc' }] }));
});
test('query pollution and excessively nested input are refused', () => {
  for (const query of [{ q: ['a', 'b'] }, { 'email[$ne]': 'x' }]) {
    let error;
    validateRequest({ query }, {}, (e) => {
      error = e;
    });
    assert.equal(error.status, 400);
  }
  let nested = {};
  for (let i = 0; i < 35; i++) nested = { child: nested };
  assert.throws(() => assertSafeInput(nested), /complex/);
});
test('rate-limit account keys normalize case and whitespace', () => {
  assert.equal(
    emailRateKey({ body: { email: ' Test@Example.com ' } }),
    emailRateKey({ body: { email: 'test@example.com' } }),
  );
});
test('Redis outage still limits requests', async () => {
  const { rateLimit } = require('../src/utils/rateLimitStore');
  assert.equal((await rateLimit('test-outage', 2, 60)).allowed, true);
  assert.equal((await rateLimit('test-outage', 2, 60)).allowed, true);
  assert.equal((await rateLimit('test-outage', 2, 60)).allowed, false);
});
test('HTML sanitization removes active markup during SSR', () => {
  const { sanitizeHtml } = loadFrontend('lib/sanitizeHtml.ts');
  const input =
    '<p>Keep me</p><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">Link</a><div style="position:fixed;inset:0">Overlay</div><svg onload=alert(1)></svg>';
  const output = sanitizeHtml(input);
  assert.match(output, /<p>Keep me<\/p>/);
  assert.doesNotMatch(output, /<script|onerror|onload|javascript:|style=|<svg/);
});
test('post-login navigation rejects executable and external destinations', () => {
  const { safeReturnPath } = loadFrontend('lib/safeReturnPath.ts');
  for (const input of ['javascript:alert(1)', '//evil.test', '/\\evil.test', '/%5cevil.test', 'https://evil.test'])
    assert.equal(safeReturnPath(input), '/account');
  assert.equal(safeReturnPath('/cart?x=1'), '/cart?x=1');
});
test('private file keys reject traversal and external signing targets', () => {
  for (const input of [
    '../../etc/passwd',
    '/uploads/../secret.png',
    'products/public.png',
    'https://evil.test/a',
    '/private-uploads/a.png?x=1',
  ])
    assert.throws(() => canonicalPrivateKey(input));
  assert.equal(canonicalPrivateKey('/private-uploads/a.png'), '/private-uploads/a.png');
});
test('private disk signatures enforce expiry and resist tampering', () => {
  const url = new URL(signDiskFile('/private-uploads/a.png'));
  const query = Object.fromEntries(url.searchParams);
  const valid = response();
  valid.sendFile = (file, opts) => {
    valid.file = file;
    valid.root = opts.root;
  };
  privateDiskHandler({ query }, valid);
  assert.equal(valid.file, 'a.png');
  for (const q of [
    { ...query, key: '/private-uploads/b.png' },
    { ...query, expires: '1' },
    { ...query, signature: 'a'.repeat(64) },
  ]) {
    let refusal;
    privateDiskHandler({ query: q }, response(), (e) => {
      refusal = e;
    });
    assert.equal(refusal?.status, 403);
  }
});
test('file signatures reject disguised active content', () => {
  assert.equal(matchesFileHeader('.png', Buffer.from('<svg onload="alert(1)">')), false);
  assert.equal(matchesFileHeader('.jpg', Buffer.from('<html><script>bad</script>')), false);
  assert.equal(matchesFileHeader('.png', Buffer.from('89504e470d0a1a0a0000000000000000', 'hex')), true);
  assert.equal(matchesFileHeader('.svg', Buffer.from('<svg/>')), false);
});
test('stream validator preserves valid bytes and rejects invalid bytes', async () => {
  let writes = 0;
  const fakeStorage = {
    _removeFile(_r, _f, cb) {
      cb();
    },
    _handleFile(_r, file, cb) {
      writes++;
      const chunks = [];
      file.stream.on('data', (c) => chunks.push(c));
      file.stream.on('end', () => cb(null, { data: Buffer.concat(chunks) }));
    },
  };
  const storage = validateStorage(fakeStorage);
  const good = Buffer.from('89504e470d0a1a0a0000000000000000abcdef', 'hex');
  const run = (data) =>
    new Promise((resolve) =>
      storage._handleFile(
        {},
        { originalname: 'a.png', stream: Readable.from([data.subarray(0, 3), data.subarray(3)]) },
        (err, info) => resolve({ err, info }),
      ),
    );
  assert.deepEqual((await run(good)).info.data, good);
  assert.match((await run(Buffer.from('<script>bad</script>'))).err.message, /contents/);
  assert.equal(writes, 1, 'rejected content must never reach storage');
});
test('revoked sessions fail optional authentication and support checks', async () => {
  const file = path.resolve(__dirname, '../src/middleware/auth.js');
  const req = createRequire(file);
  const user = { _id: 'seller', status: 'approved', tokenVersion: 2 };
  const ctx = vm.createContext({
    module: { exports: {} },
    process,
    require: (name) =>
      name === 'jsonwebtoken'
        ? { verify: () => ({ id: 'seller', tv: 1 }) }
        : name === 'express-async-handler'
          ? (fn) => fn
          : name === '../models/User'
            ? { findById: async () => user }
            : req(name),
  });
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx);
  const request = { headers: { authorization: 'Bearer test' } };
  await ctx.module.exports.optionalAuth(request, response(), () => {});
  assert.equal(request.user, undefined);
  await assert.rejects(
    ctx.module.exports.protect(request, response(), () => {}),
    /session ended/,
  );
});
test('admin media router rejects customer and seller roles before controllers', () => {
  const stack = [];
  const router = { use: (...handlers) => stack.push(...handlers), get() {}, post() {}, delete() {} };
  const file = path.resolve(__dirname, '../src/modules/media/media.routes.js');
  const req = createRequire(file);
  const auth = req('../../middleware/auth');
  const ctx = vm.createContext({
    module: { exports: {} },
    require: (name) =>
      name === 'express'
        ? { Router: () => router }
        : name === './media.controller'
          ? { upload: [] }
          : name === '../../middleware/auth'
            ? { ...auth, protect: (_r, _s, next) => next() }
            : req(name),
  });
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx);
  // Guards hand `next` an AppError carrying its status; the error handler writes it.
  for (const role of ['customer', 'seller']) {
    let err;
    stack[1]({ user: { role } }, response(), (e) => {
      err = e;
    });
    assert.ok(err);
    assert.equal(err.status, 403);
  }
});

test('public login never accepts a platform key in place of an account password', async () => {
  const { loadModule } = require('./helpers/controller');
  let signed = false;
  const user = {
    password: 'stored-hash',
    matchPassword: async () => false,
    status: 'approved',
    role: 'seller',
    emailVerified: true,
  };
  // The auth module with its User lookup and token signer stubbed (keys as the legacy controller spelled them).
  const auth = loadModule('auth', {
    '../models/User': { findOne: () => ({ select: async () => user }) },
    '../middleware/auth': {
      signToken: () => {
        signed = true;
        return 'forbidden';
      },
      protect: (_r, _s, n) => n(),
      blockImpersonated: (_r, _s, n) => n(),
    },
  });
  // The refusal is a thrown AppError (code INVALID_CREDENTIALS, status 401).
  await assert.rejects(
    auth.login({ body: { email: 'seller@example.test', password: 'platform-key-example' } }, response()),
    (e) => e.status === 401 && e.code === 'INVALID_CREDENTIALS',
  );
  assert.equal(signed, false);
});

test('request logs omit signed URL query strings and password reset tokens', () => {
  const { safeRequestPath } = require('../src/middleware/requestSecurity');
  assert.equal(
    safeRequestPath({ originalUrl: '/api/private-files?key=private&signature=secret' }),
    '/api/private-files',
  );
  assert.equal(
    safeRequestPath({ originalUrl: '/api/auth/reset-password/secret-token' }),
    '/api/auth/reset-password/[redacted]',
  );
});
