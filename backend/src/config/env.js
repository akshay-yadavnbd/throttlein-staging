/**
 * Validated environment configuration — the ONE place that reads process.env.
 *
 * Every other module does `const { env } = require('<...>/config/env')` and
 * reads typed values: booleans are booleans, ports are numbers, and the
 * legacy spellings (MONGO_URI vs MONGODB_URI, HOST/EMAIL/PASS vs SMTP_*)
 * resolve to one value whichever the deployment set.
 *
 * Validation runs once at require time (every entry point loads this
 * early): a missing or malformed value that would break the server fails
 * the process with the key named, instead of surfacing as a confusing
 * runtime error later. In production the critical keys are hard errors;
 * elsewhere they are printed as warnings so local work isn't blocked.
 *
 * Reads are LIVE: each property re-coerces process.env on access. That is
 * deliberate — the test suites set and swap variables around individual
 * cases, and `cartReminders` / `teamsNotifications` read keys by name at
 * runtime. Unknown keys fall through to process.env unchanged.
 *
 * This module does NOT load backend/.env itself. Entry points do
 * (`require('./config/loadEnv')` first in src/index.js and every seed / script), so
 * the test suites keep running against a clean environment — loading the
 * developer's .env there pointed the tests at a local Redis that wasn't
 * running and left ioredis retrying forever.
 */
const { z } = require('zod');

// Under the test runner (vitest sets VITEST and NODE_ENV=test; `node --test`
// sets NODE_TEST_CONTEXT) configuration gaps are expected and must not be noisy.
const UNDER_TEST = !!process.env.VITEST || !!process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === 'test';

/* ── coercions ──────────────────────────────────────────────────────── */
const TRUE = new Set(['1', 'true', 'yes', 'on']);
const FALSE = new Set(['0', 'false', 'no', 'off', '']);
const bool = (def = false) =>
  z.preprocess((v) => {
    if (v === undefined || v === null) return def;
    const s = String(v).trim().toLowerCase();
    if (TRUE.has(s)) return true;
    if (FALSE.has(s)) return false;
    return v;
  }, z.boolean());
// Optional numbers (no default) stay `undefined` instead of coercing to NaN.
const int = (def) =>
  z.preprocess(
    (v) => (v === undefined || v === '' ? def : v),
    def === undefined ? z.coerce.number().int().optional() : z.coerce.number().int(),
  );
const num = (def) =>
  z.preprocess(
    (v) => (v === undefined || v === '' ? def : v),
    def === undefined ? z.coerce.number().optional() : z.coerce.number(),
  );
const str = (def) =>
  z.preprocess((v) => (v === undefined || v === '' ? def : v), def === undefined ? z.string().optional() : z.string());
const url = (def) =>
  z.preprocess(
    (v) => (v === undefined || v === '' ? def : v),
    def === undefined ? z.string().url().optional() : z.string().url(),
  );

