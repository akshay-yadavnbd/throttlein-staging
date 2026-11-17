/**
 * The assistant's tools — everything the model can do, and therefore
 * everything a user can do through it. Each tool is a thin, allow-listed
 * wrapper over the product API, called with the user's own JWT, so the
 * API's ownership and role rules are the real boundary: a seller's tools
 * read /products/mine and write to products the API confirms are theirs.
 *
 * Shape: { name, description, audience: 'seller' | 'superadmin' | 'both',
 * write: bool, input: zod shape, run(args, ctx) → JSON }. Write tools take an
 * optional `confirmation`; without one they return a preview and a signed
 * confirmation (./confirm.js) instead of changing anything.
 */
'use strict';
const crypto = require('crypto');
const z = require('zod/v4');
const { sign, check } = require('../confirm');
const { untrusted } = require('../guard');

/**
 * Drafts fetched from a product page wait here (per user, 15 minutes) between
 * `import_product_from_url` and `create_product`: the photos are binary and
 * belong in neither the model's context nor the browser's conversation.
 */
const IMPORT_TTL_MS = 15 * 60 * 1000;
const imports = new Map();
function stashImport(userId, data) {
  const now = Date.now();
  for (const [id, entry] of imports) if (entry.expires <= now) imports.delete(id);
  if (imports.size > 200) imports.delete(imports.keys().next().value);
  const id = crypto.randomUUID();
  imports.set(id, { ...data, user: userId, expires: now + IMPORT_TTL_MS });
  return { id, expiresAt: new Date(now + IMPORT_TTL_MS).toISOString() };
}
function readImport(userId, id) {
  const entry = imports.get(String(id || ''));
  if (!entry || entry.user !== userId || entry.expires <= Date.now()) throw new ToolError('NOT_FOUND', 'That import has expired or does not exist. Import the page again.');
  return entry;
}

const ORDER_STATUSES = ['placed', 'confirmed', 'shipped', 'delivered', 'cancelled'];
const SELLER_STATUSES = ['active', 'draft', 'out_of_stock'];
const ADMIN_STATUSES = [...SELLER_STATUSES, 'rejected'];
const LOW_STOCK = 5;

class ToolError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const idOf = (p) => String(p._id || p.id || '');
const nameOf = (x) => (x && typeof x === 'object' ? x.name : x) || null;

/** What the model sees for one product — the seller's own data, bounded. */
function productView(p, { full = false } = {}) {
  const variants = Array.isArray(p.variants) ? p.variants : [];
  const view = {
    id: idOf(p), name: p.name, slug: p.slug || null, sku: p.sku || null, status: p.status,
    price: p.price, mrp: p.mrp ?? null, currency: 'INR', stock: p.stock ?? null,
    category: nameOf(p.category), brand: nameOf(p.brand), bike: nameOf(p.bike) || null,
    color: p.color || null, sizes: Array.isArray(p.sizes) ? p.sizes : [], variantCount: variants.length,
    codAvailable: p.codAvailable ?? null, isFeatured: Boolean(p.isFeatured), imageCount: Array.isArray(p.images) ? p.images.length : 0,
    updatedAt: p.updatedAt || null,
  };
  if (full) {
    Object.assign(view, {
      description: untrusted(String(p.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), 1200),
      weightGrams: p.weightGrams ?? null, dimensionsCm: { length: p.lengthCm ?? null, breadth: p.breadthCm ?? null, height: p.heightCm ?? null },
      returnPolicyDays: p.returnPolicyDays ?? null, exchangePolicyDays: p.exchangePolicyDays ?? null,
      seoTitle: p.seoTitle || null, seoDescription: untrusted(p.seoDescription, 300),
      variants: variants.slice(0, 40).map((v) => ({ size: v.size || null, color: v.color || null, stock: v.stock ?? null, sku: v.sku || null, price: v.price ?? null })),
      offer: p.offer || p.activeOffer || null,
    });
  }
  return view;
}

/** Admin rows come from every seller: keep the store, drop the seller's contact details. */
function adminProductView(p) {
  const seller = p.seller && typeof p.seller === 'object' ? { id: idOf(p.seller), store: p.seller.storeName || p.seller.name || null } : (p.seller ? { id: String(p.seller) } : null);
  return { ...productView(p), seller };
}

const maskEmail = (v) => (typeof v === 'string' && v.includes('@') ? `${v[0]}***@${v.split('@')[1]}` : (v ? '[hidden]' : null));
const maskPhone = (v) => { const d = String(v || '').replace(/\D/g, ''); return d.length >= 4 ? `***${d.slice(-4)}` : (v ? '[hidden]' : null); };
const contactOf = (view, email, phone) => ({ email: view.reveal ? (email || null) : maskEmail(email), phone: view.reveal ? (phone || null) : maskPhone(phone) });

/** One shipment leg, as the seller sees it: status, courier, tracking, problems. Courier messages are free text → untrusted. */
function shipmentView(s) {
  return {
    kind: s.kind || 'forward', status: s.status || null, courierStatus: untrusted(s.currentStatus, 200), awb: s.awbCode || null, courier: s.awbCourier || null,
    etd: s.etd || null, confirmedAt: s.confirmedAt || null, pickupScheduledAt: s.pickupScheduledAt || null, pickedUpAt: s.pickedUpAt || null,
    deliveredAt: s.deliveredAt || null, ndrCount: s.ndrCount || 0, lastError: untrusted(s.lastError || s.pickupError, 400),
  };
}

