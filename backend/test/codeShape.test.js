/**
 * Code-shape guards — the house rules in docs/backend-conventions.md, held by
 * a test so a decision ships with the check that fails the build.
 *
 * Two kinds of rule:
 *   - HARD: true of the whole tree today (config reads, logging, module
 *     layout). A violation anywhere fails.
 *   - RATCHET: legacy debt pinned at today's number or list in
 *     support/codeShape.baseline.json. Debt may shrink; it may not grow;
 *     and a baseline that is wrong in either direction fails, so the file
 *     never rots into decoration. Raising an entry is allowed only with a
 *     written reason in the same change.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const { scanSource, rawLines, requiresOf, ratchet, ratchetSet } = require('./support/codeScan');
const baseline = require('./support/codeShape.baseline.json');

const files = scanSource();
const inModules = files.filter((f) => f.rel.startsWith('modules/'));
const moduleOf = (rel) => rel.split('/')[1];
/** Resolve a relative specifier against the importing file, forward-slashed, relative to src. */
const resolveRel = (rel, spec) => path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
/** A Mongoose model: shared ones under src/models, module-owned ones as modules/<name>/<x>.model.js. */
const isModelSpec = (s) => /(^|\/)models\//.test(s) || /\.model$/.test(s);
const isModelFile = (rel) => /\.model\.js$/.test(rel);

/* ── size ─────────────────────────────────────────────────────────────── */

const CEILING = 400;

test(`no file crosses ${CEILING} lines; files already over it only shrink (baseline.fileSize)`, () => {
  const measured = new Map(files.filter((f) => rawLines(f.raw) > CEILING).map((f) => [f.rel, rawLines(f.raw)]));
  assert.deepEqual(
    ratchet(measured, baseline.fileSize, {
      ceilingHint: ` lines (ceiling ${CEILING})`,
      fixHint:
        'Split the file by concern (see modules/orders), or pin it in test/support/codeShape.baseline.json with a written reason.',
    }),
    [],
  );
});

/* ── module layout ────────────────────────────────────────────────────── */

test('inside a module, only repositories (and models) import models', () => {
  const offenders = inModules
    .filter((f) => !f.rel.endsWith('.repository.js') && !isModelFile(f.rel))
    .filter((f) => requiresOf(f.source).some(isModelSpec))
    .map((f) => f.rel);
  assert.deepEqual(offenders, [], 'move the query into a *.repository.js and call it from the service');
});

test('repositories import only models, mongoose, errors and node built-ins', () => {
  const allowed = (s) => /^node:/.test(s) || s === 'mongoose' || isModelSpec(s) || /(^|\/)errors\//.test(s);
  const offenders = inModules
    .filter((f) => f.rel.endsWith('.repository.js'))
    .flatMap((f) =>
      requiresOf(f.source)
        .filter((s) => !allowed(s))
        .map((s) => `${f.rel} → ${s}`),
    );
  assert.deepEqual(offenders, [], 'a repository holds statements, not business logic or HTTP');
});

