'use strict';
// Shared ingestion for carrier webhooks and tracking reconciliation. No HTTP or DB side effects.
const { parseShiprocketDate, normLabel, mapLabel, mapShipmentStatus, toCode } = require('./shipment-labels');

/* No state regression (audit A15): couriers deliver webhooks out of order and
 * retry old ones. Terminal states only move between themselves (delivered →
 * rto_initiated is a real event; delivered → shipped is not), and a late
 * pickup/manifest event must not pull a moving parcel back to pushed/awb. */
const TERMINAL = new Set(['delivered', 'returned', 'rto_delivered', 'cancelled', 'lost']);
const REGRESSIVE = new Set(['pushed', 'awb', 'shipped', 'out_for_delivery', 'undelivered']);
const PRE_PICKUP_RANK = { queued: 0, failed: 0, pushed: 1, awb: 2 };
const MOVING = new Set(['shipped', 'out_for_delivery', 'undelivered', 'rto_initiated', 'rto_in_transit']);

function isRegression(current, next) {
  if (!next || current === next) return false;
  if (TERMINAL.has(current) && (REGRESSIVE.has(next) || next === 'failed')) return true;
  if (String(current).startsWith('rto_') && !next.startsWith('rto_')) return true;
  if (next in PRE_PICKUP_RANK && next !== 'failed' && MOVING.has(current)) return true;
  return false;
}

/**
 * Within the pre-pickup stage the carrier's labels are not ordered — an
 * `awb` slice legitimately receives "PICKUP SCHEDULED", "PICKUP EXCEPTION",
 * "PICKUP RESCHEDULED" (all → `pushed`). Those events are ACCEPTED (label,
 * timestamps, scans all update) but must not lower the internal status,
 * because `awb` also means "label exists" and the UI keys off it.
 */
function lowersPrePickupStage(current, next) {
  return next in PRE_PICKUP_RANK && current in PRE_PICKUP_RANK && PRE_PICKUP_RANK[next] < PRE_PICKUP_RANK[current];
}