function returnView(r) {
  return {
    kind: r.kind, status: r.status, reason: untrusted(r.reason, 400), requestedAt: r.requestedAt || null, decisionAt: r.decisionAt || null,
    items: (r.items || []).map((it) => ({ name: it.name, quantity: it.quantity })), refundStatus: r.refundStatus || null, refundAmount: r.refundAmount ?? null,
  };
}

/** Compact order row. Seller DTOs carry only that seller's items and shipments; admin orders carry everything plus the customer. */
function orderRow(o, role, view) {
  const a = o.shippingAddress || {};
  const items = Array.isArray(o.items) ? o.items : [];
  const forward = (o.sellerShipments || []).find((s) => (s.kind || 'forward') === 'forward' && !s.returnOf) || (o.sellerShipments || [])[0];
  return {
    id: idOf(o), orderNumber: o.orderNumber, placedAt: o.createdAt, status: o.status, ...(o.overallStatus && o.overallStatus !== o.status && { overallStatus: o.overallStatus }),
    paymentMethod: o.paymentMethod, paymentStatus: o.paymentStatus,
    amount: role === 'seller' ? (o.myItemsSubtotal ?? o.total ?? null) : (o.total ?? null), currency: 'INR',
    customer: role === 'superadmin' && o.user ? { name: o.user.name || null, ...contactOf(view, o.user.email, o.user.phone) } : (a.fullName ? { name: a.fullName } : null),
    destination: { city: a.city || null, state: a.state || null, pincode: a.pincode || null },
    items: items.slice(0, 10).map((it) => ({ name: it.name, quantity: it.quantity, price: it.price, size: it.size || null, color: it.color || null })),
    ...(role === 'superadmin' && Array.isArray(o.sellers) && { sellers: o.sellers.map((s) => s.name) }),
    shipment: forward ? shipmentView(forward) : null,
    openReturns: (o.returnRequests || []).filter((r) => ['pending', 'approved'].includes(r.status)).length,
    hold: o.fulfillmentHold || null,
  };
}

function orderDetail(o, role, view) {
  const a = o.shippingAddress || {};
  const sellerName = (id) => view.sellerById?.[String(id)]?.name || null;
  return {
    ...orderRow(o, role, view),
    timeline: { confirmedAt: o.confirmedAt || null, shippedAt: o.shippedAt || null, deliveredAt: o.deliveredAt || null, cancelledAt: o.cancelledAt || null },
    shippingAddress: { fullName: a.fullName || null, phone: view.reveal ? (a.phone || null) : maskPhone(a.phone), line1: untrusted(a.line1, 300), line2: untrusted(a.line2, 300), city: a.city || null, state: a.state || null, pincode: a.pincode || null, country: a.country || null },
    items: (o.items || []).map((it) => ({ name: it.name, quantity: it.quantity, price: it.price, mrp: it.mrp ?? null, subtotal: it.subtotal, size: it.size || null, color: it.color || null, returnedQuantity: it.returnedQuantity || 0, ...(role === 'superadmin' && { seller: sellerName(it.seller) }) })),
    ...(role === 'seller' && { earnings: o.earnings || null }),
    ...(role === 'superadmin' && { amounts: { itemsTotal: o.itemsTotal ?? null, shippingFee: o.shippingFee ?? null, total: o.total ?? null }, razorpayOrderId: o.razorpayOrderId || null }),
    shipments: (o.sellerShipments || []).map((s) => ({ ...(role === 'superadmin' && { seller: sellerName(s.seller) }), ...shipmentView(s) })),
    returnRequests: (o.returnRequests || []).map(returnView),
  };
}

const matches = (p, needle) => {
  const n = needle.toLowerCase();
  return [p.name, p.sku, p.slug, nameOf(p.category), nameOf(p.brand), p.color].some((v) => String(v || '').toLowerCase().includes(n));
};

async function myProducts(ctx) {
  const data = await ctx.backend.call(ctx.token, { method: 'GET', path: '/products/mine' });
  return Array.isArray(data?.items) ? data.items : [];
}

/** Resolve one of the seller's products by id, slug or SKU; exact matches first, then a unique name match. */
async function findMine(ctx, ref) {
  const products = await myProducts(ctx);
  const needle = String(ref || '').trim().toLowerCase();
  if (!needle) throw new ToolError('INVALID_ARGUMENT', 'Say which product: its SKU, name or id.');
  const exact = products.find((p) => [idOf(p), p.slug, p.sku].some((v) => String(v || '').toLowerCase() === needle));
  if (exact) return exact;
  const byName = products.filter((p) => String(p.name || '').toLowerCase().includes(needle));
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) throw new ToolError('AMBIGUOUS', `${byName.length} of your products match "${ref}": ${byName.slice(0, 5).map((p) => `${p.name} (SKU ${p.sku || '—'})`).join('; ')}. Use the SKU or id.`);
  throw new ToolError('NOT_FOUND', `None of your products match "${ref}".`);
}

