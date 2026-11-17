'use client';

/**
 * Vertical order tracker — admin variant.
 *
 * Mirrors the customer / seller tracker visually but uses neutral
 * third-person copy ("Customer placed the order", "Seller confirmed the
 * order") so admins reading the audit log get an unbiased view of where the
 * order sits in its lifecycle.
 *
 * Pure / stateless — pass already-computed `sections`. The helper
 * `buildSectionsForAdmin` below converts an Order doc + the relevant
 * shipment / return-request entries into the section array.
 */

import React, { useState } from 'react';
import { sliceHasShipped, orderForShipment, shipmentDisplayStatus } from '@/lib/orderStatusDisplay';
import { formatDateTime } from '@/lib/dates';
import styles from './OrderTrackerVertical.module.css';

export type Sub = {
  activity: string;
  date?: string | Date | null;
  location?: string;
};

export type TrackerSection = {
  label: string;
  date?: string | Date | null;
  description?: string;
  phase: 'forward' | 'reverse';
  done: boolean;
  current: boolean;
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
    <div className={styles.subs}>
      {hidden > 0 && (
        <button type="button" className={styles.more} onClick={() => setShowAll(true)}>
          Show {hidden} earlier update{hidden === 1 ? '' : 's'}
        </button>
      )}
      {visible.map((ev, j) => (
        <div key={`${ev.activity}-${j}`} className={styles.sub}>
          {ev.activity}
          {(ev.date || ev.location) && <small>{[fmtSub(ev.date), ev.location].filter(Boolean).join(' · ')}</small>}
        </div>
      ))}
      {showAll && events.length > SUB_EVENT_LIMIT && (
        <button type="button" className={styles.more} onClick={() => setShowAll(false)}>Show fewer</button>
      )}
    </div>
  );
}

/** Heading shown where the timeline moves from the delivery to the return/refund leg. */
function phaseLabel(firstReverse: TrackerSection): string {
  if (/^exchange/i.test(firstReverse.label)) return 'Exchange';
  if (/^refund/i.test(firstReverse.label)) return 'Refund';
  return 'Return';
}

/** A step that reports something going wrong (failed booking, failed refund). */
const isProblem = (sec: TrackerSection) => /failed|error/i.test(sec.label) || /booking failed|didn.t go through/i.test(sec.description || '');