function applyShipmentEvent(entry, body, receivedAt = new Date()) {
  const awb = String(body.awb || body.awb_code || '').trim();
  const currentLabel = String(body.current_status || '').trim();
  const shipmentLabel = String(body.shipment_status || '').trim();
  const statusName = currentLabel || shipmentLabel;
  const shipmentStatusId = toCode(body.shipment_status_id);
  const scanTimes = (body.scans || []).map((s) => parseShiprocketDate(s.date)).filter(Boolean);
  const providerTime =
    parseShiprocketDate(body.current_timestamp) ||
    (scanTimes.length ? new Date(Math.max(...scanTimes.map((d) => d.getTime()))) : null);
  const eventAt = providerTime || new Date(receivedAt);
  // A reverse shipment that reported an AWB we didn't have yet — persist it
  // so later scans can match by AWB too.
  if (awb && !entry.awbCode) entry.awbCode = awb;
  // The carrier confirms a label exists for this slice, so any earlier
  // "AWB failed: …" left by a seller-portal attempt that raced a panel-side
  // assignment is stale. Pickup/other errors are kept — they may still apply.
  if (entry.awbCode && /^AWB failed:/i.test(String(entry.lastError || ''))) entry.lastError = '';
  if (body.sr_order_id && !entry.shiprocketOrderId) entry.shiprocketOrderId = String(body.sr_order_id);
  if ((body.shipment_id || body.sr_shipment_id) && !entry.shipmentId)
    entry.shipmentId = String(body.shipment_id || body.sr_shipment_id);
  if (body.courier_name && !entry.awbCourier) entry.awbCourier = String(body.courier_name);
  if (body.courier_company_id && !entry.awbCourierId) {
    const cid = Number(body.courier_company_id);
    if (Number.isInteger(cid) && cid > 0) entry.awbCourierId = cid;
  }

  const mapped = mapShipmentStatus({ labels: [currentLabel, shipmentLabel], shipmentStatusId });
  const previousStatus = entry.status;
  const lastAt = parseShiprocketDate(entry.statusEventAt);
  const stale = lastAt && eventAt < lastAt;
  const untimedRegression =
    !providerTime &&
    ((entry.status === 'out_for_delivery' && mapped === 'shipped') ||
      (entry.status === 'undelivered' && ['shipped', 'out_for_delivery'].includes(mapped)));
  const accepted = !stale && !untimedRegression && !isRegression(entry.status, mapped);
  if (accepted) {
    const changed = (statusName && entry.currentStatus !== statusName) || (mapped && entry.status !== mapped);
    if (statusName) entry.currentStatus = statusName;
    if (shipmentStatusId) entry.currentStatusId = shipmentStatusId;
    if (mapped && !lowersPrePickupStage(entry.status, mapped)) entry.status = mapped;
    // A label exists (AWB known) but the carrier label is still pre-pickup
    // ("PICKUP SCHEDULED", "PICKUP EXCEPTION", "NEW"…). Our internal state
    // for "label generated, parcel not yet collected" is `awb` — the same
    // state sellerShipOrder writes — so an AWB assigned from the Shiprocket
    // panel lands in the same place as one assigned from the seller portal.
    if (entry.awbCode && ['queued', 'pushed'].includes(entry.status) && (mapped === 'pushed' || mapped === null)) {
      entry.status = 'awb';
      // Generating a label implies the seller acknowledged the slice (same
      // rule as sellerShipOrder) — this is what lets the order aggregate
      // move off "placed" for a parcel booked from the panel.
      entry.confirmedAt = entry.confirmedAt || eventAt;
    }
    if (providerTime || changed || !entry.statusEventAt) entry.statusEventAt = eventAt;
  }
  entry.trackingSyncedAt = new Date();

  if (body.is_return !== undefined && body.is_return !== null && body.is_return !== '') {
    entry.isReturn = Boolean(Number(body.is_return)) || String(body.is_return).toLowerCase() === 'true';
  }
  const etd = parseShiprocketDate(body.etd);
  if (accepted && etd) entry.etd = etd;
  if (body.pod && !/^not available$/i.test(String(body.pod))) entry.pod = String(body.pod);

  // Pickup-lifecycle timestamps — disambiguate "courier scheduled", "courier
  // queued" and "courier came" so the seller UI shows real milestones.
  const n = normLabel(statusName);
  if (accepted && /^PICKUP (SCHEDULED|RESCHEDULED|GENERATED)$/.test(n)) {
    entry.pickupScheduledAt = parseShiprocketDate(body.pickup_scheduled_date) || eventAt;
  } else if (n === 'OUT FOR PICKUP' && !entry.pickupScheduledAt) {
    entry.pickupScheduledAt = eventAt;
  }
  if (!entry.pickupScheduledAt && body.pickup_scheduled_date) {
    const p = parseShiprocketDate(body.pickup_scheduled_date);
    if (p) entry.pickupScheduledAt = p;
  }

  // Scan log. Shiprocket resends the FULL history on every event and retries,
  // so dedupe on (time, courier code, activity) before appending.
  entry.scans = entry.scans || [];
  const keyOf = (date, status, activity) =>
    `${date ? new Date(date).toISOString().slice(0, 19) : ''}|${status || ''}|${activity || ''}`;
  const seen = new Set(entry.scans.map((s) => keyOf(s.date, s.status, s.activity)));
  const pushScan = (sc) => {
    const date = parseShiprocketDate(sc.date) || eventAt;
    const label = sc['sr-status-label'] && !/^na$/i.test(sc['sr-status-label']) ? sc['sr-status-label'] : '';
    const status = String(sc.status || label || '');
    const activity = String(sc.activity || '');
    const key = keyOf(date, status, activity);
    if (seen.has(key)) return;
    seen.add(key);
    entry.scans.push({
      date,
      status,
      statusId: toCode(sc['sr-status'] ?? sc.status_id ?? sc.statusId),
      activity,
      location: String(sc.location || ''),
    });
  };
  const scans = Array.isArray(body.scans) ? body.scans : [];
  for (const sc of scans) if (sc && typeof sc === 'object') pushScan(sc);
  // No scans array → synthesize one from top-level fields so the timeline
  // still moves — but only when the status actually changed. A snapshot
  // (orders/show polled every 30 min for an unbooked slice) carries no
  // event time of its own, so re-recording the same "NEW" with a fresh
  // timestamp each poll filled the seller's tracker with identical lines
  // (UX audit S3).
  const last = entry.scans[entry.scans.length - 1];
  const unchanged =
    last &&
    String(last.status || '') === String(statusName) &&
    String(last.activity || '') === String(body.activity || statusName);
  if (!scans.length && statusName && !unchanged) {
    pushScan({
      date: eventAt,
      status: statusName,
      'sr-status': shipmentStatusId,
      activity: body.activity || statusName,
      location: body.location || '',
    });
  }
  entry.scans.sort((a, b) => new Date(a.date || 0).getTime() - new Date(b.date || 0).getTime());
  if (entry.scans.length > 200) entry.scans = entry.scans.slice(-200);

  // Picked-up milestone: explicit PICKED UP (42) scan if we have one, else
  // backfill from the first moving status (some couriers skip 42).
  if (!entry.pickedUpAt) {
    const pickScan = entry.scans.find((s) => s.statusId === 42);
    if (pickScan) entry.pickedUpAt = pickScan.date;
    else if (n === 'PICKED UP' || MOVING.has(mapped) || mapped === 'delivered') entry.pickedUpAt = eventAt;
  }

  // NDR bookkeeping (forward delivery attempts only).
  const ndrKey = providerTime?.toISOString() || 'untimed';
  // Webhook and tracking responses may describe the same attempt differently.
  // Count a new timestamped attempt or a transition back into NDR, not a retry.
  if (
    accepted &&
    mapped === 'undelivered' &&
    (previousStatus !== 'undelivered' || (providerTime && entry.lastNdrEventKey !== ndrKey))
  ) {
    entry.lastNdrEventKey = ndrKey;
    entry.ndrCount = (entry.ndrCount || 0) + 1;
    entry.ndrLastReason = body.ndr_reason || statusName || entry.ndrLastReason || '';
  }

  // Slice-level effects of a delivery scan.
  if (accepted && mapped === 'delivered' && entry.status === 'delivered') {
    if ((entry.kind || 'forward') === 'forward') {
      // Per-slice delivery timestamp anchors this seller's return window
      // (audit A12/A19); the order-level date stays an aggregate.
      entry.deliveredAt = entry.deliveredAt || eventAt;
    } else {
      // Reverse leg delivered = parcel back at the seller.
      entry.status = 'returned';
      entry.deliveredAt = entry.deliveredAt || eventAt;
    }
  }

  return { mapped, status: entry.status, accepted, previousStatus };
}