/** Superadmins may reach any product; resolve through the admin list or the public detail route. */
async function findAny(ctx, ref) {
  const needle = String(ref || '').trim();
  if (!needle) throw new ToolError('INVALID_ARGUMENT', 'Say which product: its SKU, name or id.');
  if (/^[a-f0-9]{24}$/i.test(needle)) {
    try { const d = await ctx.backend.call(ctx.token, { method: 'GET', path: `/products/${needle}` }); if (d?.product) return d.product; } catch { /* fall through to the admin list */ }
  }
  const data = await ctx.backend.call(ctx.token, { method: 'GET', path: '/admin/products', query: { scope: 'all', q: needle, limit: 10 } });
  const rows = Array.isArray(data?.items) ? data.items : Array.isArray(data?.products) ? data.products : [];
  const exact = rows.find((p) => [idOf(p), p.slug, p.sku].some((v) => String(v || '').toLowerCase() === needle.toLowerCase()));
  if (exact) return exact;
  if (rows.length === 1) return rows[0];
  if (rows.length > 1) throw new ToolError('AMBIGUOUS', `${rows.length} products match "${ref}": ${rows.slice(0, 5).map((p) => `${p.name} (SKU ${p.sku || '—'}, id ${idOf(p)})`).join('; ')}. Use the id.`);
  throw new ToolError('NOT_FOUND', `No product matches "${ref}".`);
}

const findProduct = (ctx, ref) => (ctx.user.role === 'superadmin' ? findAny(ctx, ref) : findMine(ctx, ref));

/**
 * Preview-or-apply. `describe` builds the preview from the live record;
 * `apply` performs the change. Both run only after the product is resolved.
 */
async function twoStep(ctx, tool, args, { describe, apply }) {
  const { confirmation, ...rest } = args;
  const preview = await describe();
  if (!confirmation) {
    const signed = sign(ctx.secret, { user: ctx.user.id, tool, args: rest, ttlMs: ctx.confirmationTtlMs });
    return { preview: true, ...preview, confirmation: signed.confirmation, confirmationExpiresAt: signed.expiresAt, note: 'Nothing has changed yet. Show this to the user and, only after they clearly agree, call the same tool again with the same arguments plus this confirmation.' };
  }
  const verdict = check(ctx.secret, confirmation, { user: ctx.user.id, tool, args: rest });
  if (verdict === 'expired') throw new ToolError('CONFIRMATION_EXPIRED', 'That confirmation expired. Call the tool again without it for a fresh preview and ask the user again.');
  if (verdict !== 'ok') throw new ToolError('CONFIRMATION_INVALID', 'That confirmation does not match this change. Call the tool again without it for a fresh preview.');
  const result = await apply();
  return { applied: true, ...preview, ...result };
}

// Schemas are sent to the model on every call; keep descriptions to what changes behaviour.
const objectId = () => z.string().regex(/^[a-f0-9]{24}$/);
const CHANGE_FIELDS = {
  name: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().min(1).max(12000).optional(),
  price: z.number().positive().max(10000000).optional(),
  mrp: z.number().positive().max(10000000).optional(),
  stock: z.number().int().min(0).max(1000000).optional(),
  sku: z.string().trim().min(1).max(80).optional(),
  status: z.enum(SELLER_STATUSES).optional(),
  color: z.string().trim().max(60).optional(),
  sizes: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  weightGrams: z.number().positive().max(200000).optional(),
  lengthCm: z.number().positive().max(500).optional(), breadthCm: z.number().positive().max(500).optional(), heightCm: z.number().positive().max(500).optional(),
  codAvailable: z.boolean().optional(),
  returnPolicyDays: z.number().int().min(0).max(365).nullable().optional(), exchangePolicyDays: z.number().int().min(0).max(365).nullable().optional(),
  seoTitle: z.string().trim().max(160).optional(), seoDescription: z.string().trim().max(320).optional(),
  category: objectId().optional().describe('id from list_categories'),
  brand: objectId().nullable().optional().describe('id from list_brands; null clears'),
};

const productArg = z.string().trim().min(1).max(120).describe('SKU, name, slug or id');
const confirmationArg = z.string().max(600).optional().describe('from the preview, after the user agreed');

function flatten(list, out = [], depth = 0) {
  for (const c of list || []) {
    if (!c || typeof c !== 'object') continue;
    out.push({ id: idOf(c), name: c.name, slug: c.slug || null, parent: c.parent ? (typeof c.parent === 'object' ? c.parent.name || idOf(c.parent) : String(c.parent)) : null });
    if (depth < 4 && Array.isArray(c.children)) flatten(c.children, out, depth + 1);
  }
  return out;
}

