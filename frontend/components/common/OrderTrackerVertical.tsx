'use client';

/* eslint-disable @next/next/no-img-element */
/**
 * Vertical order tracker — Flipkart-style.
 *
 * Lays out the full order lifecycle top-to-bottom with:
 *   - A primary section per major phase (Placed → Confirmed → Shipped →
 *     Delivered, optionally Return / Exchange steps after).
 *   - Each section has a coloured dot, a label, its timestamp, and an
 *     optional description line.
 *   - Below each section, an indented list of sub-events drawn from the
 *     courier's scan log — each sub-event renders a small dot, activity text,
 *     and a smaller timestamp + location.
 *
 * Forward leg dots render in the `success` token (#006A28) — the white ✓
 * inside them was 2.5:1 on emerald-500; the token gives 7:1 (UX audit T3).
 * Reverse leg dots render in `purple-600` to distinguish the return phase.
 *
 * The component is pure / stateless — pass it `sections` already computed
 * from the order data. Helper `buildSectionsFromOrder` is provided below.
 */

import React, { useState } from 'react';
import { sliceHasShipped, orderForShipment, shipmentDisplayStatus } from '@/lib/orderStatusDisplay';
import { formatDateTime } from '@/lib/dates';

export type Sub = {
  activity: string;
  date?: string | Date | null;
  location?: string;
};

export type TrackerSection = {
  /** Step label e.g. "Placed", "Shipped", "Return accepted". */
  label: string;
  /** ISO date or Date for the section header. Optional. */
  date?: string | Date | null;
  /** Brief description shown right under the label. */
  description?: string;
  /** Forward or reverse phase — drives color. */
  phase: 'forward' | 'reverse';
  /** True once this step has been reached. */
  done: boolean;
  /** True if this is the "live" current step. */
  current: boolean;
  /** Indented courier-scan events. */
  subEvents?: Sub[];
};

function fmt(d: string | Date | null | undefined): string {
  return formatDateTime(d);
}

function fmtSub(d: string | Date | null | undefined): string {
  return formatDateTime(d);
}


/**
 * Courier scans under a milestone. Shows the LAST three by default — the
 * recent ones are what anyone checking a parcel wants — with the earlier
 * ones a click away. A shipment easily accumulates 10–15 scans, and
 * listing them all buried the milestones themselves (UX audit S3).
 */
const SUB_EVENT_LIMIT = 3;
function SubEvents({ events }: { events: Sub[] }) {
  const [showAll, setShowAll] = useState(false);
  const hidden = showAll ? 0 : Math.max(0, events.length - SUB_EVENT_LIMIT);
  const visible = hidden ? events.slice(hidden) : events;
  return (
    <ul className="mt-3 ml-1 space-y-2.5">
      {hidden > 0 && (
        <li className="pl-4">
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="text-[12px] font-semibold text-brand-black hover:underline"
          >
            Show {hidden} earlier update{hidden === 1 ? '' : 's'}
          </button>
        </li>
      )}
      {visible.map((ev, j) => (
        <li key={`${ev.activity}-${j}`} className="relative pl-4 text-[12px] text-foreground leading-snug">
          <span
            aria-hidden
            className="absolute left-0 top-[6px] w-[6px] h-[6px] rounded-full bg-default-400"
          />
          <div>{ev.activity}</div>
          {(ev.date || ev.location) && (
            <div className="text-xs text-muted mt-0.5">
              {[fmtSub(ev.date), ev.location].filter(Boolean).join(' · ')}
            </div>
          )}
        </li>
      ))}
      {showAll && events.length > SUB_EVENT_LIMIT && (
        <li className="pl-4">
          <button type="button" onClick={() => setShowAll(false)} className="text-[12px] font-semibold text-brand-black hover:underline">
            Show fewer
          </button>
        </li>
      )}
    </ul>
  );
}