// Persist only tracking fields, never arbitrary customer details or credentials.
function sanitizeShipmentEvent(body = {}) {
  const out = {};
  for (const key of [
    'awb',
    'awb_code',
    'order_id',
    'order_number',
    'sr_order_id',
    'shipment_id',
    'sr_shipment_id',
    'courier_name',
    'current_status',
    'shipment_status',
    'shipment_status_id',
    'current_timestamp',
    'etd',
    'pickup_scheduled_date',
    'ndr_reason',
    'activity',
    'location',
    'is_return',
    'courier_company_id',
    // Proof of delivery (a URL or "Not Available") — needed for disputes.
    'pod',
    'pod_status',
  ]) {
    if (['string', 'number', 'boolean'].includes(typeof body[key])) out[key] = String(body[key]).slice(0, 500);
  }
  out.scans = (Array.isArray(body.scans) ? body.scans : [])
    .slice(-200)
    .filter((s) => s && typeof s === 'object')
    .map((s) => {
      const scan = {};
      for (const key of ['date', 'status', 'activity', 'location', 'sr-status', 'sr-status-label', 'status_id']) {
        if (['string', 'number'].includes(typeof s[key])) scan[key] = String(s[key]).slice(0, 500);
      }
      return scan;
    });
  return out;
}

function trackingToEvent(data, entry) {
  const td = data?.tracking_data;
  if (!td || Number(td.track_status) === 0) throw new Error('Carrier tracking is not available yet');
  const latest = td.shipment_track?.[0] || {};
  if (!latest.current_status && !Number(td.shipment_status)) throw new Error('Carrier response has no shipment status');
  const scans = td.shipment_track_activities || [];
  return sanitizeShipmentEvent({
    awb: entry.awbCode,
    shipment_id: entry.shipmentId,
    current_status: latest.current_status,
    shipment_status_id: td.shipment_status,
    current_timestamp:
      latest.delivered_date && normLabel(latest.current_status) === 'DELIVERED' ? latest.delivered_date : undefined,
    courier_name: latest.courier_name,
    etd: latest.edd || td.etd,
    scans,
  });
}