const tools = [
  {
    name: 'catalog_summary',
    description: 'Overview of the seller\'s own catalogue: counts by status, products low on stock, products without images, and the most recently updated items.',
    audience: 'seller', write: false,
    run: async (_args, ctx) => {
      const products = await myProducts(ctx);
      const byStatus = {};
      for (const p of products) byStatus[p.status || 'unknown'] = (byStatus[p.status || 'unknown'] || 0) + 1;
      return {
        total: products.length, byStatus,
        lowStock: products.filter((p) => Number(p.stock) <= LOW_STOCK && p.status !== 'draft').slice(0, 15).map((p) => ({ id: idOf(p), name: p.name, sku: p.sku || null, stock: p.stock })),
        withoutImages: products.filter((p) => !(Array.isArray(p.images) && p.images.length)).slice(0, 15).map((p) => ({ id: idOf(p), name: p.name, sku: p.sku || null })),
        recentlyUpdated: [...products].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)).slice(0, 5).map((p) => productView(p)),
      };
    },
  },
  {
    name: 'list_my_products',
    description: 'The seller\'s own products with optional text search (name, SKU, category, brand, colour), status filter and a low-stock threshold.',
    audience: 'seller', write: false,
    input: { query: z.string().trim().max(100).optional(), status: z.enum(SELLER_STATUSES).optional(), stockBelow: z.number().int().min(0).max(100000).optional(), limit: z.number().int().min(1).max(50).default(20), offset: z.number().int().min(0).max(100000).default(0).describe('rows to skip, for paging') },
    run: async ({ query, status, stockBelow, limit, offset = 0 }, ctx) => {
      let products = await myProducts(ctx);
      if (status) products = products.filter((p) => p.status === status);
      if (query) products = products.filter((p) => matches(p, query));
      if (stockBelow !== undefined) products = products.filter((p) => Number(p.stock) < stockBelow);
      const page = products.slice(offset, offset + limit);
      return { total: products.length, offset, shown: page.length, products: page.map((p) => productView(p)) };
    },
  },
  {
    name: 'get_product',
    description: 'Full detail of one product: description, pricing, stock, variants, dimensions, policies and SEO text.',
    audience: 'both', write: false,
    input: { product: productArg },
    run: async ({ product }, ctx) => ({ product: ctx.user.role === 'superadmin' ? { ...adminProductView(await findProduct(ctx, product)), ...productView(await findProduct(ctx, product), { full: true }) } : productView(await findProduct(ctx, product), { full: true }) }),
  },
  {
    name: 'search_products',
    description: 'Search products across every seller (superadmin): text search on name/SKU, status filter, paging. Seller contact details are not included.',
    audience: 'superadmin', write: false,
    input: { query: z.string().trim().max(100).optional(), status: z.enum(ADMIN_STATUSES).optional(), page: z.number().int().min(1).max(500).default(1), limit: z.number().int().min(1).max(50).default(20), offset: z.number().int().min(0).max(100000).optional().describe('rows to skip; overrides page') },
    run: async ({ query, status, page, limit, offset }, ctx) => {
      if (offset !== undefined) page = Math.floor(offset / limit) + 1;
      const data = await ctx.backend.call(ctx.token, { method: 'GET', path: '/admin/products', query: { scope: 'all', q: query, status, page, limit } });
      const rows = Array.isArray(data?.items) ? data.items : Array.isArray(data?.products) ? data.products : [];
      return { total: data?.total ?? rows.length, page, products: rows.map(adminProductView) };
    },
  },
  {
    name: 'update_product',
    description: 'Change one product\'s details (any of the fields in `changes`). Returns a preview + confirmation first; applies only when called again with that confirmation after the user agrees.',
    audience: 'both', write: true,
    input: { product: productArg, changes: z.object(CHANGE_FIELDS).strict().describe('only the fields to change'), confirmation: confirmationArg },
    run: async (args, ctx) => {
      const { product: ref, changes } = args;
      const keys = Object.keys(changes || {});
      if (!keys.length) throw new ToolError('INVALID_ARGUMENT', 'Say what to change (e.g. price, stock, status).');
      if (changes.mrp !== undefined && changes.price !== undefined && changes.mrp < changes.price) throw new ToolError('INVALID_ARGUMENT', 'MRP must be at least the selling price.');
      const product = await findProduct(ctx, ref);
      if (changes.mrp !== undefined && changes.price === undefined && product.price > changes.mrp) throw new ToolError('INVALID_ARGUMENT', `MRP ${changes.mrp} would be below the current price ${product.price}.`);
      if (changes.price !== undefined && changes.mrp === undefined && product.mrp && changes.price > product.mrp) throw new ToolError('INVALID_ARGUMENT', `Price ${changes.price} would be above the current MRP ${product.mrp}; change both or lower the price.`);
      return twoStep(ctx, 'update_product', args, {
        describe: async () => ({
          product: { id: idOf(product), name: product.name, sku: product.sku || null },
          changes: keys.map((k) => ({ field: k, from: k === 'description' ? untrusted(String(product[k] || '').replace(/<[^>]+>/g, ' ').trim(), 300) : (product[k] && typeof product[k] === 'object' && !Array.isArray(product[k]) ? nameOf(product[k]) : product[k] ?? null), to: k === 'description' ? untrusted(changes[k], 300) : changes[k] })),
        }),
        apply: async () => {
          const body = { ...changes };
          if (body.brand === null) body.brand = '';
          const data = await ctx.backend.call(ctx.token, { method: 'PUT', path: `/products/${idOf(product)}`, body });
          return { product: productView(data?.product || data?.item || { ...product, ...changes }) };
        },
      });
    },
  },
  {
    name: 'set_product_status',
    description: 'Set a product active, draft or out_of_stock (superadmin: also rejected, or featured true/false). Preview + confirmation first.',
    audience: 'both', write: true,
    input: { product: productArg, status: z.enum(ADMIN_STATUSES).optional(), featured: z.boolean().optional().describe('superadmin only'), confirmation: confirmationArg },
    run: async (args, ctx) => {
      const { product: ref, status, featured } = args;
      const admin = ctx.user.role === 'superadmin';
      if (status === undefined && featured === undefined) throw new ToolError('INVALID_ARGUMENT', 'Say the new status (active, draft, out_of_stock) or featured true/false.');
      if (!admin && (status === 'rejected' || featured !== undefined)) throw new ToolError('FORBIDDEN', 'Only a superadmin can reject or feature a product.');
      const product = await findProduct(ctx, ref);
      return twoStep(ctx, 'set_product_status', args, {
        describe: async () => ({ product: { id: idOf(product), name: product.name, sku: product.sku || null }, changes: [...(status !== undefined ? [{ field: 'status', from: product.status, to: status }] : []), ...(featured !== undefined ? [{ field: 'isFeatured', from: Boolean(product.isFeatured), to: featured }] : [])] }),
        apply: async () => {
          const data = admin
            ? await ctx.backend.call(ctx.token, { method: 'PATCH', path: `/admin/products/${idOf(product)}/status`, body: { ...(status !== undefined && { status }), ...(featured !== undefined && { isFeatured: featured }) } })
            : await ctx.backend.call(ctx.token, { method: 'PUT', path: `/products/${idOf(product)}`, body: { status } });
          return { product: productView(data?.product || data?.item || { ...product, ...(status && { status }), ...(featured !== undefined && { isFeatured: featured }) }) };
        },
      });
    },
  },
  {
    name: 'bulk_set_status',
    description: 'Set several of the seller\'s products to active or draft at once. Preview + confirmation first.',
    audience: 'seller', write: true,
    input: { products: z.array(productArg).min(1).max(50), status: z.enum(['active', 'draft']), confirmation: confirmationArg },
    run: async (args, ctx) => {
      const all = await myProducts(ctx);
      const resolved = [];
      for (const ref of args.products) resolved.push(await findMine({ ...ctx, backend: { call: async () => ({ items: all }) } }, ref));
      const unique = [...new Map(resolved.map((p) => [idOf(p), p])).values()];
      return twoStep(ctx, 'bulk_set_status', args, {
        describe: async () => ({ status: args.status, products: unique.map((p) => ({ id: idOf(p), name: p.name, sku: p.sku || null, from: p.status })) }),
        apply: async () => {
          const data = await ctx.backend.call(ctx.token, { method: 'POST', path: '/products/bulk-status', body: { ids: unique.map(idOf), status: args.status } });
          return { updated: data?.updated ?? unique.length, skipped: data?.skipped ?? 0 };
        },
      });
    },
  },
  {
    name: 'delete_product',
    description: 'Permanently delete one product (irreversible; prefer draft unless deletion is clearly wanted). Preview + confirmation first.',
    audience: 'both', write: true,
    input: { product: productArg, confirmation: confirmationArg },
    run: async (args, ctx) => {
      const product = await findProduct(ctx, args.product);
      return twoStep(ctx, 'delete_product', args, {
        describe: async () => ({ product: productView(product), warning: 'Deletion is permanent. Setting the product to draft hides it from the storefront without losing it.' }),
        apply: async () => { await ctx.backend.call(ctx.token, { method: 'DELETE', path: `/products/${idOf(product)}` }); return { deleted: true }; },
      });
    },
  },
  {
    name: 'import_product_from_url',
    description: 'Fetch a public https product page and extract a draft (name, description, INR price/MRP, SKU, brand/category names, colour, sizes, weight, dimensions, SEO, up to 6 photos) for create_product. Saves nothing. Call only after the user confirmed they may reuse the page\'s content and photos. 3/min, 30/day.',
    audience: 'both', write: false,
    input: {
      url: z.string().trim().url().max(2000),
      confirmRights: z.boolean().default(false).describe('true only after the user confirmed reuse rights'),
    },
    run: async ({ url, confirmRights }, ctx) => {
      if (!confirmRights) throw new ToolError('RIGHTS_REQUIRED', 'Ask the user to confirm they have permission to reuse this page\'s content and photos, then call again with confirmRights: true.');
      const data = await ctx.backend.call(ctx.token, { method: 'POST', path: '/products/import-url', body: { url, confirmRights: true }, timeout: 90000 });
      const draft = data?.draft || {};
      const images = Array.isArray(data?.images) ? data.images.filter((i) => i && i.base64 && i.mime).slice(0, 6) : [];
      const { id, expiresAt } = stashImport(ctx.user.id, { draft, images, sourceUrl: data?.sourceUrl || url });
      const missing = [];
      if (!draft.sku) missing.push('sku');
      if (!(Number(draft.weightGrams) > 0)) missing.push('weightGrams');
      missing.push('category (an id from list_categories; the page suggested "' + (draft.categoryName || 'none') + '")');
      return {
        importId: id, expiresAt, sourceUrl: data?.sourceUrl || url,
        draft: {
          name: draft.name || null, price: draft.price ?? null, mrp: draft.mrp ?? null, currency: draft.currency || null, sku: draft.sku || null,
          brandName: draft.brandName || null, categoryName: draft.categoryName || null, color: draft.color || null, sizes: draft.sizes || [],
          weightGrams: draft.weightGrams ?? null, dimensionsCm: { length: draft.lengthCm ?? null, breadth: draft.breadthCm ?? null, height: draft.heightCm ?? null },
          seoTitle: draft.seoTitle || null, seoDescription: untrusted(draft.seoDescription, 300),
          description: untrusted(String(draft.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), 600), descriptionLength: String(draft.description || '').length,
        },
        photos: { count: images.length, names: images.map((i) => i.name) },
        warnings: Array.isArray(data?.warnings) ? data.warnings.map((w) => String(w).slice(0, 300)) : [],
        missingForCreate: missing,
        nextStep: 'Show the draft to the user, settle the missing fields (SKU, weight in grams, category id, selling price and stock), then call create_product with this importId. The product is created as a draft unless the user asks to publish.',
      };
    },
  },
  {
    name: 'create_product',
    description: 'Create a product from an import (importId; photos attached) and/or given details. Needs name, price, SKU, weightGrams and category id. Draft by default; status active publishes. Preview + confirmation first.',
    audience: 'both', write: true,
    input: {
      importId: z.string().max(60).optional().describe('fills fields not given here'),
      name: CHANGE_FIELDS.name, description: CHANGE_FIELDS.description, price: CHANGE_FIELDS.price, mrp: CHANGE_FIELDS.mrp, stock: CHANGE_FIELDS.stock,
      sku: CHANGE_FIELDS.sku, weightGrams: CHANGE_FIELDS.weightGrams, lengthCm: CHANGE_FIELDS.lengthCm, breadthCm: CHANGE_FIELDS.breadthCm, heightCm: CHANGE_FIELDS.heightCm,
      category: objectId().optional(), brand: objectId().optional(), color: CHANGE_FIELDS.color, sizes: CHANGE_FIELDS.sizes, codAvailable: CHANGE_FIELDS.codAvailable,
      status: z.enum(['draft', 'active']).default('draft'), seoTitle: CHANGE_FIELDS.seoTitle, seoDescription: CHANGE_FIELDS.seoDescription,
      confirmation: confirmationArg,
    },
    run: async (args, ctx) => {
      const entry = args.importId ? readImport(ctx.user.id, args.importId) : null;
      const d = entry?.draft || {};
      const fromDraft = {
        name: d.name, description: d.description, sku: d.sku, weightGrams: d.weightGrams, lengthCm: d.lengthCm, breadthCm: d.breadthCm, heightCm: d.heightCm,
        color: d.color, sizes: Array.isArray(d.sizes) && d.sizes.length ? d.sizes : undefined, seoTitle: d.seoTitle, seoDescription: d.seoDescription,
        ...(d.currency === 'INR' && { price: d.price, mrp: d.mrp }),
      };
      const { confirmation, importId, ...explicit } = args;
      const fields = {};
      for (const [k, v] of Object.entries({ ...fromDraft, ...explicit })) if (v !== undefined && v !== null && v !== '') fields[k] = v;
      fields.status = fields.status || 'draft';
      fields.stock = fields.stock ?? 0;
      const missing = ['name', 'price', 'sku', 'weightGrams', 'category'].filter((k) => fields[k] === undefined);
      if (missing.length) throw new ToolError('INVALID_ARGUMENT', `Still needed before creating: ${missing.join(', ')}. Ask the user${missing.includes('category') ? ' (find the category id with list_categories)' : ''}.`);
      if (fields.mrp !== undefined && fields.mrp < fields.price) throw new ToolError('INVALID_ARGUMENT', 'MRP must be at least the selling price.');
      const images = entry?.images || [];
      if (fields.status === 'active' && !images.length) throw new ToolError('INVALID_ARGUMENT', 'A product needs at least one photo to be published. Create it as a draft and add photos in the dashboard.');
      return twoStep(ctx, 'create_product', args, {
        describe: async () => ({
          willCreate: { ...fields, description: untrusted(String(fields.description || '').replace(/<[^>]+>/g, ' ').trim(), 300), currency: 'INR' },
          photos: images.length, sourceUrl: entry?.sourceUrl || null,
          note: fields.status === 'draft' ? 'Created as a draft: visible only in the dashboard until published.' : 'Published immediately on the storefront.',
        }),
        apply: async () => {
          const form = new FormData();
          for (const [k, v] of Object.entries(fields)) form.append(k, Array.isArray(v) ? JSON.stringify(v) : String(v));
          for (const image of images) form.append('images', new Blob([Buffer.from(image.base64, 'base64')], { type: image.mime }), image.name || 'photo.jpg');
          const data = await ctx.backend.call(ctx.token, { method: 'POST', path: '/products', form, timeout: 60000 });
          if (entry) imports.delete(importId);
          return { product: productView(data?.product || data?.item || { ...fields, images }) };
        },
      });
    },
  },
  {
    name: 'list_orders',
    description: 'Orders newest first (seller: own orders; superadmin: all). "New orders" = status placed. Filter by status, days back, or an order number / customer search. Read-only.',
    audience: 'both', write: false,
    untrustedOutput: true,
    input: {
      status: z.enum(ORDER_STATUSES).optional(), days: z.number().int().min(1).max(365).optional().describe('placed within the last N days'),
      query: z.string().trim().min(2).max(100).optional().describe('order number or customer name/email'),
      limit: z.number().int().min(1).max(50).default(20), reveal: z.boolean().default(false).describe('unmask customer email/phone'),
      offset: z.number().int().min(0).max(100000).default(0).describe('rows to skip, for paging'),
    },
    run: async ({ status, days, query, limit, reveal, offset = 0 }, ctx) => {
      const since = days ? new Date(Date.now() - days * 86400000) : null;
      if (ctx.user.role === 'superadmin') {
        const data = await ctx.backend.call(ctx.token, { method: 'GET', path: '/admin/orders', query: { status, q: query, from: since ? since.toISOString().slice(0, 10) : undefined, limit, page: Math.floor(offset / limit) + 1 } });
        // The admin feed answers its rows as `items` (envelope); `orders` is the older shape.
        const rows = Array.isArray(data?.items) ? data.items : Array.isArray(data?.orders) ? data.orders : [];
        return { total: data?.total ?? rows.length, orders: rows.map((o) => orderRow(o, 'superadmin', { reveal })) };
      }
      const data = await ctx.backend.call(ctx.token, { method: 'GET', path: '/seller/orders', query: { page: 1, limit: 200 } });
      let rows = Array.isArray(data?.items) ? data.items : Array.isArray(data?.orders) ? data.orders : [];
      if (status) rows = rows.filter((o) => o.status === status);
      if (since) rows = rows.filter((o) => new Date(o.createdAt) >= since);
      if (query) { const q = query.toLowerCase(); rows = rows.filter((o) => String(o.orderNumber || '').toLowerCase().includes(q) || String(o.shippingAddress?.fullName || '').toLowerCase().includes(q)); }
      const slice = rows.slice(offset, offset + limit);
      return { total: rows.length, offset, shown: slice.length, orders: slice.map((o) => orderRow(o, 'seller', { reveal })) };
    },
  },
  {
    name: 'get_order',
    description: 'One order by number (e.g. TIN-2026-000019) or id: items, payment, shipping address, the shipment(s) with courier and tracking, return requests. Read-only — shipping, cancelling and returns happen in the Orders page.',
    audience: 'both', write: false,
    untrustedOutput: true,
    input: { order: z.string().trim().min(3).max(40).describe('order number or id'), reveal: z.boolean().default(false).describe('unmask customer email/phone') },
    run: async ({ order, reveal }, ctx) => {
      const admin = ctx.user.role === 'superadmin';
      const data = await ctx.backend.call(ctx.token, { method: 'GET', path: `${admin ? '/admin' : '/seller'}/orders/${encodeURIComponent(order.toUpperCase())}` });
      if (!data?.order) throw new ToolError('NOT_FOUND', `Order "${order}" was not found.`);
      return { order: orderDetail(data.order, admin ? 'superadmin' : 'seller', { reveal, sellerById: data.sellerById || {} }) };
    },
  },
  {
    name: 'list_categories',
    description: 'Product categories (id, name, parent) — use to find the category id when moving a product.',
    audience: 'both', write: false,
    input: { query: z.string().trim().max(60).optional() },
    run: async ({ query }, ctx) => {
      const data = await ctx.backend.call(ctx.token, { method: 'GET', path: '/categories', query: { all: 1 } });
      const rows = flatten(Array.isArray(data) ? data : data?.items || data?.categories || data?.tree || []);
      const filtered = query ? rows.filter((c) => String(c.name || '').toLowerCase().includes(query.toLowerCase())) : rows;
      return { total: filtered.length, categories: filtered.slice(0, 60) };
    },
  },
  {
    name: 'list_brands',
    description: 'Brands (id, name) — use to find the brand id when changing a product\'s brand.',
    audience: 'both', write: false,
    input: { query: z.string().trim().max(60).optional() },
    run: async ({ query }, ctx) => {
      const data = await ctx.backend.call(ctx.token, { method: 'GET', path: '/brands', query: { all: 1 } });
      const rows = (Array.isArray(data) ? data : data?.items || data?.brands || []).map((b) => ({ id: idOf(b), name: b.name, slug: b.slug || null }));
      const filtered = query ? rows.filter((b) => String(b.name || '').toLowerCase().includes(query.toLowerCase())) : rows;
      return { total: filtered.length, brands: filtered.slice(0, 60) };
    },
  },
];