export default function OrderTrackerVertical({
  sections,
  title = 'Order tracking',
  className = '',
  neutral = false,
}: {
  sections: TrackerSection[];
  title?: string;
  className?: string;
  neutral?: boolean;
}) {
  /* Every milestone is always visible (UX audit S3). The old collapsed
     mode kept only "Placed" and the current step, so "Confirmed" and
     "Shipped" vanished from a delivered order and the tracker looked
     broken. Four or five rows is not a long list; what WAS long is the
     courier scan log, and that is what SubEvents trims. */
  const visibleSections = sections;

  return (
    <div className={`rounded-xl border border-border bg-surface p-4 ${className}`}>
      <div className="text-sm font-semibold text-foreground mb-4">
        {title}
      </div>
      <div className="relative">
        {visibleSections.map((sec, i) => {
          const isLast = i === visibleSections.length - 1;
          const dotColor = neutral && sec.done ? 'bg-[#39434c] border-[#39434c]' : sec.done
            ? sec.phase === 'reverse'
              ? 'bg-purple-600 border-purple-600'
              : 'bg-success border-success'
            : 'bg-white border-default-300';
          // Reference visibleSections (not the original sections array)
          // so the connector line color stays consistent with what's on
          // screen when the tracker is in collapsed mode.
          const lineColor = neutral ? 'bg-default-200' : sec.done && i + 1 < visibleSections.length && visibleSections[i + 1].done
            ? sec.phase === 'reverse' || visibleSections[i + 1].phase === 'reverse'
              ? 'bg-purple-600'
              : 'bg-success'
            : 'bg-default-200';
          const labelColor = neutral ? 'text-[#39434c]' : sec.done
            ? sec.phase === 'reverse'
              ? 'text-purple-700'
              : 'text-brand-black'
            : 'text-muted'; // pending = colour token (5:1), never opacity (UX audit T3)

          return (
            <div key={`${sec.phase}-${i}-${sec.label}`} className="relative pl-7 pb-4 last:pb-0">
              {/* Vertical connector — runs from this dot to the next */}
              {!isLast && (
                <span
                  aria-hidden
                  className={`absolute left-[10px] top-[14px] bottom-0 w-[2px] ${lineColor}`}
                />
              )}
              {/* Major dot */}
              <span
                aria-hidden
                className={`absolute left-0 top-1 w-[22px] h-[22px] rounded-full border-2 ${dotColor} ${
                  sec.current
                    ? neutral ? 'ring-4 ring-default-200' : sec.phase === 'reverse'
                      ? 'ring-4 ring-purple-600/15'
                      : 'ring-4 ring-success/15'
                    : ''
                } grid place-items-center text-white text-xs font-bold`}
              >
                {sec.done && !sec.current ? '✓' : ''}
              </span>

              {/* Header row */}
              <div className="flex flex-wrap items-baseline gap-2">
                <span className={`text-sm font-bold ${labelColor}`}>{sec.label}</span>
                {sec.date && (
                  <span className="text-xs text-muted">{fmt(sec.date)}</span>
                )}
              </div>

              {/* Description */}
              {sec.description && (
                <div className="text-[12px] text-foreground mt-1 leading-relaxed">
                  {sec.description}
                </div>
              )}
              {/* (The date is already in the header row — it used to be
                  printed a second time under the description.) */}

              {/* Sub-events (indented courier scans), last three by default */}
              {sec.subEvents && sec.subEvents.length > 0 && <SubEvents events={sec.subEvents} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Section builder — converts our Order shape into the TrackerSection[] array. */
/* ────────────────────────────────────────────────────────────────────────── */

type OrderLike = {
  status: 'placed' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
  createdAt?: string | Date;
  confirmedAt?: string | Date | null;
  shippedAt?: string | Date | null;
  deliveredAt?: string | Date | null;
  cancelledAt?: string | Date | null;
  sellerShipments?: any[];
  returnRequests?: any[];
};

/**
 * Build tracker sections from a customer/seller order object.
 *
 * `forwardShipment` is the sellerShipments entry for this seller's slice (or
 * the first one for customer view). `returnRequest` + `returnShipment` are
 * the most recent approved/completed request and its linked reverse-pickup
 * entry (or null if none).
 */
export function buildSectionsFromOrder({
  order,
  forwardShipment,
  returnRequest,
  returnShipment,
  replacementShipment,
  perspective = 'customer',
}: {
  order: OrderLike;
  forwardShipment?: any;
  returnRequest?: any;
  returnShipment?: any;
  /** The replacement shipment entry (kind='forward', linked via returnRequest.replacementShipmentEntryId). Used to drive the exchange progress. */
  replacementShipment?: any;
  /** Audience for the descriptive copy. Customer-facing language ("Your
   *  order has been placed") on storefront, seller-facing ("Customer placed
   *  the order") on the seller dashboard. Both share the same dot/step
   *  geometry — only the labels-under-the-dot and description text change. */
  perspective?: 'customer' | 'seller';
}): TrackerSection[] {
  const isSeller = perspective === 'seller';
  order = orderForShipment(order, forwardShipment);
  const idxOf = ['placed', 'confirmed', 'shipped', 'delivered'].indexOf(order.status);
  const isCancelled = order.status === 'cancelled';

  // Helper: which scans belong to which forward leg phase
  const scans = forwardShipment?.scans || [];
  const scanFor = (re: RegExp): Sub[] =>
    scans
      .filter((s: any) => re.test(s.activity || s.status || ''))
      .map((s: any) => ({
        activity: s.activity || s.status,
        date: s.date,
        location: s.location,
      }));

  // Major forward sections
  const sections: TrackerSection[] = [];

  sections.push({
    label: 'Placed',
    date: order.createdAt,
    phase: 'forward',
    done: !isCancelled,
    current: idxOf === 0 && !isCancelled,
    description: isSeller ? 'Customer placed the order.' : 'Your order has been placed.',
  });

  sections.push({
    label: 'Confirmed',
    date: order.confirmedAt,
    phase: 'forward',
    done: !isCancelled && idxOf >= 1,
    current: idxOf === 1,
    /* Pending steps are described as pending — "You confirmed the order"
       under an empty dot read as done (UX audit S3). */
    description: !isCancelled && idxOf >= 1
      ? (isSeller ? 'You confirmed the order.' : 'Seller accepted your order.')
      : (isSeller ? 'Waiting for you to confirm.' : 'Waiting for the seller to confirm.'),
  });

  /* ── "Pickup scheduled" — the stage between confirming and shipping ──
   * Generating a label and booking a courier is NOT the same as the
   * parcel being on its way, but the tracker had no step for it: the
   * order jumped straight to "Shipped" the moment an AWB existed, while
   * the carrier's own dashboard still (correctly) read "PICKUP
   * SCHEDULED" and the parcel sat with the seller.
   *
   * Driven by the shipment, not by `order.status`: an AWB means the
   * label exists, and `pickedUpAt` (courier scan) is what actually ends
   * this stage. */
  const pickedUpAt = forwardShipment?.pickedUpAt || null;
  const hasAwb = !!forwardShipment?.awbCode;
  /* The SHIPMENT is the source of truth for dispatch, not `order.status`.
   * The order-level field is a derived cache, and orders created under
   * the old behaviour still carry `shipped` from the moment their label
   * was generated — reading it would keep showing a parcel as dispatched
   * while the carrier says PICKUP SCHEDULED. When there's no shipment to
   * consult (a parcel marked shipped by hand), fall back to the
   * aggregate. Rule shared with every other order view via
   * lib/orderStatusDisplay. */
  const trulyShipped = !isCancelled && (
    hasAwb ? (!!pickedUpAt || sliceHasShipped(forwardShipment)) : idxOf >= 2
  );
  /* Customers never see the courier-booking stage: booking a pickup, a
   * failed pickup attempt or a rebooking are the seller's business. For
   * them the timeline is Placed → Confirmed → Shipped → Delivered, and the
   * carrier's own labels appear only once the parcel has actually left. */
  if (isSeller && (hasAwb || pickedUpAt)) {
    sections.push({
      label: trulyShipped ? 'Pickup scheduled' : shipmentDisplayStatus(forwardShipment),
      date: forwardShipment?.pickupBookedAt || forwardShipment?.pickupScheduledAt || null,
      phase: 'forward',
      done: !isCancelled && hasAwb,
      current: !isCancelled && hasAwb && !trulyShipped,
      description: forwardShipment?.pickupError
        ? (isSeller
            ? `Label ready, but the courier booking failed: ${forwardShipment.pickupError}`
            : 'Preparing your parcel for dispatch.')
        : (isSeller
            ? 'Label generated and courier booked — hand the parcel over at pickup.'
            : 'The seller has booked a courier pickup.'),
    });
  }

  /* Scans the customer may see: everything from the courier's pickup scan
   * onward. Manifest / pickup-scheduled / pickup-exception scans precede
   * that moment and stay seller-only. Before pickup, the customer sees no
   * scans at all. */
  const pickedUpMs = pickedUpAt ? new Date(pickedUpAt).getTime() : NaN;
  const customerVisible = (sc: any): boolean => {
    if (isSeller) return true;
    if (!Number.isFinite(pickedUpMs)) return false;
    const t = sc?.date ? new Date(sc.date).getTime() : NaN;
    return Number.isFinite(t) ? t >= pickedUpMs : false;
  };

  sections.push({
    label: trulyShipped && idxOf < 3 && forwardShipment ? shipmentDisplayStatus(forwardShipment) : 'Shipped',
    /* The courier's own pickup scan is the truthful "shipped" moment;
     * `order.shippedAt` is a fallback for orders marked shipped
     * manually. Suppressed until the step is actually done — orders
     * written under the old flow carry a `shippedAt` from label
     * generation, and showing it on a pending step read as dispatched. */
    date: trulyShipped ? (pickedUpAt || order.shippedAt) : null,
    phase: 'forward',
    done: trulyShipped,
    current: trulyShipped && idxOf < 3,
    // The courier + AWB line is shown to the customer only once the parcel
    // has shipped; before that it would leak the booking stage.
    description: forwardShipment?.awbCode && (isSeller || trulyShipped)
      ? `${forwardShipment.awbCourier || 'Courier'} · Tracking no. ${forwardShipment.awbCode}`
      : trulyShipped
        ? 'Parcel handed to the courier.'
        : (isSeller ? 'Not shipped yet.' : 'The seller is preparing your parcel.'),
    // Group every Shiprocket scan that isn't the final delivery scan under
    // "Shipped". Before a label exists the only "scans" are order-status
    // snapshots ("NEW"), which are not courier events — hide them.
    subEvents: (hasAwb || trulyShipped ? scans : [])
      .filter(customerVisible)
      .filter((s: any) => !(s.statusId === 7 || /^delivered$/i.test(s.activity || s.status || '')))
      .map((s: any) => ({
        activity: s.activity || s.status,
        date: s.date,
        location: s.location,
      })),
  });

  const deliveryScan = scans.find((s: any) => (s.statusId === 7 || /^delivered$/i.test(s.activity || s.status || '')));
  sections.push({
    label: 'Delivered',
    date: order.deliveredAt || deliveryScan?.date,
    phase: 'forward',
    done: !isCancelled && idxOf >= 3,
    // "Delivered" stops being current once a reverse leg is in flight.
    current: idxOf === 3 && !returnRequest,
    description: order.deliveredAt
      ? (isSeller ? 'Parcel delivered to customer.' : 'Parcel delivered to your address.')
      : trulyShipped
        ? 'On its way — this updates when the courier delivers.'
        : 'Not delivered yet.',
  });

  // Reverse leg — only if there's an approved request.
  if (returnRequest && ['approved', 'completed'].includes(returnRequest.status)) {
    const isExchange = returnRequest.kind === 'exchange';
    const isCancellation = returnRequest.kind === 'cancellation';
    const retScans: any[] = returnShipment?.scans || [];

    // Inspection state from the return shipment (seller marks verifiedAt)
    const verifiedAt = returnShipment?.verifiedAt;
    const verifiedOk = returnShipment?.verifiedOk !== false; // default true unless explicitly rejected

    // Picked-up / in-transit / received from courier scans + shipment status
    const pickedUpScan = retScans.find((x) => /picked.?up/i.test(x.activity || x.status || ''));
    const transitScan = retScans.find((x) => /transit|on its way/i.test(x.activity || x.status || ''));
    const s = returnShipment?.status;
    const receivedDate = ['delivered', 'returned'].includes(s)
      ? returnShipment?.deliveredAt || returnShipment?.statusEventAt
      : null;

    /* ── Cancellation ────────────────────────────────────────────────
     * A cancellation is NOT a customer return, and narrating it as one
     * ("You approved the customer's return") describes something that
     * never happened. The parcel only travels if a label had already been
     * generated — then the courier sends it back as an RTO — so the
     * middle of the flow is conditional on that, unlike a return where a
     * reverse pickup always happens. */
    if (isCancellation) {
      const bySeller = returnRequest.cancellationScope === 'seller';
      sections.push({
        label: 'Cancelled',
        date: returnRequest.decisionAt,
        phase: 'reverse',
        done: true,
        current: returnRequest.refundStatus === 'not-requested',
        description: bySeller
          ? (isSeller ? 'You cancelled this order. Stock has been returned to your inventory.' : 'The seller cancelled this order.')
          : (isSeller ? 'The customer cancelled this order. Stock has been returned to your inventory.' : 'You cancelled this order.'),
      });
      if (forwardShipment?.awbCode) {
        const backHome = ['returned', 'rto_delivered'].includes(forwardShipment?.status);
        sections.push({
          label: 'Parcel coming back',
          date: backHome ? (forwardShipment?.deliveredAt || forwardShipment?.statusEventAt) : null,
          phase: 'reverse',
          done: backHome,
          current: !backHome,
          description: backHome
            ? (isSeller ? 'The courier returned the parcel to your pickup address.' : 'The parcel went back to the seller.')
            : (isSeller
                ? 'A label was already generated, so the courier sends this parcel back to you. No action needed until it arrives.'
                : 'The parcel is going back to the seller. Nothing for you to do.'),
        });
      }
      sections.push({
        label: 'Refund requested',
        date: returnRequest.refundRequestedAt,
        phase: 'reverse',
        done: ['requested', 'processing', 'completed'].includes(returnRequest.refundStatus),
        current: ['requested', 'processing'].includes(returnRequest.refundStatus),
        description: returnRequest.refundStatus === 'processing'
          ? (isSeller ? 'Admin is processing the refund.' : 'Refund is being processed by the THROTTLEIN team.')
          : returnRequest.refundStatus === 'requested'
            ? (isSeller ? 'You raised the refund with admin.' : 'A refund request is with the THROTTLEIN team.')
            : (isSeller ? 'No refund has been raised for this cancellation.' : 'No refund has been raised yet.'),
      });
      sections.push({
        label: 'Refunded',
        date: returnRequest.refundCompletedAt,
        phase: 'reverse',
        done: returnRequest.refundStatus === 'completed',
        current: returnRequest.refundStatus === 'completed',
        description: returnRequest.refundStatus === 'completed'
          ? (isSeller
              ? `Admin issued ₹${returnRequest.refundAmount} to the customer.`
              : `Refund of ₹${returnRequest.refundAmount} issued to your original payment method.`)
          : (isSeller ? 'Will mark complete once admin processes the transfer.' : 'Refund will arrive once processed.'),
      });
    } else if (isExchange) {
      // ── Exchange flow (simplified to 3 steps customer cares about) ──
      //   1. Exchange accepted   — seller approved
      //   2. Exchange on the way — replacement dispatched
      //   3. Exchange completed  — replacement delivered (doorstep swap done)
      // Behind the scenes the old item still flows back to the seller and
      // gets inspected, but that's seller-side bookkeeping — the customer's
      // journey ends the moment they have the new parcel.
      const replScans: any[] = replacementShipment?.scans || [];
      const replDeliveredScan = replScans.find((x) => (x.statusId === 7 || /^delivered$/i.test(x.activity || x.status || '')));
      const replDelivered =
        replacementShipment?.status === 'delivered';

      sections.push({
        label: 'Exchange accepted',
        date: returnRequest.decisionAt,
        phase: 'reverse',
        done: true,
        current: !replacementShipment,
        description: isSeller
          ? 'You approved the exchange. Dispatch the replacement to schedule the swap.'
          : 'Seller approved your exchange. A doorstep swap is being scheduled.',
      });
      sections.push({
        label: 'Exchange on the way',
        date: replacementShipment?.pushedAt,
        phase: 'reverse',
        done: !!replacementShipment,
        current: !!replacementShipment && !replDelivered,
        description: replacementShipment?.awbCode
          ? (isSeller
              ? `Replacement dispatched · Tracking no. ${replacementShipment.awbCode}.`
              : `Replacement dispatched · Tracking no. ${replacementShipment.awbCode}. Have the old item ready for the swap.`)
          : (isSeller
              ? 'Replacement is on its way to the customer.'
              : 'Replacement is on its way to you. Have the old item ready for the swap.'),
      });
      sections.push({
        label: 'Exchange completed',
        date: replDeliveredScan?.date || (replDelivered ? replacementShipment?.updatedAt : null),
        phase: 'reverse',
        done: replDelivered,
        current: replDelivered,
        description: replDelivered
          ? (isSeller
              ? 'Replacement delivered to customer. Verify the old item when it arrives at your pickup.'
              : 'Replacement delivered and the old item was picked up. Enjoy!')
          : (isSeller
              ? 'Will mark complete when the replacement reaches the customer.'
              : 'Will mark complete when the replacement reaches you.'),
      });
    } else {
      // ── Return flow ─────────────────────────────────────────────────
      // Steps: Return accepted → Picked up → In transit → Received →
      //        Verified → Refund requested → Refunded
      sections.push({
        label: 'Return accepted',
        date: returnRequest.decisionAt,
        phase: 'reverse',
        done: true,
        current: !pickedUpScan,
        description: isSeller
          ? 'You approved the customer\'s return. Reverse pickup being scheduled.'
          : 'Seller approved your return. A reverse pickup is being scheduled.',
      });
      sections.push({
        label: 'Picked up',
        date: pickedUpScan?.date,
        phase: 'reverse',
        done: !!pickedUpScan,
        current: !!pickedUpScan && !transitScan,
        description: isSeller
          ? 'Courier picked the parcel up from the customer.'
          : 'Courier picked the parcel up from your address.',
      });
      sections.push({
        label: 'In transit back',
        date: transitScan?.date,
        phase: 'reverse',
        done: !!transitScan,
        current: !!transitScan && !receivedDate,
        description: isSeller
          ? 'Parcel is on its way back to your pickup address.'
          : 'Parcel is on its way back to the seller.',
        subEvents: retScans
          .filter((x) => /transit|out for delivery|on its way|arrived/i.test(x.activity || x.status || ''))
          .map((x) => ({ activity: x.activity || x.status, date: x.date, location: x.location })),
      });
      sections.push({
        label: 'Received',
        date: receivedDate,
        phase: 'reverse',
        done: !!receivedDate,
        current: !!receivedDate && !verifiedAt,
        description: isSeller
          ? 'Parcel arrived at your pickup. Inspect and mark verified.'
          : 'Seller has received the parcel.',
      });
      sections.push({
        label: verifiedOk ? 'Verified' : 'Verification failed',
        date: verifiedAt,
        phase: 'reverse',
        done: !!verifiedAt,
        current: !!verifiedAt && returnRequest.refundStatus === 'not-requested',
        description: verifiedOk
          ? (isSeller
              ? 'You confirmed the item is in returnable condition.'
              : 'Seller inspected the returned item — all good.')
          : (isSeller
              ? `You flagged the parcel.${returnShipment?.verificationNotes ? ` Note: ${returnShipment.verificationNotes}` : ''}`
              : `Seller flagged a problem.${returnShipment?.verificationNotes ? ` Note: ${returnShipment.verificationNotes}` : ''}`),
      });
      sections.push({
        label: 'Refund requested',
        date: returnRequest.refundRequestedAt,
        phase: 'reverse',
        done: ['requested', 'processing', 'completed'].includes(returnRequest.refundStatus),
        current: ['requested', 'processing'].includes(returnRequest.refundStatus),
        description: returnRequest.refundStatus === 'processing'
          ? (isSeller ? 'Admin is processing the refund.' : 'Refund is being processed by the THROTTLEIN team.')
          : returnRequest.refundStatus === 'requested'
            ? (isSeller ? 'You raised the refund with admin.' : 'Seller raised a refund request with THROTTLEIN.')
            : (isSeller ? 'Mark verified above to unlock the refund step.' : 'Refund pending — seller will raise the request shortly.'),
      });
      sections.push({
        label: 'Refunded',
        date: returnRequest.refundCompletedAt,
        phase: 'reverse',
        done: returnRequest.refundStatus === 'completed',
        current: returnRequest.refundStatus === 'completed',
        description: returnRequest.refundStatus === 'completed'
          ? returnRequest.refundMethod === 'razorpay'
            ? (isSeller
                ? `Admin issued ₹${returnRequest.refundAmount} to the customer via Razorpay.`
                : `Refund of ₹${returnRequest.refundAmount} issued to your original payment method.`)
            : (isSeller
                ? `Admin transferred ₹${returnRequest.refundAmount} to the customer. Reference: ${returnRequest.refundReference || '—'}.`
                : `Refund of ₹${returnRequest.refundAmount} transferred. Reference: ${returnRequest.refundReference || 'check your account'}.`)
          : (isSeller ? 'Will mark complete once admin processes the transfer.' : 'Refund will arrive in your account once processed.'),
      });
    }
  }

  if (isSeller && isCancelled) {
    // Cancellation ends the forward workflow; do not prompt sellers to
    // confirm or dispatch an order that can no longer be fulfilled.
    const history = sections.filter(section => section.phase === 'reverse' || section.label === 'Placed' || !!section.date);
    for (const section of history) {
      if (section.phase !== 'forward') continue;
      section.done = true;
      section.current = false;
      if (section.label === 'Confirmed') section.description = 'You confirmed the order before cancellation.';
      else if (section.label !== 'Placed') section.description = 'Recorded before cancellation.';
    }
    if (!history.some(section => section.label === 'Cancelled')) {
      history.push({ label:'Cancelled', date:order.cancelledAt, phase:'reverse', done:true, current:true, description:'This order was cancelled.' });
    }
    return history;
  }
  return sections;
}

