/**
 * Seller-panel tools beyond the catalogue: order fulfilment, returns,
 * payouts, offers, offline sales, media, brand/category requests and store
 * settings — everything the seller dashboard does, through the same seller
 * routes it calls, with the seller's own JWT. Every change previews first and
 * applies only with the signed confirmation (twoStep).
 *
 * Deliberately absent: KYC / bank-detail changes and password changes (they
 * redirect money or lock the owner out), and PDF downloads (labels, invoices,
 * manifests), which belong in the Orders page.
 *
 * Built as a factory so it can share tools.js helpers without a require cycle.
 */
'use strict';
const z = require('zod/v4');

module.exports = function sellerPanelTools({ twoStep, ToolError, untrusted, idOf, myProducts, findMine, confirmationArg, productArg }) {
  const orderArg = z.string().trim().min(3).max(40).describe('order number, e.g. TIN-2026-000019');
  const dateArg = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  const orderPath = (order) => `/seller/orders/${encodeURIComponent(String(order).trim().toUpperCase())}`;
  const money = (n) => (n === null || n === undefined ? null : Math.round(Number(n) * 100) / 100);

  async function sellerOrder(ctx, order) {
    const data = await ctx.backend.call(ctx.token, { method: 'GET', path: orderPath(order) });
    if (!data?.order) throw new ToolError('NOT_FOUND', `Order "${order}" was not found among your orders.`);
    return data.order;
  }
  const myShipment = (o) => (o.sellerShipments || []).find((s) => (s.kind || 'forward') === 'forward' && !s.returnOf) || null;

  const ORDER_ACTIONS = {
    confirm: { route: (o) => ({ method: 'PATCH', path: `${orderPath(o)}/status`, body: { status: 'confirmed' } }), effect: 'Marks your parcel as confirmed; the customer may get a "confirmed" email.' },
    ship: { route: (o, a) => ({ method: 'POST', path: `${orderPath(o)}/ship`, body: a.courierId ? { courier_id: a.courierId } : {} }), effect: 'Books the courier and generates the shipping label (AWB) and pickup. The courier charge is deducted from your payout. Without courierId the courier the customer paid for (or Shiprocket\'s pick) is used.' },
    reschedule_pickup: { route: (o, a) => ({ method: 'POST', path: `${orderPath(o)}/reschedule-pickup`, body: a.courierId ? { courier_id: a.courierId } : {} }), effect: 'Asks for another pickup; with a different courierId the current label is cancelled and a new one booked.' },
    retry_push: { route: (o) => ({ method: 'POST', path: `${orderPath(o)}/retry-push` }), effect: 'Re-creates your shipment on Shiprocket after a failed push.' },
    cancel_order: { route: (o) => ({ method: 'POST', path: `${orderPath(o)}/cancel-order` }), effect: 'Cancels your parcel (only before you confirmed it and before a label exists), restores stock and — on a prepaid order — raises a refund to the customer.' },
    cancel_shipment: { route: (o) => ({ method: 'POST', path: `${orderPath(o)}/cancel-shipment` }), effect: 'Cancels the courier booking before pickup, restores stock and — on a prepaid order — raises a refund. Use reschedule_pickup if you only need another pickup.' },
    remove_cancelled: { route: (o) => ({ method: 'POST', path: `${orderPath(o)}/hide`, body: { hidden: true } }), effect: 'Removes a cancelled order from your list (admin and the customer still see it).' },
    ndr_reattempt: { route: (o, a) => ({ method: 'POST', path: `${orderPath(o)}/ndr-action`, body: { action: 're-attempt', comments: a.comments || '' } }), effect: 'Asks the courier to attempt delivery again.' },
    ndr_return: { route: (o, a) => ({ method: 'POST', path: `${orderPath(o)}/ndr-action`, body: { action: 'return', comments: a.comments || '' } }), effect: 'Sends the parcel back to you (RTO). Return shipping is usually charged.' },
    ndr_fake_attempt: { route: (o, a) => ({ method: 'POST', path: `${orderPath(o)}/ndr-action`, body: { action: 'fake-attempt', comments: a.comments || '' } }), effect: 'Disputes the courier\'s failed-delivery claim.' },
  };

  const RETURN_ACTIONS = {
    approve: { suffix: 'approve', effect: 'Approves the request and books a reverse pickup from the customer.' },
    decline: { suffix: 'decline', body: (a) => ({ reason: a.reason }), effect: 'Declines the request; the customer sees your reason.' },
    verify_ok: { suffix: 'verify', body: (a) => ({ ok: true, notes: a.notes || '' }), effect: 'Confirms the returned parcel arrived in acceptable condition (unlocks refund / replacement).' },
    verify_failed: { suffix: 'verify', body: (a) => ({ ok: false, notes: a.notes || '' }), effect: 'Records that the returned parcel failed inspection; no refund can be raised until resolved.' },
    raise_refund: { suffix: 'raise-refund', effect: 'Sends the refund for the returned items to the admin refund queue (money goes back to the customer).' },
    ship_replacement: { suffix: 'ship-replacement', effect: 'Ships the replacement for an approved, verified exchange and reserves the units from stock.' },
  };

  async function findOffer(ctx, ref) {
    const data = await ctx.backend.call(ctx.token, { method: 'GET', path: '/seller/offers', query: { status: 'all', limit: 100 } });
    const items = Array.isArray(data?.items) ? data.items : [];
    const needle = String(ref || '').trim().toLowerCase();
    const exact = items.find((o) => idOf(o) === needle || String(o.title || '').toLowerCase() === needle);
    if (exact) return exact;
    const partial = items.filter((o) => String(o.title || '').toLowerCase().includes(needle));
    if (partial.length === 1) return partial[0];
    if (partial.length > 1) throw new ToolError('AMBIGUOUS', `${partial.length} offers match "${ref}": ${partial.slice(0, 5).map((o) => o.title).join('; ')}.`);
    throw new ToolError('NOT_FOUND', `No offer matches "${ref}".`);
  }
  const offerView = (o) => ({
    id: idOf(o), title: o.title, description: untrusted(o.description, 300), discountType: o.discountType, discountValue: o.discountValue,
    maxDiscount: o.maxDiscount ?? null, minCartAmount: o.minCartAmount ?? null, scope: o.scope, productCount: (o.products || []).length,
    startsAt: o.startsAt || null, endsAt: o.endsAt || null, enabled: Boolean(o.enabled), live: o.isLive ?? null,
  });

  async function productIds(ctx, refs) {
    if (!refs) return undefined;
    const all = await myProducts(ctx);
    const local = { ...ctx, backend: { call: async () => ({ items: all }) } };
    const ids = [];
    for (const ref of refs) ids.push(idOf(await findMine(local, ref)));
    return [...new Set(ids)];
  }

  return [
    {
      name: 'order_logistics',
      description: 'Shipping info (read-only). what=attention: counts of orders to ship, pickups failed, delivery issues, returns waiting. what=ndr: failed-delivery (NDR) cases. what=couriers: couriers, rates and ETAs for an order. what=track: live tracking for an order.',
      audience: 'seller', write: false, groups: ['orders', 'returns'], untrustedOutput: true,
      input: { what: z.enum(['attention', 'ndr', 'couriers', 'track']), order: orderArg.optional() },
      run: async ({ what, order }, ctx) => {
        if (what === 'attention') return ctx.backend.call(ctx.token, { method: 'GET', path: '/seller/orders/attention' }).then((d) => ({ counts: d?.counts || {}, total: d?.total ?? 0 }));
        if (what === 'ndr') {
          const d = await ctx.backend.call(ctx.token, { method: 'GET', path: '/seller/orders/ndr' });
          return { total: d?.total ?? 0, cases: (d?.ndr || []).slice(0, 30).map((r) => ({ orderNumber: r.orderNumber, awb: r.awb, courier: r.courier, reason: untrusted(r.reason, 200), attempts: r.attempts, lastAttemptAt: r.lastAttemptAt, customer: r.customer || null })) };
        }
        if (!order) throw new ToolError('INVALID_ARGUMENT', 'Say which order.');
        if (what === 'couriers') {
          const d = await ctx.backend.call(ctx.token, { method: 'GET', path: `${orderPath(order)}/couriers` });
          return { weightKg: d?.weightKg, pickupPincode: d?.pickup, deliveryPincode: d?.delivery, preferredCourierId: d?.preferredCourierId ?? null, couriers: (d?.couriers || []).slice(0, 12).map((c) => ({ courierId: c.id, name: c.name, rate: money(c.rate), codCharges: money(c.codCharges), etd: c.etd, rating: c.rating ?? null, recommended: Boolean(c.recommended) })) };
        }
        const d = await ctx.backend.call(ctx.token, { method: 'GET', path: `${orderPath(order)}/track` });
        if (!d?.ok) return { tracking: null, reason: d?.reason === 'no-awb' ? 'No courier label yet — the order has not been shipped.' : 'Tracking is unavailable from the courier right now.' };
        return { status: d.currentStatus, trackStatus: d.trackStatus, etd: d.etd, courier: d.courier, origin: d.origin, destination: d.destination, events: (d.events || []).slice(0, 8).map((e) => ({ date: e.date, activity: untrusted(e.activity, 160), location: e.location })) };
      },
    },
    {
      name: 'order_action',
      description: 'Act on one of the seller\'s orders: confirm, ship (book courier + label; optional courierId from order_logistics couriers), reschedule_pickup, retry_push, cancel_order, cancel_shipment, remove_cancelled, ndr_reattempt, ndr_return, ndr_fake_attempt (comments optional). Preview + confirmation first.',
      audience: 'seller', write: true, groups: ['orders'],
      input: { order: orderArg, action: z.enum(Object.keys(ORDER_ACTIONS)), courierId: z.number().int().positive().optional(), comments: z.string().trim().max(500).optional(), confirmation: confirmationArg },
      run: async (args, ctx) => {
        const o = await sellerOrder(ctx, args.order);
        const spec = ORDER_ACTIONS[args.action];
        return twoStep(ctx, 'order_action', args, {
          describe: async () => {
            const s = myShipment(o);
            return {
              order: { orderNumber: o.orderNumber, status: o.status, paymentMethod: o.paymentMethod, paymentStatus: o.paymentStatus, items: (o.items || []).map((i) => `${i.name} ×${i.quantity}`), shipment: s ? { status: s.status, awb: s.awbCode || null, courier: s.awbCourier || null } : null },
              action: args.action, effect: spec.effect, ...(args.courierId && { courierId: args.courierId }),
            };
          },
          apply: async () => {
            const result = await ctx.backend.call(ctx.token, spec.route(o.orderNumber, args));
            return { result: { ok: result?.ok ?? result?.success ?? true, message: result?.message || null, awb: result?.awbCode || result?.awb || null, courier: result?.awbCourier || result?.courier || null, pickupDate: result?.pickupDate || null } };
          },
        });
      },
    },
    {
      name: 'list_return_requests',
      description: 'Customer return/exchange requests on the seller\'s orders, newest first, optionally by status (pending = waiting for you).',
      audience: 'seller', write: false, groups: ['returns'], untrustedOutput: true,
      input: { status: z.enum(['pending', 'approved', 'declined', 'completed', 'cancelled']).optional(), limit: z.number().int().min(1).max(50).default(20) },
      run: async ({ status, limit }, ctx) => {
        const d = await ctx.backend.call(ctx.token, { method: 'GET', path: '/seller/return-requests' });
        let rows = Array.isArray(d?.requests) ? d.requests : [];
        if (status) rows = rows.filter((r) => r.status === status);
        return { total: rows.length, requests: rows.slice(0, limit).map((r) => ({ requestId: String(r.reqId), orderNumber: r.orderNumber, customer: r.customer || null, kind: r.kind, status: r.status, reason: untrusted(r.reason, 400), desiredAction: r.desiredAction || null, items: (r.items || []).map((i) => ({ name: i.name, quantity: i.quantity, size: i.size || null, color: i.color || null })), photos: (r.attachments || []).length, requestedAt: r.requestedAt, decision: r.decisionReason ? untrusted(r.decisionReason, 300) : null })) };
      },
    },
    {
      name: 'return_action',
      description: 'Act on a return/exchange request (requestId from list_return_requests): approve, decline (reason ≥5 chars, shown to the customer), verify_ok / verify_failed (after the parcel is back; notes optional), raise_refund (returns), ship_replacement (exchanges). Preview + confirmation first.',
      audience: 'seller', write: true, groups: ['returns'],
      input: { requestId: z.string().regex(/^[a-f0-9]{24}$/), action: z.enum(Object.keys(RETURN_ACTIONS)), reason: z.string().trim().max(500).optional(), notes: z.string().trim().max(500).optional(), confirmation: confirmationArg },
      run: async (args, ctx) => {
        if (args.action === 'decline' && String(args.reason || '').length < 5) throw new ToolError('INVALID_ARGUMENT', 'A decline needs a reason of at least 5 characters for the customer.');
        const d = await ctx.backend.call(ctx.token, { method: 'GET', path: `/seller/return-requests/${args.requestId}` });
        const r = d?.request;
        if (!r) throw new ToolError('NOT_FOUND', 'That return request was not found.');
        const spec = RETURN_ACTIONS[args.action];
        return twoStep(ctx, 'return_action', args, {
          describe: async () => ({ request: { orderNumber: r.orderNumber, kind: r.kind, status: r.status, customer: r.customer || null, items: (r.items || []).map((i) => `${i.name} ×${i.quantity}`), reason: untrusted(r.reason, 300) }, action: args.action, effect: spec.effect, ...(args.reason && { reason: args.reason }) }),
          apply: async () => {
            const res = await ctx.backend.call(ctx.token, { method: 'POST', path: `${orderPath(r.orderNumber)}/return-request/${args.requestId}/${spec.suffix}`, body: spec.body ? spec.body(args) : {} });
            return { result: { ok: res?.ok ?? res?.success ?? true, message: res?.message || null, refundAmount: res?.request?.refundAmount ?? res?.refundAmount ?? null } };
          },
        });
      },
    },
    {
      name: 'payouts_summary',
      description: 'The seller\'s payouts: amount due, paid to date, this week in progress, parcels in transit, and recent weeks with status (in_progress / due / paid), net amount and UTR. Read-only.',
      audience: 'seller', write: false, groups: ['payouts'],
      input: { weeks: z.number().int().min(1).max(26).default(8) },
      run: async ({ weeks }, ctx) => {
        const d = await ctx.backend.call(ctx.token, { method: 'GET', path: '/seller/payouts' });
        const totals = (t) => (t ? { orders: t.orders ?? t.count ?? null, itemTotal: money(t.itemTotal), courierCharge: money(t.courierCharge), gatewayCharge: money(t.gatewayCharge), refunds: money(t.refunds), net: money(t.net) } : null);
        return {
          currency: 'INR', due: money(d?.due), paidLifetime: money(d?.paidLifetime),
          thisWeek: d?.thisWeek ? { weekKey: d.thisWeek.weekKey, totals: totals(d.thisWeek.totals) } : null,
          inTransit: { parcels: (d?.inTransit?.lines || []).length, totals: totals(d?.inTransit?.totals) },
          weeks: (d?.weeks || []).slice(0, weeks).map((w) => ({ weekKey: w.weekKey, status: w.status, parcels: (w.lines || []).length, totals: totals(w.totals), paid: w.settlement ? { amount: money(w.settlement.amountPaid), utr: w.settlement.utr || null, paidAt: w.settlement.paidAt || null } : null })),
        };
      },
    },
    {
      name: 'list_offers',
      description: 'The seller\'s offers/discounts with type, value, scope, dates and whether each is live.',
      audience: 'seller', write: false, groups: ['offers'],
      input: { status: z.enum(['all', 'live', 'scheduled', 'expired', 'disabled']).default('all') },
      run: async ({ status }, ctx) => {
        const d = await ctx.backend.call(ctx.token, { method: 'GET', path: '/seller/offers', query: { status, limit: 50 } });
        return { total: d?.total ?? 0, offers: (d?.items || []).map(offerView) };
      },
    },
    {
      name: 'offer_action',
      description: 'Create, update, pause, resume or delete an offer. create needs title, discountType (percent|flat) and discountValue; scope all (default) or selected with products (SKUs/names). Dates YYYY-MM-DD. offer = id or title for the others. Preview + confirmation first.',
      audience: 'seller', write: true, groups: ['offers'],
      input: {
        action: z.enum(['create', 'update', 'pause', 'resume', 'delete']), offer: z.string().trim().max(120).optional(),
        title: z.string().trim().min(2).max(120).optional(), description: z.string().trim().max(500).optional(),
        discountType: z.enum(['percent', 'flat']).optional(), discountValue: z.number().positive().max(1000000).optional(),
        maxDiscount: z.number().positive().nullable().optional(), minCartAmount: z.number().positive().nullable().optional(),
        scope: z.enum(['all', 'selected']).optional(), products: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
        startsAt: dateArg.nullable().optional(), endsAt: dateArg.nullable().optional(), confirmation: confirmationArg,
      },
      run: async (args, ctx) => {
        const { action } = args;
        if (args.discountType === 'percent' && args.discountValue > 100) throw new ToolError('INVALID_ARGUMENT', 'A percent discount cannot exceed 100.');
        if (args.startsAt && args.endsAt && args.startsAt > args.endsAt) throw new ToolError('INVALID_ARGUMENT', 'The offer must start before it ends.');
        const existing = action === 'create' ? null : await findOffer(ctx, args.offer);
        if (action === 'create' && (!args.title || !args.discountType || !args.discountValue)) throw new ToolError('INVALID_ARGUMENT', 'A new offer needs a title, discountType (percent or flat) and discountValue.');
        const ids = await productIds(ctx, args.products);
        const body = {};
        for (const k of ['title', 'description', 'discountType', 'discountValue', 'maxDiscount', 'minCartAmount', 'scope', 'startsAt', 'endsAt']) if (args[k] !== undefined) body[k] = args[k];
        if (ids) { body.products = ids; body.scope = body.scope || 'selected'; }
        if (action === 'pause') body.enabled = false;
        if (action === 'resume') body.enabled = true;
        if (['update'].includes(action) && !Object.keys(body).length) throw new ToolError('INVALID_ARGUMENT', 'Say what to change on the offer.');
        return twoStep(ctx, 'offer_action', args, {
          describe: async () => ({ action, offer: existing ? offerView(existing) : null, changes: action === 'delete' ? 'Deletes the offer permanently.' : { ...body, ...(ids && { products: `${ids.length} product(s)` }) } }),
          apply: async () => {
            if (action === 'delete') { await ctx.backend.call(ctx.token, { method: 'DELETE', path: `/seller/offers/${idOf(existing)}` }); return { deleted: true }; }
            const d = action === 'create'
              ? await ctx.backend.call(ctx.token, { method: 'POST', path: '/seller/offers', body: { scope: 'all', enabled: true, ...body } })
              : await ctx.backend.call(ctx.token, { method: 'PUT', path: `/seller/offers/${idOf(existing)}`, body });
            return { offer: d?.offer ? offerView(d.offer) : null };
          },
        });
      },
    },
    {
      name: 'list_offline_sales',
      description: 'Sales the seller recorded offline (shop counter, events), newest first, with total revenue and units. Optional IST date range.',
      audience: 'seller', write: false, groups: ['offline'],
      input: { from: dateArg.optional(), to: dateArg.optional(), limit: z.number().int().min(1).max(50).default(20) },
      run: async ({ from, to, limit }, ctx) => {
        const d = await ctx.backend.call(ctx.token, { method: 'GET', path: '/seller/offline-sales', query: { from: from && `${from}T00:00:00+05:30`, to: to && `${to}T23:59:59+05:30`, limit } });
        return { total: d?.total ?? 0, totalRevenue: money(d?.totalRevenue), totalUnits: d?.totalUnits ?? 0, sales: (d?.items || []).map((s) => ({ id: idOf(s), product: s.productName, size: s.variant?.size || null, color: s.variant?.color || null, quantity: s.quantity, unitPrice: money(s.unitPrice), total: money(s.totalAmount), date: s.saleDate, note: untrusted(s.note, 200) })) };
      },
    },
    {
      name: 'offline_sale_action',
      description: 'record an offline sale (product as SKU/name, quantity, size/color for variant products, optional unitPrice override, note, saleDate YYYY-MM-DD) — this reduces stock; or delete one (saleId from list_offline_sales), which puts the stock back. Preview + confirmation first.',
      audience: 'seller', write: true, groups: ['offline'],
      input: { action: z.enum(['record', 'delete']), product: productArg.optional(), quantity: z.number().int().min(1).max(10000).optional(), size: z.string().trim().max(40).optional(), color: z.string().trim().max(60).optional(), unitPrice: z.number().min(0).max(10000000).optional(), note: z.string().trim().max(300).optional(), saleDate: dateArg.optional(), saleId: z.string().regex(/^[a-f0-9]{24}$/).optional(), confirmation: confirmationArg },
      run: async (args, ctx) => {
        if (args.action === 'delete') {
          if (!args.saleId) throw new ToolError('INVALID_ARGUMENT', 'Say which sale (saleId from list_offline_sales).');
          const d = await ctx.backend.call(ctx.token, { method: 'GET', path: '/seller/offline-sales', query: { limit: 100 } });
          const sale = (d?.items || []).find((s) => idOf(s) === args.saleId);
          if (!sale) throw new ToolError('NOT_FOUND', 'That offline sale was not found.');
          return twoStep(ctx, 'offline_sale_action', args, {
            describe: async () => ({ action: 'delete', sale: { product: sale.productName, quantity: sale.quantity, total: money(sale.totalAmount), date: sale.saleDate }, effect: 'Removes the sale and returns its units to stock.' }),
            apply: async () => { await ctx.backend.call(ctx.token, { method: 'DELETE', path: `/seller/offline-sales/${args.saleId}` }); return { deleted: true }; },
          });
        }
        if (!args.product || !args.quantity) throw new ToolError('INVALID_ARGUMENT', 'Say the product and quantity sold.');
        const p = await findMine(ctx, args.product);
        return twoStep(ctx, 'offline_sale_action', args, {
          describe: async () => ({ action: 'record', product: { name: p.name, sku: p.sku || null, stockNow: p.stock ?? null }, quantity: args.quantity, size: args.size || null, color: args.color || null, unitPrice: args.unitPrice ?? p.price, total: money((args.unitPrice ?? p.price) * args.quantity), saleDate: args.saleDate || 'today', effect: 'Records the sale and reduces stock by the quantity.' }),
          apply: async () => {
            const d = await ctx.backend.call(ctx.token, { method: 'POST', path: '/seller/offline-sales', body: { product: idOf(p), quantity: args.quantity, size: args.size, color: args.color, unitPrice: args.unitPrice, note: args.note, saleDate: args.saleDate } });
            const s = d?.sale || {};
            return { sale: { id: idOf(s) || null, total: money(s.totalAmount), quantity: s.quantity ?? args.quantity } };
          },
        });
      },
    },
    {
      name: 'list_media',
      description: 'Files in the seller\'s media library (name, folder, size, date), optional name search. Uploading happens in the Media page.',
      audience: 'seller', write: false, groups: ['media'],
      input: { query: z.string().trim().max(100).optional(), limit: z.number().int().min(1).max(50).default(24) },
      run: async ({ query, limit }, ctx) => {
        const d = await ctx.backend.call(ctx.token, { method: 'GET', path: '/seller/media', query: { q: query, limit } });
        return { total: d?.total ?? 0, folders: d?.folders || [], files: (d?.items || []).map((m) => ({ id: idOf(m), filename: m.filename || null, folder: m.folder || null, sizeKb: m.size ? Math.round(m.size / 1024) : null, uploadedAt: m.createdAt || null })) };
      },
    },
    {
      name: 'delete_media',
      description: 'Delete files from the media library (ids from list_media). Files used by a product are refused and reported. Preview + confirmation first.',
      audience: 'seller', write: true, groups: ['media'],
      input: { ids: z.array(z.string().regex(/^[a-f0-9]{24}$/)).min(1).max(50), confirmation: confirmationArg },
      run: async (args, ctx) => {
        const d = await ctx.backend.call(ctx.token, { method: 'GET', path: '/seller/media', query: { limit: 100 } });
        const files = (d?.items || []).filter((m) => args.ids.includes(idOf(m)));
        if (!files.length) throw new ToolError('NOT_FOUND', 'None of those files are in your media library.');
        return twoStep(ctx, 'delete_media', args, {
          describe: async () => ({ files: files.map((m) => m.filename || idOf(m)), effect: 'Deletes these files permanently; any used by a product are skipped.' }),
          apply: async () => {
            const r = await ctx.backend.call(ctx.token, { method: 'POST', path: '/seller/media/bulk-delete', body: { ids: files.map(idOf) } });
            return { deleted: r?.deleted ?? null, blocked: (r?.blocked || []).map((b) => ({ id: b.id, usedBy: b.productNames || [] })) };
          },
        });
      },
    },
    {
      name: 'brand_category_requests',
      description: 'The seller\'s requests for a new brand or category. action=list (default) shows them with status; create needs type (brand|category) and name (parentCategory id for a sub-category, notes optional); update/delete work on a pending requestId. Writes preview + confirmation first.',
      audience: 'seller', write: true, groups: ['requests'],
      input: { action: z.enum(['list', 'create', 'update', 'delete']).default('list'), requestId: z.string().regex(/^[a-f0-9]{24}$/).optional(), type: z.enum(['brand', 'category']).optional(), name: z.string().trim().min(2).max(120).optional(), parentCategory: z.string().regex(/^[a-f0-9]{24}$/).optional(), notes: z.string().trim().max(500).optional(), confirmation: confirmationArg },
      run: async (args, ctx) => {
        const d = await ctx.backend.call(ctx.token, { method: 'GET', path: '/seller/brand-category-requests' });
        const rows = (d?.items || []).map((r) => ({ id: idOf(r), type: r.type, name: r.name, parentCategory: r.parentCategory?.name || null, status: r.status, notes: untrusted(r.notes, 200), decisionNote: untrusted(r.decisionNote, 200), createdAt: r.createdAt }));
        if (args.action === 'list') return { total: rows.length, requests: rows };
        const target = args.requestId ? rows.find((r) => r.id === args.requestId) : null;
        if (args.action !== 'create' && !target) throw new ToolError('NOT_FOUND', 'That request was not found.');
        if (args.action === 'create' && (!args.type || !args.name)) throw new ToolError('INVALID_ARGUMENT', 'A request needs a type (brand or category) and a name.');
        const body = {};
        for (const k of ['type', 'name', 'parentCategory', 'notes']) if (args[k] !== undefined) body[k] = args[k];
        return twoStep(ctx, 'brand_category_requests', args, {
          describe: async () => ({ action: args.action, request: target, changes: args.action === 'delete' ? 'Withdraws the request.' : body }),
          apply: async () => {
            if (args.action === 'delete') { await ctx.backend.call(ctx.token, { method: 'DELETE', path: `/seller/brand-category-requests/${target.id}` }); return { deleted: true }; }
            const r = args.action === 'create'
              ? await ctx.backend.call(ctx.token, { method: 'POST', path: '/seller/brand-category-requests', body })
              : await ctx.backend.call(ctx.token, { method: 'PATCH', path: `/seller/brand-category-requests/${target.id}`, body });
            return { request: r?.request ? { id: idOf(r.request), type: r.request.type, name: r.request.name, status: r.request.status } : null };
          },
        });
      },
    },
    {
      name: 'get_store_profile',
      description: 'The seller\'s store settings — name, store name, phones, address, return/exchange days, COD on/off and charge, who pays delivery, excluded states/pincodes — plus account and KYC status.',
      audience: 'seller', write: false, groups: ['profile'],
      run: async (_args, ctx) => {
        const [me, kyc] = await Promise.all([
          ctx.backend.call(ctx.token, { method: 'GET', path: '/auth/me' }),
          ctx.backend.call(ctx.token, { method: 'GET', path: '/seller/kyc' }).catch(() => null),
        ]);
        const u = me?.user || {};
        const k = kyc?.kyc || {};
        return {
          profile: { name: u.name, storeName: u.storeName || null, phone: u.phone || null, alternatePhone: u.alternatePhone || null, address: untrusted(u.address, 300), returnPolicyDays: u.returnPolicyDays ?? null, exchangePolicyDays: u.exchangePolicyDays ?? null, codEnabled: u.codEnabled ?? null, codCharge: u.codCharge ?? null, deliveryPaidByCustomer: Boolean(u.deliveryPaidByCustomer), excludedStates: u.excludedStates || [], excludedPincodes: (u.excludedPincodes || []).slice(0, 30), excludedPincodeCount: (u.excludedPincodes || []).length },
          account: { status: kyc?.accountStatus || u.status || null, kycStatus: k.status || 'not_started', kycRejectionReason: untrusted(k.rejectionReason, 300), shiprocketPickupLocation: k.shiprocket?.pickupLocation || null },
          note: 'KYC, bank and payout details and the password are changed only in the dashboard.',
        };
      },
    },
    {
      name: 'update_store_profile',
      description: 'Change store settings: name, storeName, phone, alternatePhone, address, returnPolicyDays, exchangePolicyDays (0-365), codEnabled, codCharge (0-999), deliveryPaidByCustomer, excludedStates, excludedPincodes (2-6 digits; lists replace the current ones). Not KYC, bank or password. Preview + confirmation first.',
      audience: 'seller', write: true, groups: ['profile'],
      input: {
        changes: z.object({
          name: z.string().trim().min(2).max(120).optional(), storeName: z.string().trim().min(2).max(120).optional(),
          phone: z.string().trim().regex(/^[0-9+\- ]{8,16}$/).optional(), alternatePhone: z.string().trim().regex(/^[0-9+\- ]{8,16}$/).optional(),
          address: z.string().trim().max(500).optional(), returnPolicyDays: z.number().int().min(0).max(365).optional(), exchangePolicyDays: z.number().int().min(0).max(365).optional(),
          codEnabled: z.boolean().optional(), codCharge: z.number().int().min(0).max(999).optional(), deliveryPaidByCustomer: z.boolean().optional(),
          excludedStates: z.array(z.string().trim().min(2).max(60)).max(50).optional(), excludedPincodes: z.array(z.string().regex(/^\d{2,6}$/)).max(500).optional(),
        }).strict(),
        confirmation: confirmationArg,
      },
      run: async (args, ctx) => {
        const keys = Object.keys(args.changes || {});
        if (!keys.length) throw new ToolError('INVALID_ARGUMENT', 'Say which setting to change.');
        const me = await ctx.backend.call(ctx.token, { method: 'GET', path: '/auth/me' });
        const u = me?.user || {};
        return twoStep(ctx, 'update_store_profile', args, {
          describe: async () => ({ changes: keys.map((k) => ({ field: k, from: u[k] ?? null, to: args.changes[k] })) }),
          apply: async () => {
            const r = await ctx.backend.call(ctx.token, { method: 'PUT', path: '/auth/profile', body: args.changes });
            const n = r?.user || {};
            return { saved: Object.fromEntries(keys.map((k) => [k, n[k] ?? args.changes[k]])) };
          },
        });
      },
    },
  ];
};