tools.push(...require('./sellerPanel')({ twoStep, ToolError, untrusted, idOf, myProducts, findMine, confirmationArg, productArg }));

/**
 * Best sellers, worked out from the seller's own orders (cancelled ones
 * excluded) plus the offline sales they recorded. Units, revenue and order
 * count per product, joined with the live catalogue for SKU, stock and price.
 */
const IST_OFFSET = '+05:30';
async function sellerSales(ctx, { days }) {
  const since = days ? new Date(Date.now() - days * 86400000) : null;
  const orders = [];
  for (let page = 1; page <= 10; page += 1) { // up to 2,000 recent orders
    const d = await ctx.backend.call(ctx.token, { method: 'GET', path: '/seller/orders', query: { page, limit: 200 } });
    const rows = Array.isArray(d?.items) ? d.items : Array.isArray(d?.orders) ? d.orders : [];
    orders.push(...rows);
    const oldest = rows[rows.length - 1];
    if (rows.length < 200 || (since && oldest && new Date(oldest.createdAt) < since)) break;
  }
  const offline = [];
  const fromDate = since ? `${since.toISOString().slice(0, 10)}T00:00:00${IST_OFFSET}` : undefined;
  for (let page = 1; page <= 20; page += 1) { // up to 2,000 offline sales
    const d = await ctx.backend.call(ctx.token, { method: 'GET', path: '/seller/offline-sales', query: { page, limit: 100, from: fromDate } });
    const rows = Array.isArray(d?.items) ? d.items : [];
    offline.push(...rows);
    if (rows.length < 100) break;
  }
  return { since, orders: orders.filter((o) => (!since || new Date(o.createdAt) >= since) && o.status !== 'cancelled' && o.paymentStatus !== 'failed'), offline };
}