test('module controllers hold no rules: no models, no mongoose, no bare Error', () => {
  const offenders = [];
  for (const f of inModules.filter((x) => x.rel.endsWith('.controller.js'))) {
    for (const s of requiresOf(f.source)) {
      if (isModelSpec(s) || s === 'mongoose') offenders.push(`${f.rel} → ${s}`);
    }
    if (/\bnew Error\(/.test(f.source)) offenders.push(`${f.rel} throws a bare Error — use AppError`);
  }
  assert.deepEqual(offenders, []);
});

test("a module's internals are private: outside code imports only modules/<name>", () => {
  const offenders = [];
  for (const f of files) {
    for (const s of requiresOf(f.source)) {
      if (!/modules\//.test(s)) continue;
      const target = resolveRel(f.rel, s);
      const m = /^modules\/([a-z-]+)(?:\/(.+))?$/.exec(target);
      if (!m) continue;
      const [, name, inner] = m;
      if (!inner || inner === 'index') continue;
      // A module's models are a sanctioned cross-module surface (as Hive's *.schema-db files are).
      if (/\.model$/.test(inner)) continue;
      const fromSameModule = f.rel.startsWith('modules/') && moduleOf(f.rel) === name;
      if (!fromSameModule) offenders.push(`${f.rel} → ${s}`);
    }
  }
  assert.deepEqual(offenders, [], "import the module's index; add to its public surface if something is missing");
});

/* ── model ownership (ratchet) ────────────────────────────────────────── */

/** Models a module owns (file stem inside the module); outside importers are pinned and may only disappear. */
const OWNED = {
  orders: { Order: 'order.model', CheckoutIntent: 'checkout-intent.model' },
  products: { Product: 'product.model' },
};

for (const [module, models] of Object.entries(OWNED)) {
  for (const [model, file] of Object.entries(models)) {
    test(`files outside modules/${module} that still import ${model} (baseline.modelImportsOutsideModule)`, () => {
      const measured = new Set(
        files
          .filter((f) => !f.rel.startsWith(`modules/${module}/`))
          .filter((f) => requiresOf(f.source).some((s) => s.endsWith(`/${file}`)))
          .map((f) => f.rel),
      );
      assert.deepEqual(
        ratchetSet(measured, baseline.modelImportsOutsideModule[model] || [], {
          fixHint: `read or write ${model} through modules/${module} (its index) instead of the model`,
        }),
        [],
      );
    });
  }
}

/* ── configuration and logging (hard) ─────────────────────────────────── */

test('process.env is read only in config/env.js', () => {
  const offenders = files
    .filter((f) => f.rel !== 'config/env.js')
    .filter((f) => /process\.env\s*(?:\.[A-Za-z_]|\[)/.test(f.source))
    .map((f) => f.rel);
  assert.deepEqual(offenders, [], 'declare the key in config/env.js and read `env.KEY`');
});

/** CLI tools a person runs in a terminal; they print on purpose. */
const CONSOLE_ALLOWED = new Set([
  'config/env.js', // boot warnings, before the logger exists
  'modules/mcp/config.js', // the string "node -e \"console.log(…)\"" inside an error message, not a call
  'utils/testSmtp.js',
  'utils/redisInspector.js',
]);
/** Seeds double as `npm run seed:*` commands and report to the terminal. */
const isCli = (rel) => CONSOLE_ALLOWED.has(rel) || rel.startsWith('database/seed/');

test('server-process code logs through utils/logger, never console', () => {
  const offenders = files
    .filter((f) => !isCli(f.rel))
    .filter((f) => /\bconsole\.(log|info|warn|error|debug)\s*\(/.test(f.source))
    .map((f) => f.rel);
  assert.deepEqual(offenders, [], "use `logger.<level>({ fields }, 'sentence')`");
});

/* ── errors (hard) ────────────────────────────────────────────────────── */

/** Protocol endpoints whose error shape is not ours: JSON-RPC answers for MCP clients. */
const RAW_ERROR_JSON_ALLOWED = new Set(['modules/mcp/index.js']);

test('failures are never written with res.status(4xx|5xx).json — the error layer is the single exit', () => {
  const offenders = files
    .filter((f) => !RAW_ERROR_JSON_ALLOWED.has(f.rel))
    .filter((f) => /res\.status\(\s*(?:[45]\d\d|\w+\.(?:status|statusCode|httpStatus))\s*\)\.json\(/.test(f.source))
    .map((f) => f.rel);
  assert.deepEqual(offenders, [], 'throw AppError.<factory>(message, details?) or next(AppError…) instead');
});

/* ── success envelope (ratchet) ───────────────────────────────────────── */

/**
 * Files that write a body with `res.json(...)` themselves instead of the
 * `{ data, meta }` helpers (utils/apiResponse). Legitimate exits are named
 * here; every other file doing it is legacy debt pinned in
 * baseline.legacyResponseShapes — a new one fails, and a file that stops
 * must leave the list.
 */
const RAW_JSON_EXITS = new Set([
  'utils/apiResponse.js', // the envelope helpers themselves
  'middleware/errorHandler.js', // the error envelope
  'modules/mcp/index.js', // JSON-RPC answers for MCP clients
  'routes/api.js', // GET /health for uptime checks and deploys
  'modules/orders/checkout.controller.js', // only razorpayWebhook: Razorpay reads the status, not our envelope
  'routes/webhookRoutes.js', // carrier / provider webhooks answer in the provider's terms
  'routes/mockShiprocketRoutes.js', // dev-only mock that imitates Shiprocket's own response shapes
  'routes/mock-shiprocket/carrier-sim.js', // the same mock's webhook / delivery simulators
]);

test('success bodies go through utils/apiResponse; files still answering legacy shapes only shrink (baseline.legacyResponseShapes)', () => {
  const measured = new Set(
    files
      .filter((f) => !RAW_JSON_EXITS.has(f.rel))
      .filter((f) => /\bres\.(?:status\([^)]*\)\.)?json\(/.test(f.source))
      .map((f) => f.rel),
  );
  assert.deepEqual(
    ratchetSet(measured, baseline.legacyResponseShapes || [], {
      fixHint:
        'answer with sendData / sendList / sendCreated / sendNoContent (utils/apiResponse) and migrate the screens that read it',
    }),
    [],
  );
});

/* ── validation at the edge (hard) ────────────────────────────────────── */

/** Route files whose routes take no validated input or answer a protocol of their own. */
const ROUTES_WITHOUT_VALIDATE = new Set([
  'routes/api.js', // mounts only
  'routes/productRoutes.js', // re-exports the products module router
  'routes/webhookRoutes.js', // carrier / provider payloads verified by signature in the handler
  'routes/mockShiprocketRoutes.js', // dev-only mock, off unless SHIPROCKET_MOCK_MODE
  'modules/customers/email-preferences.routes.js', // answers HTML pages; validates its own signed link
  'routes/fileRoutes.js', // wildcard key, checked by the proxy itself
]);

test('every route with a parameter or a body carries validate(...)', () => {
  const offenders = [];
  for (const f of files.filter(
    (x) => (x.rel.startsWith('routes/') || /\.routes\.js$/.test(x.rel)) && !ROUTES_WITHOUT_VALIDATE.has(x.rel),
  )) {
    // Any `<name>.<verb>('/path'` call: module routers are named for their mount
    // (shopper, categories, pages…), not only *router, and every one is checked.
    const re = /\b\w+\.(get|post|put|patch|delete)\(\s*(['`])(\/[^'`]*)\2/g;
    // `const byId = validate({...})` aliases count as validation too.
    const aliases = [...f.source.matchAll(/\bconst\s+(\w+)\s*=\s*validate\(/g)].map((m) => m[1]);
    const validated = new RegExp(`(?:\\bvalidate\\(${aliases.length ? `|\\b(?:${aliases.join('|')})\\b` : ''})`);
    const starts = [...f.source.matchAll(re)];
    starts.forEach((m, i) => {
      const segment = f.source.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : undefined);
      const method = m[1];
      const route = m[3];
      const needs = /:[A-Za-z]/.test(route) || ['post', 'put', 'patch'].includes(method);
      if (needs && !validated.test(segment)) offenders.push(`${f.rel} ${method.toUpperCase()} ${route}`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    'add validate({ params?, query?, body? }) before the handler (schemas in <domain>.schema.js or validation/generic.js)',
  );
});

test('no new `res.status(n); throw/next(new Error)` sites — failures are thrown AppErrors', () => {
  const idiom = /res\.status\(\d+\);\s*\n\s*(?:throw new Error|return next\(new Error|const \w+ = new Error)/;
  const offenders = files.filter((f) => idiom.test(f.source) || /next\(new Error\(/.test(f.source)).map((f) => f.rel);
  assert.deepEqual(offenders, [], 'throw AppError.<factory>(message) and let the error handler answer');
});