export default function OrderTrackerVertical({
  sections,
  title = 'Order tracking',
}: {
  sections: TrackerSection[];
  title?: string;
}) {
  return (
    <div className={styles.tracker}>
      <div className={styles.title}>{title}</div>
      <ol className={styles.list}>
        {sections.map((sec, i) => {
          const isLast = i === sections.length - 1;
          const next = sections[i + 1];
          const startsReverse = sec.phase === 'reverse' && sections[i - 1]?.phase !== 'reverse';
          const problem = sec.done && isProblem(sec);
          const dot = problem ? styles.dotProblem : sec.current ? styles.dotCurrent : sec.done ? styles.dotDone : '';
          return (
            <li key={`${sec.phase}-${i}-${sec.label}`}>
              {startsReverse && (
                <p className={styles.phase}>
                  <span aria-hidden className={`${styles.phaseLine} ${sections[i - 1]?.done && sec.done ? styles.lineDone : ''}`} />
                  {phaseLabel(sec)}
                </p>
              )}
              <div className={`${styles.step} ${sec.done ? '' : styles.pending}`} aria-current={sec.current ? 'step' : undefined}>
                {!isLast && <span aria-hidden className={`${styles.line} ${sec.done && next?.done ? styles.lineDone : ''}`} />}
                <span aria-hidden className={`${styles.dot} ${dot}`} />
                <div className={styles.head}>
                  <span className={`${styles.label} ${problem ? styles.problemLabel : ''}`}>{sec.label}</span>
                  {sec.date && <span className={styles.date}>{fmt(sec.date)}</span>}
                  <span className="sr-only">{sec.done ? '(done)' : '(not yet)'}</span>
                </div>
                {sec.description && <div className={styles.description}>{sec.description}</div>}
                {sec.subEvents && sec.subEvents.length > 0 && <SubEvents events={sec.subEvents} />}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Section builder — admin perspective.                                       */
/* ────────────────────────────────────────────────────────────────────────── */

type OrderLike = {
  status: 'placed' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';
  createdAt?: string | Date;
  confirmedAt?: string | Date | null;
  shippedAt?: string | Date | null;
  deliveredAt?: string | Date | null;
  cancelledAt?: string | Date | null;
};

export function buildSectionsForAdmin({
  order,
  forwardShipment,
  returnRequest,
  returnShipment,
  replacementShipment,
  sellerName,
}: {
  order: OrderLike;
  forwardShipment?: any;
  returnRequest?: any;
  returnShipment?: any;
  replacementShipment?: any;
  sellerName?: string;
}): TrackerSection[] {
  order = orderForShipment(order, forwardShipment);
  const idxOf = ['placed', 'confirmed', 'shipped', 'delivered'].indexOf(order.status);
  const isCancelled = order.status === 'cancelled';
  const seller = sellerName || 'Seller';

  const scans = forwardShipment?.scans || [];

  const sections: TrackerSection[] = [];

  // Placing happened even if the order was later cancelled.
  sections.push({
    label: 'Placed',
    date: order.createdAt,
    phase: 'forward',
    done: true,
    current: idxOf === 0 && !isCancelled,
    description: 'Customer placed the order.',
  });

  /* A cancelled order shows only what actually happened before the
     cancellation — not the steps it will now never reach. */
  const confirmedBeforeCancel = isCancelled && !!order.confirmedAt;
  if (!isCancelled || confirmedBeforeCancel) {
    sections.push({
      label: 'Confirmed',
      date: order.confirmedAt,
      phase: 'forward',
      done: confirmedBeforeCancel || idxOf >= 1,
      current: idxOf === 1,
      description: confirmedBeforeCancel || idxOf >= 1 ? `${seller} accepted the order.` : `Waiting for ${seller} to confirm.`,
    });
  }

  /* "Pickup scheduled" — the stage between confirming and shipping.
   * Generating a label and booking a courier is NOT dispatch, but this
   * tracker had no step for it and jumped straight to "Shipped" the
   * moment an AWB existed, while the carrier still read PICKUP
   * SCHEDULED. Driven by the SHIPMENT (an AWB, and the courier's
   * `pickedUpAt` scan) rather than the cached order status, so orders
   * written under the old behaviour display correctly too. */
  const pickedUpAt = forwardShipment?.pickedUpAt || null;
  const hasAwb = !!forwardShipment?.awbCode;
  const trulyShipped = !isCancelled && (
    hasAwb ? (!!pickedUpAt || sliceHasShipped(forwardShipment)) : idxOf >= 2
  );
  if ((hasAwb || pickedUpAt) && !(isCancelled && !pickedUpAt)) {
    sections.push({
      label: trulyShipped ? 'Pickup scheduled' : shipmentDisplayStatus(forwardShipment),
      date: forwardShipment?.pickupBookedAt || forwardShipment?.pickupScheduledAt || null,
      phase: 'forward',
      done: !isCancelled && hasAwb,
      current: !isCancelled && hasAwb && !trulyShipped,
      description: forwardShipment?.pickupError
        ? `Label ready, but the courier booking failed: ${forwardShipment.pickupError}`
        : `${seller} generated the label and booked a courier pickup.`,
    });
  }

  // Shipped / Delivered only for live orders, or if the parcel had moved before a cancellation.
  const showTransitSteps = !isCancelled || !!pickedUpAt;
  if (showTransitSteps) sections.push({
    label: trulyShipped && idxOf < 3 && forwardShipment ? shipmentDisplayStatus(forwardShipment) : 'Shipped',
    /* The courier's pickup scan is the truthful dispatch moment;
     * `order.shippedAt` is a fallback for manually-marked orders.
     * Suppressed entirely until the step is actually done — orders
     * written under the old flow carry a `shippedAt` from label
     * generation, and printing it on a pending step made the parcel
     * look dispatched even with the dot greyed out. */
    date: trulyShipped ? (pickedUpAt || order.shippedAt) : null,
    phase: 'forward',
    done: trulyShipped,
    current: trulyShipped && idxOf < 3,
    description: forwardShipment?.awbCode
      ? `${forwardShipment.awbCourier || 'Courier'} · Tracking no. ${forwardShipment.awbCode}`
      : trulyShipped ? 'Parcel handed to the courier.' : 'Not shipped yet.',
    // Pre-label order-status snapshots ("NEW") are not courier events.
    subEvents: (hasAwb || trulyShipped ? scans : [])
      .filter((s: any) => !(s.statusId === 7 || /^delivered$/i.test(s.activity || s.status || '')))
      .map((s: any) => ({
        activity: s.activity || s.status,
        date: s.date,
        location: s.location,
      })),
  });

  const deliveryScan = scans.find((s: any) => (s.statusId === 7 || /^delivered$/i.test(s.activity || s.status || '')));
  if (!isCancelled) sections.push({
    label: 'Delivered',
    date: order.deliveredAt || deliveryScan?.date,
    phase: 'forward',
    done: !isCancelled && idxOf >= 3,
    current: idxOf === 3 && !returnRequest,
    description: order.deliveredAt
      ? 'Parcel delivered to customer.'
      : trulyShipped ? 'On its way — updates when the courier delivers.' : 'Not delivered yet.',
  });

  if (isCancelled) {
    sections.push({
      label: 'Cancelled',
      date: order.cancelledAt,
      phase: 'forward',
      done: true,
      // A refund that follows becomes the current step instead.
      current: returnRequest?.kind !== 'cancellation',
      description: 'Order was cancelled.',
    });
  }

  /* Cancellation refund (audit A16): a prepaid order cancelled before
     dispatch raises a refund obligation through the return-request
     pipeline, but nothing travels back — no pickup, transit or receipt
     steps, just the refund itself. */
  if (returnRequest?.kind === 'cancellation') {
    const rs = returnRequest.refundStatus;
    sections.push({
      label: 'Refund raised',
      date: returnRequest.refundRequestedAt || returnRequest.requestedAt,
      phase: 'reverse',
      done: ['requested', 'processing', 'completed', 'failed'].includes(rs),
      current: ['requested', 'processing'].includes(rs),
      description: rs === 'processing'
        ? 'Being processed in the Refund queue.'
        : `The customer paid online, so a refund${returnRequest.refundAmount ? ` of ₹${returnRequest.refundAmount}` : ''} is due — process it from the Refund queue.`,
    });
    sections.push({
      label: rs === 'failed' ? 'Refund failed' : 'Refunded',
      date: returnRequest.refundCompletedAt,
      phase: 'reverse',
      done: rs === 'completed' || rs === 'failed',
      current: rs === 'completed' || rs === 'failed',
      description: rs === 'completed'
        ? returnRequest.refundMethod === 'razorpay'
          ? `Refund of ₹${returnRequest.refundAmount} issued via Razorpay.`
          : `Refund of ₹${returnRequest.refundAmount} transferred manually. Reference: ${returnRequest.refundReference || '—'}.`
        : rs === 'failed' ? 'The refund didn’t go through — retry it from the Refund queue.' : 'Marked complete once the refund is processed.',
    });
    return sections;
  }

  // Reverse leg
  if (returnRequest && ['approved', 'completed'].includes(returnRequest.status)) {
    const isExchange = returnRequest.kind === 'exchange';
    const retScans: any[] = returnShipment?.scans || [];
    const verifiedAt = returnShipment?.verifiedAt;
    const verifiedOk = returnShipment?.verifiedOk !== false;
    const pickedUpScan = retScans.find((x) => /picked.?up/i.test(x.activity || x.status || ''));
    const transitScan = retScans.find((x) => /transit|on its way/i.test(x.activity || x.status || ''));
    const s = returnShipment?.status;
    const receivedDate = ['delivered', 'returned'].includes(s)
      ? returnShipment?.deliveredAt || returnShipment?.statusEventAt
      : null;

    if (isExchange) {
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
        description: `${seller} approved the customer's exchange.`,
      });
      sections.push({
        label: 'Exchange on the way',
        date: replacementShipment?.pushedAt,
        phase: 'reverse',
        done: !!replacementShipment,
        current: !!replacementShipment && !replDelivered,
        description: replacementShipment?.awbCode
          ? `Replacement dispatched · Tracking no. ${replacementShipment.awbCode}.`
          : 'Replacement is on its way to the customer.',
      });
      sections.push({
        label: 'Exchange completed',
        date: replDeliveredScan?.date || (replDelivered ? replacementShipment?.updatedAt : null),
        phase: 'reverse',
        done: replDelivered,
        current: replDelivered,
        description: replDelivered
          ? 'Replacement delivered to customer.'
          : 'Will mark complete when the replacement reaches the customer.',
      });
    } else {
      sections.push({
        label: 'Return accepted',
        date: returnRequest.decisionAt,
        phase: 'reverse',
        done: true,
        current: !pickedUpScan,
        description: `${seller} approved the customer's return.`,
      });
      sections.push({
        label: 'Picked up',
        date: pickedUpScan?.date,
        phase: 'reverse',
        done: !!pickedUpScan,
        current: !!pickedUpScan && !transitScan,
        description: 'Courier picked up the parcel from the customer.',
      });
      sections.push({
        label: 'In transit back',
        date: transitScan?.date,
        phase: 'reverse',
        done: !!transitScan,
        current: !!transitScan && !receivedDate,
        description: `Parcel is on its way back to ${seller.toLowerCase()}.`,
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
        description: `${seller} received the returned parcel.`,
      });
      sections.push({
        label: verifiedOk ? 'Verified' : 'Verification failed',
        date: verifiedAt,
        phase: 'reverse',
        done: !!verifiedAt,
        current: !!verifiedAt && returnRequest.refundStatus === 'not-requested',
        description: verifiedOk
          ? `${seller} confirmed the item is in returnable condition.`
          : `${seller} flagged a problem with the returned parcel.${returnShipment?.verificationNotes ? ` Note: ${returnShipment.verificationNotes}` : ''}`,
      });
      sections.push({
        label: 'Refund requested',
        date: returnRequest.refundRequestedAt,
        phase: 'reverse',
        done: ['requested', 'processing', 'completed'].includes(returnRequest.refundStatus),
        current: ['requested', 'processing'].includes(returnRequest.refundStatus),
        description: returnRequest.refundStatus === 'processing'
          ? 'You are processing the refund right now.'
          : returnRequest.refundStatus === 'requested'
            ? `${seller} raised the refund — process from the Refund queue.`
            : 'Refund will be raised once the seller verifies the parcel.',
      });
      sections.push({
        label: 'Refunded',
        date: returnRequest.refundCompletedAt,
        phase: 'reverse',
        done: returnRequest.refundStatus === 'completed',
        current: returnRequest.refundStatus === 'completed',
        description: returnRequest.refundStatus === 'completed'
          ? returnRequest.refundMethod === 'razorpay'
            ? `Refund of ₹${returnRequest.refundAmount} issued via Razorpay.`
            : `Refund of ₹${returnRequest.refundAmount} transferred manually. Reference: ${returnRequest.refundReference || '—'}.`
          : 'Will mark complete once refund is processed.',
      });
    }
  }

  return sections;
}