tools.push({
  name: 'top_selling_products',
  description: 'The seller\'s best-selling ACTIVE (published) products only — drafts, out-of-stock-status and deleted products are left out: units sold, revenue and number of orders per product (online orders, cancelled excluded, plus recorded offline sales), with current SKU, stock and price. Optional: last N days, sort by units or revenue, online/offline/all.',
  audience: 'seller', write: false, groups: ['catalog', 'orders', 'payouts', 'offline'],
  input: {
    days: z.number().int().min(1).max(730).optional().describe('only sales in the last N days; omit for all time'),
    sortBy: z.enum(['units', 'revenue']).default('units'),
    channel: z.enum(['all', 'online', 'offline']).default('all'),
    limit: z.number().int().min(1).max(50).default(10),
    offset: z.number().int().min(0).max(100000).default(0).describe('rows to skip, for paging'),
  },
  run: async ({ days, sortBy = 'units', channel = 'all', limit = 10, offset = 0 }, ctx) => {
    const [{ orders, offline }, catalogue] = await Promise.all([sellerSales(ctx, { days }), myProducts(ctx)]);
    const byId = new Map(catalogue.map((p) => [idOf(p), p]));
    const byName = new Map(catalogue.map((p) => [String(p.name || '').trim().toLowerCase(), p]));
    const stats = new Map();
    const bucket = (id, name) => {
      const key = id || `name:${String(name || '').toLowerCase()}`;
      if (!stats.has(key)) stats.set(key, { id: id || null, name: name || 'Unknown product', units: 0, revenue: 0, orders: new Set(), onlineUnits: 0, offlineUnits: 0, lastSoldAt: null });
      return stats.get(key);
    };
    const seen = (b, at) => { if (at && (!b.lastSoldAt || new Date(at) > new Date(b.lastSoldAt))) b.lastSoldAt = at; };
    if (channel !== 'offline') {
      for (const o of orders) {
        for (const it of o.items || []) {
          const id = it.product ? String(it.product._id || it.product) : null;
          const b = bucket(id, it.name);
          const q = Number(it.quantity) || 0;
          b.units += q; b.onlineUnits += q;
          b.revenue += Number(it.subtotal ?? (Number(it.price) || 0) * q) || 0;
          b.orders.add(String(o._id || o.orderNumber));
          seen(b, o.createdAt);
        }
      }
    }
    if (channel !== 'online') {
      for (const s of offline) {
        const id = s.product ? String(s.product._id || s.product) : null;
        const b = bucket(id, s.productName);
        const q = Number(s.quantity) || 0;
        b.units += q; b.offlineUnits += q;
        b.revenue += Number(s.totalAmount) || 0;
        seen(b, s.saleDate);
      }
    }
    // Only products that are live right now (status "active"); a sale line without a product id is matched by name.
    const productOf = (b) => (b.id ? byId.get(b.id) : null) || byName.get(String(b.name || '').trim().toLowerCase()) || null;
    const ranked = [...stats.values()]
      .filter((b) => b.units > 0 && productOf(b)?.status === 'active')
      .sort((a, b) => (sortBy === 'revenue' ? b.revenue - a.revenue || b.units - a.units : b.units - a.units || b.revenue - a.revenue))
      .map((b, i) => {
        const p = productOf(b);
        return {
          rank: i + 1, id: b.id || (p ? idOf(p) : null), name: p?.name || b.name, slug: p?.slug || null, sku: p?.sku || null,
          unitsSold: b.units, onlineUnits: b.onlineUnits, offlineUnits: b.offlineUnits,
          revenue: Math.round(b.revenue * 100) / 100, currency: 'INR', orders: b.orders.size,
          currentStock: p ? (p.stock ?? null) : null, currentPrice: p ? p.price : null, status: p ? p.status : 'deleted', lastSoldAt: b.lastSoldAt,
        };
      });
    const page = ranked.slice(offset, offset + limit);
    return {
      period: days ? `last ${days} days` : 'all time', sortBy, channel,
      totals: { products: ranked.length, units: ranked.reduce((a, r) => a + r.unitsSold, 0), revenue: Math.round(ranked.reduce((a, r) => a + r.revenue, 0) * 100) / 100 },
      total: ranked.length, offset, shown: page.length, products: page,
    };
  },
});