/* ── schema: every key the backend reads ─────────────────────────────── */
const shape = {
  NODE_ENV: z.preprocess(
    (v) => (v === undefined || v === '' ? 'development' : v),
    z.enum(['development', 'test', 'production']),
  ),
  PORT: int(5000),
  TRUST_PROXY: str(),
  DEPLOY_COMMIT: str('local'),
  // Deploy target set by docker-compose.yml (production | staging); NODE_ENV stays
  // 'production' on both. Only the Shiprocket mock-mode guards read it (config/appEnv.js).
  APP_ENV: str(),
  // pino level for src/utils/logger.js. Tests default to silent (see logger).
  LOG_LEVEL: z.preprocess(
    (v) => (v === undefined || v === '' ? undefined : String(v).trim().toLowerCase()),
    z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  ),

  // Database + cache
  MONGODB_URI: str(), // canonical; MONGO_URI is the legacy spelling
  MONGO_URI: str(),
  REDIS_URL: str(),
  REDIS_HOST: str(),
  REDIS_PORT: int(6379),
  REDIS_PASSWORD: str(),
  REDIS_DB: int(0),
  REDIS_DISABLED: bool(false),

  // Auth
  JWT_SECRET: str(),
  JWT_EXPIRES_IN: str('7d'),
  SUPER_ADMIN_EMAIL: str(),
  SUPER_ADMIN_PASSWORD: str(),
  SUPER_ADMIN_NAME: str(),

  // Origins + public URLs
  FRONTEND_ORIGIN: url('http://localhost:3000'),
  ADMIN_ORIGIN: url('http://localhost:3001'),
  SELLER_ORIGIN: url(),
  FRONTEND_URL: str(),
  CLIENT_URL: str(),
  SITE_URL: str(),
  NEXT_PUBLIC_SITE_URL: str(), // legacy aliases of FRONTEND_ORIGIN
  SELLER_URL: str(),
  NEXT_PUBLIC_SELLER_URL: str(), // legacy aliases of SELLER_ORIGIN
  ADMIN_URL: str(), // legacy alias of ADMIN_ORIGIN
  PUBLIC_API_URL: str(),
  BACKEND_PUBLIC_URL: str(),
  PUBLIC_FILES_BASE: str(),
  RESET_LINK_BASE: str(),
  REVALIDATE_SECRET: str(),

  // Mail — SMTP_* is canonical; HOST/EMAIL/PASS/FROM/EMAIL_PORT/SECURE are the legacy names
  SMTP_HOST: str(),
  SMTP_PORT: int(587),
  SMTP_USER: str(),
  SMTP_PASS: str(),
  SMTP_FROM: str(),
  SMTP_SECURE: bool(false),
  HOST: str(),
  EMAIL_PORT: str(),
  EMAIL: str(),
  PASS: str(),
  FROM: str(),
  SECURE: str(),
  MAIL_FROM: str(),
  EMAIL_LOGO_URL: str(),
  CONTACT_INBOX: str(),
  INVOICE_SUPPORT_EMAIL: str('info@throttlein.com'),
  TEAM_NOTIFY_EMAILS: str(),
  SELLER_EMAIL: str(),

  // Uploads + S3 + images
  UPLOAD_DIR: str('uploads'),
  PRIVATE_UPLOAD_DIR: str(),
  MAX_FILE_SIZE_MB: num(10),
  MAX_VIDEO_SIZE_MB: num(50),
  DISABLE_S3: bool(false),
  AWS_ACCESS_KEY_ID: str(),
  AWS_SECRET_ACCESS_KEY: str(),
  AWS_REGION: str(),
  S3_BUCKET_NAME: str(),
  // This environment's folder in the shared bucket ("staging"); empty in production. utils/s3KeyPrefix.js.
  S3_KEY_PREFIX: str(),
  WEBP_QUALITY: int(82),
  WEBP_LOSSLESS_ALL: bool(false),

  // Shipping
  SHIPROCKET_API_BASE: str(),
  SHIPROCKET_EMAIL: str(),
  SHIPROCKET_PASSWORD: str(),
  SHIPROCKET_TOKEN: str(),
  SHIPROCKET_MOCK_MODE: bool(false),
  SHIPROCKET_WEBHOOK_TOKEN: str(),
  SHIPMENT_WORKER_ENABLED: bool(true),
  SHIPMENT_EVENT_MAX_ATTEMPTS: int(8),
  WEBHOOK_DEBUG: bool(false),

  // Payments
  RAZORPAY_KEY_ID: str(),
  RAZORPAY_KEY_SECRET: str(),
  RAZORPAY_WEBHOOK_SECRET: str(),
  PAYMENT_SOURCE_TAG: str(),
  EMI_MIN_AMOUNT: num(),
  EMI_MAX_TENURE: num(),
  EMI_INDICATIVE_RATE: num(),

  // Cart reminders
  CART_REMINDER_ENABLED: bool(false),
  CART_REMINDER_INTERVAL_MS: num(),
  CART_REMINDER_DELAYS_MINUTES: str(),
  CART_REMINDER_SECRET: str(),

  // Integrations
  TEAMS_SELLER_WEBHOOK_URL: str(),
  GROQ_API_KEY: str(),
  GROQ_PRODUCT_IMPORT_MODEL: str(),
  PRODUCT_IMPORT_TEXT_CHARS: num(),
  PRODUCT_IMPORT_STRUCTURED_CHARS: num(),
  PRODUCT_IMPORT_MAX_OUTPUT_TOKENS: num(),
  // MCP connector (src/mcp/config.js validates ranges and derives keys)
  MCP_ISSUER_URL: str(),
  MCP_MASTER_KEY: str(),
  MCP_MAX_MODE: str(),
  MCP_RATE_PER_MIN: int(),
  MCP_USER_RATE_PER_MIN: int(),
  MCP_DAILY_RECORDS: int(),
  MCP_MAX_CONCURRENT: int(),
  MCP_MAX_RESPONSE_BYTES: int(),
  MCP_MAX_PAGE_SIZE: int(),
  MCP_TOOL_TIMEOUT_MS: int(),
  MCP_LOGIN_FAILURES: int(),
  MCP_LOGIN_LOCKOUT_SECONDS: int(),
  MCP_OAUTH_ACCESS_SECONDS: int(),
  MCP_OAUTH_MAX_DAYS: int(),
  MCP_SETTINGS_CACHE_MS: int(),

  // Seeds
  SEED_CATEGORIES: str(),
  SEED_BRANDS: str(),
};
const schema = z.object(shape);