/**
 * GET /orders/show/{id} → event. Used for slices we pushed to Shiprocket but
 * that have no AWB in our DB yet: when the AWB is assigned (and pickup
 * booked) from the Shiprocket panel instead of the seller portal, no code
 * path of ours ran, and tracking-by-AWB cannot help because we do not know
 * the AWB. The order detail carries the AWB, courier and the order's
 * current status label ("PICKUP SCHEDULED", "PICKUP EXCEPTION", …).
 *
 * Shiprocket has returned `shipments` both as an array and as a single
 * object over time; both shapes are handled.
 */
function orderDetailsToEvent(data, entry) {
  const d = data?.data || data;
  if (!d || typeof d !== 'object') throw new Error('Carrier order detail is empty');
  const rawShipments = d.shipments;
  const shipments = Array.isArray(rawShipments) ? rawShipments : rawShipments ? [rawShipments] : [];
  const sh = shipments.find((x) => x && (x.awb || x.awb_code)) || shipments[0] || {};
  const awb = String(sh.awb || sh.awb_code || d.awb_code || d.awb_data?.awb || '').trim();
  const status = String(d.status || sh.status || '').trim();
  if (!awb && !status) throw new Error('Carrier order detail has neither AWB nor status');
  return sanitizeShipmentEvent({
    awb: awb || undefined,
    sr_order_id: d.id || entry.shiprocketOrderId,
    shipment_id: sh.id || entry.shipmentId,
    current_status: status || undefined,
    // d.status_code is the ORDER status list (35 = PICKUP EXCEPTION), not the
    // shipment_status_id list — never pass it as one. Labels drive mapping.
    courier_name: sh.courier || sh.courier_name || d.courier_name,
    courier_company_id: sh.courier_id || sh.sr_courier_id || sh.courier_company_id,
    // etd_date carries a time ("26-09-2026 20:01:50"); shipments.etd is a bare day.
    etd: d.etd_date || sh.etd || d.etd,
    pickup_scheduled_date: sh.pickup_scheduled_date || d.pickup_scheduled_date,
    pod: sh.pod || undefined,
    // The only event time in an order snapshot is when the AWB was assigned.
    // Using it (rather than "now") means a later, properly timestamped
    // webhook scan always out-ranks this back-fill.
    current_timestamp: sh.awb_assign_date || undefined,
  });
}

module.exports = {
  parseShiprocketDate,
  mapShipmentStatus,
  mapLabel,
  isRegression,
  applyShipmentEvent,
  sanitizeShipmentEvent,
  trackingToEvent,
  orderDetailsToEvent,
};