/**
 * Areas each catalogue/order tool belongs to (seller-panel tools declare their
 * own). The agent sends only the tools for the areas a conversation touches —
 * every schema costs tokens on every model call.
 */
const GROUPS = {
  catalog_summary: ['catalog'], list_my_products: ['catalog', 'offers', 'offline'], get_product: ['catalog'], search_products: ['catalog'],
  update_product: ['catalog'], set_product_status: ['catalog'], bulk_set_status: ['catalog'], delete_product: ['catalog'],
  import_product_from_url: ['import'], create_product: ['import'], list_categories: ['catalog', 'import', 'requests'], list_brands: ['catalog', 'import'],
  list_orders: ['orders', 'returns'], get_order: ['orders', 'returns'],
};
for (const tool of tools) tool.groups = tool.groups || GROUPS[tool.name] || ['catalog'];
const AREAS = [...new Set(tools.flatMap((t) => t.groups))];

/** The role's tools, optionally only those in the given areas. */
const toolsFor = (role, groups) => tools.filter((t) => (t.audience === 'both' || t.audience === role) && (!groups || t.groups.some((g) => groups.includes(g))));

module.exports = { tools, toolsFor, AREAS, ToolError, productView, adminProductView, SELLER_STATUSES, ADMIN_STATUSES };