/* ── aliases: legacy spelling → canonical value ──────────────────────── */
const ALIASES = {
  MONGODB_URI: ['MONGODB_URI', 'MONGO_URI'],
  MONGO_URI: ['MONGO_URI', 'MONGODB_URI'],
  SMTP_HOST: ['SMTP_HOST', 'HOST'],
  SMTP_USER: ['SMTP_USER', 'EMAIL'],
  SMTP_PASS: ['SMTP_PASS', 'PASS'],
  SMTP_FROM: ['SMTP_FROM', 'MAIL_FROM', 'FROM'],
  HOST: ['HOST', 'SMTP_HOST'],
  EMAIL: ['EMAIL', 'SMTP_USER'],
  PASS: ['PASS', 'SMTP_PASS'],
  FROM: ['FROM', 'MAIL_FROM', 'SMTP_FROM'],
  MAIL_FROM: ['MAIL_FROM', 'SMTP_FROM', 'FROM'],
  FRONTEND_URL: ['FRONTEND_URL', 'FRONTEND_ORIGIN'],
  CLIENT_URL: ['CLIENT_URL', 'FRONTEND_ORIGIN'],
  SITE_URL: ['SITE_URL', 'FRONTEND_ORIGIN'],
  NEXT_PUBLIC_SITE_URL: ['NEXT_PUBLIC_SITE_URL', 'FRONTEND_ORIGIN'],
  SELLER_URL: ['SELLER_URL', 'SELLER_ORIGIN'],
  NEXT_PUBLIC_SELLER_URL: ['NEXT_PUBLIC_SELLER_URL', 'SELLER_ORIGIN'],
  ADMIN_URL: ['ADMIN_URL', 'ADMIN_ORIGIN'],
};
function rawFor(key) {
  for (const name of ALIASES[key] || [key]) {
    const v = process.env[name];
    if (v !== undefined && v !== '') return v;
  }
  return process.env[key];
}
// SMTP_PORT/SMTP_SECURE accept the legacy EMAIL_PORT/SECURE spellings too.
function rawPort() {
  return rawFor('SMTP_PORT') ?? process.env.EMAIL_PORT;
}
function rawSecure() {
  return rawFor('SMTP_SECURE') ?? process.env.SECURE;
}

/* ── one-time boot validation ────────────────────────────────────────── */
function snapshot() {
  const out = {};
  for (const key of Object.keys(shape)) out[key] = rawFor(key);
  out.SMTP_PORT = rawPort();
  out.SMTP_SECURE = rawSecure();
  return out;
}

function validateAtBoot() {
  const raw = snapshot();
  const parsed = schema.safeParse(raw);
  const problems = [];
  if (!parsed.success) {
    for (const issue of parsed.error.issues) problems.push(`${issue.path.join('.')}: ${issue.message}`);
  }
  const prod = (raw.NODE_ENV || 'development') === 'production';

  // Critical keys: the server cannot do its job without these. Checked on
  // the raw values so one malformed optional key never masks them.
  if (!raw.MONGODB_URI) problems.push('MONGO_URI (or MONGODB_URI): the MongoDB connection string is required');
  const secret = raw.JWT_SECRET || '';
  // Placeholder detection is anchored to the START of the value: the old
  // pattern matched "secret" anywhere and flagged real random secrets that
  // merely contained the word.
  const weakSecret =
    !secret || secret.length < 32 || /^(change|changeme|secret|placeholder|your[-_]?secret)/i.test(secret);
  if (weakSecret) {
    problems.push(
      'JWT_SECRET: missing, shorter than 32 characters, or a known placeholder — set a long random value (e.g. `openssl rand -hex 32`)',
    );
  }

  if (problems.length === 0) return;
  const text = `Environment configuration problems:\n  - ${problems.join('\n  - ')}`;
  if (prod) {
    console.error(`\n${text}\nRefusing to start.\n`);
    process.exit(1);
  }
  if (!UNDER_TEST) console.warn(`\n⚠️  ${text}\n`);
}

/* ── the live, typed `env` object ─────────────────────────────────────── */
const cache = new Map(); // key → { raw, value }
function read(key) {
  const raw = key === 'SMTP_PORT' ? rawPort() : key === 'SMTP_SECURE' ? rawSecure() : rawFor(key);
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value;
  const r = shape[key].safeParse(raw);
  // A value that fails its own schema at runtime (a test set "junk") falls
  // back to the raw string rather than throwing mid-request; boot already
  // reported it.
  const value = r.success ? r.data : raw;
  cache.set(key, { raw, value });
  return value;
}

const base = {};
for (const key of Object.keys(shape)) {
  Object.defineProperty(base, key, { enumerable: true, get: () => read(key) });
}
Object.defineProperty(base, 'isProduction', { enumerable: true, get: () => read('NODE_ENV') === 'production' });
Object.defineProperty(base, 'isTest', { enumerable: true, get: () => read('NODE_ENV') === 'test' });
Object.defineProperty(base, 'isDevelopment', { enumerable: true, get: () => read('NODE_ENV') === 'development' });

const env = new Proxy(base, {
  // Keys outside the schema (TEAMS_<EVENT>_WEBHOOK_URL, MCP_* ceilings read
  // by name) pass straight through to process.env.
  get(target, prop) {
    if (typeof prop !== 'string') return undefined;
    if (prop in target) return target[prop];
    return process.env[prop];
  },
  has(target, prop) {
    return prop in target || prop in process.env;
  },
});

validateAtBoot();

module.exports = { env, validateAtBoot, ENV_KEYS: Object.keys(shape), UNDER_TEST };
