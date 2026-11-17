/**
 * Load a domain module (src/modules/<name>) with stubbed dependencies.
 *
 * The module graph is evaluated in its own VM context through a small
 * CommonJS loader, so tests can replace models and services per load
 * without touching Node's shared module cache. Stub keys are written as the
 * legacy controller spelled them (`'../models/Order'`, `'../infrastructure/payments/razorpay'`,
 * …): relative keys resolve against src/controllers/, and a module file's own
 * relative require resolves against its directory, so the two meet on the
 * absolute path. Bare names (`'express-async-handler'`) match by name.
 *
 * Returns the module's exports with `exports` pointing at the same object,
 * so both `c.exports.sellerShipOrder(req, res)` and `c.finalizeOrder(...)` work.
 *
 *   loadModule('sellers', { '../models/User': stub })   // KYC module
 *   loadController(overrides)                            // = loadModule('orders', overrides)
 *
 * For orders, the order-notifications module is a no-op by default so a
 * test never sends mail or queries notification settings; pass your own
 * stub to observe it.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const SRC = path.resolve(__dirname, '../../src');
const LEGACY_DIR = path.join(SRC, 'controllers');
/** Modules the loader can load; the entry is the module's index.js. */
const ENTRIES = new Set(['orders', 'products', 'sellers', 'admin', 'auth', 'blog', 'cms']);

const normalize = (p) => path.resolve(p).replace(/\.js$/i, '').toLowerCase();

/** Models that moved into their module; stub keys may still use the legacy `../models/<Name>` spelling. */
const MODEL_PATHS = {
  Order: 'orders/order.model',
  CheckoutIntent: 'orders/checkout-intent.model',
  ShipmentEvent: 'orders/shipment-event.model',
  Product: 'products/product.model',
  PlatformSecurity: 'admin/platform-security.model',
  AdminAuditLog: 'admin/admin-audit-log.model',
  Category: 'catalog/category.model',
  Brand: 'catalog/brand.model',
  CategoryBrandRequest: 'catalog/category-brand-request.model',
  Review: 'catalog/review.model',
  Cart: 'customers/cart.model',
  Wishlist: 'customers/wishlist.model',
  NotifyRequest: 'customers/notify-request.model',
  CheckoutFailure: 'customers/checkout-failure.model',
};
function stubPath(key) {
  const legacy = /^\.\.\/models\/(\w+)$/.exec(key);
  if (legacy && MODEL_PATHS[legacy[1]]) return path.join(SRC, 'modules', MODEL_PATHS[legacy[1]]);
  return path.resolve(LEGACY_DIR, key);
}
const NOOP_NOTIFICATIONS = {
  inr: (n) => String(n),
  escapeHtml: (s) => String(s ?? ''),
  CUSTOMER_STATUS_COPY: {},
  sendCustomerStatusEmail: async () => {},
  notifyTeamOfOrder: async () => {},
  emailSellersForOrder: async () => {},
  notifyTeamReturnRequested: async () => {},
  notifyTeamRefundRaised: async () => {},
};

function loadModule(name, overrides = {}) {
  if (!ENTRIES.has(name)) throw new Error(`loadModule: unknown module "${name}" (known: ${[...ENTRIES].join(', ')})`);
  const MODULE_DIR = path.join(SRC, 'modules', name);
  const ENTRY = path.join(MODULE_DIR, 'index.js');
  const stubs = {
    'express-async-handler': (fn) => fn,
    '../config/mail': { sendMail: async () => {} },
    '../infrastructure/shipping/shiprocket': {},
    '../infrastructure/payments/razorpay': {},
    ...overrides,
  };
  const byName = new Map();
  const byPath = new Map([[normalize(path.join(SRC, 'modules', 'orders', 'order-notifications')), NOOP_NOTIFICATIONS]]);
  for (const [key, value] of Object.entries(stubs)) {
    if (key.startsWith('.')) byPath.set(normalize(stubPath(key)), value);
    else byName.set(key, value);
  }

  const context = vm.createContext({
    console,
    process,
    Buffer,
    setTimeout,
    clearTimeout,
    setImmediate,
    URL,
    TextEncoder,
    TextDecoder,
  });
  const cache = new Map();

  function resolveInGraph(abs) {
    for (const candidate of [abs + '.js', abs, path.join(abs, 'index.js')]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return null;
  }

  function load(file) {
    const key = normalize(file);
    if (cache.has(key)) return cache.get(key).exports;
    const module = { exports: {} };
    cache.set(key, module);
    const dir = path.dirname(file);
    const realRequire = createRequire(file);
    const req = (name) => {
      if (byName.has(name)) return byName.get(name);
      if (!name.startsWith('.')) return realRequire(name);
      const target = path.resolve(dir, name);
      const targetKey = normalize(target);
      if (byPath.has(targetKey)) return byPath.get(targetKey);
      // Models register with mongoose once; load them for real, never a second time inside the VM.
      if (/\.model$/.test(targetKey)) return realRequire(name);
      const inGraph = targetKey.startsWith(normalize(MODULE_DIR)) || targetKey === normalize(ENTRY);
      if (inGraph) {
        const resolved = resolveInGraph(target);
        if (!resolved) throw new Error(`Cannot resolve ${name} from ${file}`);
        return load(resolved);
      }
      return realRequire(name);
    };
    const source = fs.readFileSync(file, 'utf8');
    const wrapper = vm.runInContext(
      `(function (exports, require, module, __filename, __dirname) {${source}\n})`,
      context,
      { filename: file },
    );
    wrapper(module.exports, req, module, file, dir);
    return module.exports;
  }

  const exported = load(ENTRY);
  return { ...exported, exports: exported };
}

const loadController = (overrides) => loadModule('orders', overrides);

function response() {
  return {
    statusCode: 200,
    headersSent: false,
    status(n) {
      this.statusCode = n;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
    set() {
      return this;
    },
    setHeader() {},
  };
}
module.exports = { loadModule, loadController, response };
