'use client';

import { use, useEffect, useState, type ComponentProps } from 'react';
import Link from 'next/link';
import { Card, CardBody, CardHeader, Chip, Spinner, Modal as BaseModal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure, RadioGroup, Radio } from '@heroui/react';
import styles from './DashboardOrderDetail.module.css';
import Button from '@/components/common/SellerButton';
import Arrow from '@/components/common/Arrow';
import toast from 'react-hot-toast';
import { DetailSkeleton, StatusChip } from '@/components/ui';
import OrderTrackerVertical, { buildSectionsFromOrder } from '@/components/common/OrderTrackerVertical';
import { api, imageUrl, unwrap } from '@/lib/api';
import { downloadPdf as downloadPdfFile } from '@/lib/downloadPdf';
import { formatDateTime, formatDayMonth } from '@/lib/dates';
import { confirmDialog } from '@/lib/confirm';
import { orderDisplayStatus, orderStatusToken, paymentMethodLabel, paymentStatusLabel, shipmentProblem, shipmentStatusToken } from '@/lib/orderStatusDisplay';
import { useOrderPolling } from '@/lib/useOrderPolling';
import { notifyError, notifySuccess, notifyWarning, apiMessage, serverText } from '@/lib/notify';
import { M } from '@/lib/messages';

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);

/** Copy text for the seller, with one toast either way. */
async function copyText(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    notifySuccess(done);
  } catch {
    notifyWarning(M.orderDetail.couldntCopy);
  }
}

const DownloadIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const CopyIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

/* Forward lifecycle, in order. The header stepper reads the seller's
   own slice (`status` is already this seller's, see sellerOrderDto). */
const STEP_RANK: Record<string, number> = { placed: 0, confirmed: 1, shipped: 2, delivered: 3 };

function Modal(props: ComponentProps<typeof BaseModal>) {
  return <BaseModal {...props} placement="center" backdrop="opaque" scrollBehavior="inside"
    classNames={{ base:styles.modal, backdrop:styles.backdrop, header:styles.modalHeader, body:styles.modalBody, footer:styles.modalFooter }} />;
}

export default function DashboardOrderDetailPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const { orderNumber: id } = use(params);
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  useOrderPolling(async signal => {
    const data = unwrap<any>(await api.get(`/seller/orders/${id}`, { signal }));
    setOrder(data.order);
  }, id);

  // Dev-only mock mode flag — when true, we expose a "Simulate delivery"
  // helper button that flips the return shipment to delivered without
  // waiting for a real Shiprocket webhook. Detected on mount via /api/mock/health.
  const [mockMode, setMockMode] = useState(false);
  useEffect(() => {
    api.get('/mock/health').then(({ data }) => setMockMode(!!data?.mockMode)).catch(() => {});
  }, []);

  // Courier picker modal state
  const courierModal = useDisclosure();
  const [couriers, setCouriers] = useState<any[]>([]);
  const [loadingCouriers, setLoadingCouriers] = useState(false);
  const [chosenCourier, setChosenCourier] = useState<string>(''); // courier_company_id as string; '' = auto
  const [courierMeta, setCourierMeta] = useState<{ weightKg?: number; pickup?: string; delivery?: string }>({});

  // Decline-request modal state (seller responding to a customer return ask)
  const declineModal = useDisclosure();
  const [declineReqId, setDeclineReqId] = useState<string>('');
  const [declineReason, setDeclineReason] = useState<string>('');
  const [decliningId, setDecliningId] = useState<string>('');
  const [approvingId, setApprovingId] = useState<string>('');

  useEffect(() => {
    api
      .get(`/seller/orders/${id}`)
      .then(({ data }) => setOrder(data.order))
      .catch((e: any) => notifyError(e, M.orderDetail.thatDidntWork))
      .finally(() => setLoading(false));
  }, [id]);

  async function setStatus(next: 'confirmed' | 'shipped' | 'delivered') {
    if (!(await confirmDialog({
      title: `Mark order ${next}?`,
      message: `The customer will see this order as "${next}".`,
      confirmLabel: `Mark ${next}`,
    }))) return;
    setUpdating(next);
    try {
      const data = unwrap<any>(await api.patch(`/seller/orders/${id}/status`, { status: next }));
      setOrder(data.order);
      notifySuccess(M.orderDetail.orderMarked(next));
    } catch (e: any) {
      notifyError(e, M.orderDetail.couldntUpdate);
    } finally {
      setUpdating(null);
    }
  }

  /**
   * Seller clicks "Ship order" — we first open a courier picker
   * modal that calls /couriers and shows every available courier with rate
   * + ETA. Seller picks one (or sticks with "Auto"); we then call /ship with
   * the chosen courier_id. Backend handles AWB assignment + pickup schedule.
   */
  async function openCourierPicker() {
    setLoadingCouriers(true);
    setUpdating('couriers');
    setCouriers([]);
    setChosenCourier('');
    setCourierMeta({});
    courierModal.onOpen();
    try {
      /* The courier list needs this seller's slice to exist on Shiprocket
       * (a `shipmentId`). The auto-push at order time can fail — pickup
       * address not synced, transient Shiprocket outage — and the old
       * behaviour was a dead-end toast telling the seller to "click Retry
       * push" — a button this page never had. Self-heal instead: when the
       * backend says the order isn't pushed, push it now via
       * /retry-push and fetch the courier list again. If the push itself
       * fails, its real reason (e.g. "pickup location not verified") is
       * surfaced rather than the generic advice. */
      let data: any;
      try {
        data = unwrap<any>(await api.get(`/seller/orders/${id}/couriers`));
      } catch (e: any) {
        const msg = apiMessage(e) || '';
        if (!/not pushed to Shiprocket/i.test(msg)) throw e;
        toast.loading('Sending the order to the courier…', { id: 'sr-push' });
        let pushed: any;
        try {
          pushed = unwrap<any>(await api.post(`/seller/orders/${id}/retry-push`));
        } finally {
          toast.dismiss('sr-push');
        }
        if (!pushed?.ok) {
          throw new Error(
            pushed?.error ||
              'Could not send this order to the courier. Verify your pickup address on the KYC page, then try again.'
          );
        }
        notifySuccess(M.orderDetail.orderSentToTheCourier);
        data = unwrap<any>(await api.get(`/seller/orders/${id}/couriers`));
      }
      if (!data.ok) throw new Error('No couriers available');
      setCouriers(data.couriers || []);
      setCourierMeta({ weightKg: data.weightKg, pickup: data.pickup, delivery: data.delivery });
      // Default selection: seller's preferred courier, else recommended, else first.
      const pref = data.preferredCourierId;
      const recommended = (data.couriers || []).find((c: any) => c.recommended);
      const def = pref || recommended?.id || (data.couriers || [])[0]?.id;
      if (def) setChosenCourier(String(def));
    } catch (e: any) {
      notifyError(e, M.orderDetail.couldntLoadCouriers);
      courierModal.onClose();
    } finally {
      setLoadingCouriers(false);
      setUpdating(null);
    }
  }

  /** Confirm the chosen courier and actually ship. */
  async function shipWithShiprocket(courierId?: number | null) {
    setUpdating('ship');
    courierModal.onClose();
    try {
      const body = courierId ? { courier_id: courierId } : {};
      const data = unwrap<any>(await api.post(`/seller/orders/${id}/ship`, body));
      if (!data.awbCode) {
        notifyWarning(M.orderDetail.theCourierDidNotIssueATracking);
      } else if (data.pickupBooked === false) {
        // AWB exists but the courier booking failed — a label without a
        // pickup is NOT success. Clicking the same action retries the
        // booking only (the AWB is never regenerated).
        // The courier's reason is shown only when it reads as a sentence.
        notifyWarning(M.orderDetail.labelReadyPickupFailed(data.awbCode));
      } else {
        notifySuccess(M.orderDetail.labelReady(!!data.cached, data.awbCourier || 'the courier', data.awbCode, !!data.pickupBooked));
      }
      const refreshed = unwrap<any>(await api.get(`/seller/orders/${id}`));
      setOrder(refreshed.order);
    } catch (e: any) {
      notifyError(e, M.orderDetail.shipFailed);
    } finally {
      setUpdating(null);
    }
  }

  /** Mark the returned parcel verified after seller inspection. */
  async function markVerified(reqId: string, ok: boolean) {
    let notes = '';
    if (!ok) {
      // Use native prompt for a quick rejection note; HeroUI modal would be
      // nicer but this is a rare path.
      notes = (typeof window !== 'undefined' && window.prompt('Why is the parcel rejected? (Shown to admin + customer)')) || '';
      if (!notes.trim()) return;
    } else {
      if (!(await confirmDialog({
        title: 'Confirm received & verified',
        message: 'The returned parcel arrived in returnable condition. This unlocks the refund step.',
        confirmLabel: 'Mark verified',
      }))) return;
    }
    setUpdating('verify');
    try {
      const data = unwrap<any>(await api.post(`/seller/orders/${id}/return-request/${reqId}/verify`, { ok, notes }));
      // Backend returns a contextual message: e.g. "Verified — refund of
      // ₹500 raised with admin." for returns where the refund auto-raised,
      // or just "Marked verified." for exchanges (which skip the refund).
      notifySuccess(serverText(data?.message) || (ok ? 'Marked verified' : 'Marked as not acceptable · admin will see your note'));
      const refreshed = unwrap<any>(await api.get(`/seller/orders/${id}`));
      setOrder(refreshed.order);
    } catch (e: any) {
      notifyError(e, M.orderDetail.verifyFailed);
    } finally {
      setUpdating(null);
    }
  }

  /** For returns — raise a refund request with admin. */
  async function raiseRefund(reqId: string) {
    if (!(await confirmDialog({
      title: 'Raise refund request?',
      message: "THROTTLEIN admin will issue the refund to the customer. You'll see the status update here when it's processed.",
      confirmLabel: 'Raise refund request',
    }))) return;
    setUpdating('refund');
    try {
      const data = unwrap<any>(await api.post(`/seller/orders/${id}/return-request/${reqId}/raise-refund`));
      notifySuccess(M.orderDetail.refundRequestRaised(data.refundAmount || ''));
      const refreshed = unwrap<any>(await api.get(`/seller/orders/${id}`));
      setOrder(refreshed.order);
    } catch (e: any) {
      notifyError(e, M.orderDetail.refundRequestFailed);
    } finally {
      setUpdating(null);
    }
  }

  /**
   * DEV ONLY — simulate the courier delivering the return parcel back to
   * the seller. Calls the mock endpoint that flips the sellerShipments
   * entry's status to 'delivered' and appends a synthetic scan, then
   * refreshes the order. Lets you walk the full return/exchange flow in
   * mock mode without waiting for a Shiprocket webhook (which never fires
   * in mock mode anyway).
   */
  async function simulateReturnDelivery(entryId: string) {
    setUpdating('simulate');
    try {
      await api.post(`/mock/shipment/${id}/${entryId}/simulate-delivery`);
      notifySuccess(M.orderDetail.mockDeliveryScanFired);
      const refreshed = unwrap<any>(await api.get(`/seller/orders/${id}`));
      setOrder(refreshed.order);
    } catch (e: any) {
      notifyError(e, M.orderDetail.simulationFailed);
    } finally {
      setUpdating(null);
    }
  }

  /** For exchanges — create + dispatch the replacement shipment. */
  async function shipReplacement(reqId: string) {
    if (!(await confirmDialog({
      title: 'Ship replacement now?',
      message: 'A new shipment is booked from your pickup address. The courier swaps it for the old parcel at the customer\'s door.',
      confirmLabel: 'Ship replacement',
    }))) return;
    setUpdating('replacement');
    try {
      const data = unwrap<any>(await api.post(`/seller/orders/${id}/return-request/${reqId}/ship-replacement`));
      notifySuccess(M.orderDetail.replacementScheduled);
      const refreshed = unwrap<any>(await api.get(`/seller/orders/${id}`));
      setOrder(refreshed.order);
    } catch (e: any) {
      notifyError(e, M.orderDetail.shipReplacementFailed);
    } finally {
      setUpdating(null);
    }
  }

  /** Seller approves a customer's return/exchange request. */
  async function approveRequest(reqId: string) {
    if (!(await confirmDialog({
      title: 'Approve this request?',
      message: "A courier pickup is booked from the customer's address.",
      confirmLabel: 'Approve & schedule pickup',
    }))) return;
    setApprovingId(reqId);
    try {
      const data = unwrap<any>(await api.post(`/seller/orders/${id}/return-request/${reqId}/approve`));
      notifySuccess(M.orderDetail.requestApproved);
      const refreshed = unwrap<any>(await api.get(`/seller/orders/${id}`));
      setOrder(refreshed.order);
    } catch (e: any) {
      notifyError(e, M.orderDetail.couldntApprove);
    } finally {
      setApprovingId('');
    }
  }

  /** Seller declines — open modal to capture reason. */
  function openDecline(reqId: string) {
    setDeclineReqId(reqId);
    setDeclineReason('');
    declineModal.onOpen();
  }
  async function submitDecline() {
    if (declineReason.trim().length < 5) {
      notifyWarning(M.orderDetail.pleaseGiveTheCustomerAReasonAt);
      return;
    }
    setDecliningId(declineReqId);
    try {
      await api.post(`/seller/orders/${id}/return-request/${declineReqId}/decline`, {
        reason: declineReason,
      });
      notifySuccess(M.orderDetail.requestDeclined);
      declineModal.onClose();
      const refreshed = unwrap<any>(await api.get(`/seller/orders/${id}`));
      setOrder(refreshed.order);
    } catch (e: any) {
      notifyError(e, M.orderDetail.declineFailed);
    } finally {
      setDecliningId('');
    }
  }

  /** Initiate return for a delivered order — calls /return and refetches. */
  async function initiateReturn() {
    if (!(await confirmDialog({
      title: 'Initiate return?',
      message: 'The courier collects the parcel from the customer and brings it back to you. Return tracking shows on this order next to the original shipment.',
      confirmLabel: 'Initiate return',
    }))) return;
    setUpdating('return');
    try {
      const data = unwrap<any>(await api.post(`/seller/orders/${id}/return`));
      notifySuccess(M.orderDetail.returnPickupScheduled);
      const refreshed = unwrap<any>(await api.get(`/seller/orders/${id}`));
      setOrder(refreshed.order);
    } catch (e: any) {
      notifyError(e, M.orderDetail.returnFailed);
    } finally {
      setUpdating(null);
    }
  }

  /** Re-fetch the order — used after shipment-side actions (cancel / etc.). */
  async function refresh() {
    try {
      const data = unwrap<any>(await api.get(`/seller/orders/${id}`));
      setOrder(data.order);
    } catch (e: any) {
      notifyError(e, M.orderDetail.refreshFailed);
    }
  }

  /** Forward shipment for this seller's slice (if any). */
  function sellerShipmentInfo() {
    if (!order?.sellerShipments) return null;
    return (order.sellerShipments || []).find((s: any) => (s.kind || 'forward') === 'forward') || null;
  }
  /** Return shipment if one was initiated. */
  function sellerReturnInfo() {
    if (!order?.sellerShipments) return null;
    return (order.sellerShipments || []).find((s: any) => s.kind === 'return') || null;
  }

  /**
   * Allowed transitions by current status — enforces the placed → confirmed →
   * shipped → delivered sequence. We deliberately DON'T offer "Mark shipped"
   * from placed, because shipping should always go through "Ship order"
   * (which generates an AWB) — otherwise the order would end up in
   * "shipped" state with no courier booking, breaking tracking.
   */
  function nextActions(status: string): { key: 'confirmed' | 'shipped' | 'delivered'; label: string; color: 'primary' | 'success' }[] {
    if (status === 'placed') {
      return [{ key: 'confirmed', label: 'Confirm order', color: 'primary' }];
    }
    if (status === 'confirmed') {
      // The "Ship order" button is rendered separately and handles
      // AWB + pickup automatically. No manual "Mark shipped" here.
      return [];
    }
    return [];
  }

  /**
   * Single-sentence hint above the action buttons telling the seller what to
   * do next. Helps the flow stay obvious even for first-time sellers.
   */
  /**
   * Most-recent approved return request (decides whether we're showing the
   * exchange or pure-return copy). Pending requests don't change the hint —
   * those have their own callout panel above.
   */
  function activeReturnRequest(): any | null {
    const reqs = (order?.returnRequests || []).filter(
      (r: any) => ['approved', 'completed'].includes(r.status)
    );
    if (!reqs.length) return null;
    return [...reqs].sort(
      (a, b) => new Date(b.decisionAt || b.requestedAt).getTime() - new Date(a.decisionAt || a.requestedAt).getTime()
    )[0];
  }

  /**
   * Status to SHOW, derived from this seller's shipment rather than the
   * order-level field.
   *
   * `order.status` is a cached aggregate across all sellers, and orders
   * created under the old flow were flipped to `shipped` the moment a
   * label was generated — so it reported a parcel as dispatched while
   * the carrier still said PICKUP SCHEDULED and the box sat with the
   * seller. The shipment knows better: an AWB means the label exists,
   * and only the courier's pickup scan means it actually left.
   */
  function displayStatus(): string {
    // Shared rule — see lib/orderStatusDisplay. This view only ever
    // shows one seller's slice, and the DTO already filters
    // `sellerShipments` to that seller, so no sellerId is needed.
    return orderDisplayStatus(order as any);
  }

  function nextStepHint(): string {
    if (!order) return '';
    if (order.fulfillmentHold) return `Dispatch is on hold. ${order.fulfillmentHold}`;
    const { key: stage } = orderStatusToken(order as any);
    if (order.status === 'placed') return 'Click "Confirm order" to accept it. The customer is notified once you confirm.';
    // Label ready, courier booked, parcel not collected yet.
    if (stage === 'pickup_failed') {
      return 'The courier came but did not collect the parcel. Keep it packed and click "Book pickup again" below.';
    }
    if (stage === 'shipping_error' && sellerShipmentInfo()?.awbCode) {
      return 'The label is ready but the courier booking failed — click "Ship order" to retry the booking.';
    }
    if (stage === 'awaiting_pickup') {
      return 'Print the label and hand the parcel to the courier when they arrive. The status moves to "In transit" once they scan the pickup.';
    }
    if (order.status === 'confirmed' && !sellerShipmentInfo()?.awbCode) return 'Click "Ship order" — we book the courier and generate the shipping label in one step.';
    if (order.status === 'shipped' && !sellerShipmentInfo()?.awbCode) return "This order doesn't have a courier booking yet. Click \"Ship order\" to book the courier now.";
    if (order.status === 'shipped') return 'Parcel is on its way. Status auto-updates when the courier scans "delivered."';

    // Delivered + active return / exchange in progress — guide seller.
    if (order.status === 'delivered') {
      const ret = sellerReturnInfo();
      const req = activeReturnRequest();
      if (ret && ret.status !== 'returned') {
        if (req?.kind === 'exchange') {
          return 'Exchange pickup is scheduled. Wait for the parcel to come back, then ship the replacement to the customer.';
        }
        return 'Return pickup is scheduled. The parcel will arrive at your pickup address — refund the customer once you have it.';
      }
      if (ret && ret.status === 'returned') {
        if (req?.kind === 'exchange') {
          return 'Return received. Ship the replacement and update the customer.';
        }
        return 'Return received. Refund the customer if you haven\'t already.';
      }
      // Pending request awaiting decision — hint about that
      const pending = (order.returnRequests || []).find((r: any) => r.status === 'pending');
      if (pending) {
        return `Customer requested a ${pending.kind}. Review it above and approve or decline.`;
      }
      return 'Order complete. Payout will appear in your next settlement cycle.';
    }
    if (order.status === 'cancelled') return 'Order cancelled. Review any return or refund updates below.';
    return '';
  }

  /** Compound status chip text — surfaces return state alongside delivered. */
  function compoundStatusChip(): { label: string; color: 'default' | 'success' | 'warning' | 'danger' } | null {
    if (!order || order.status !== 'delivered') return null;
    const ret = sellerReturnInfo();
    const req = activeReturnRequest();
    if (ret && ret.status !== 'returned') {
      return {
        label: req?.kind === 'exchange' ? 'Exchange in progress' : 'Return in progress',
        color: 'warning',
      };
    }
    if (ret && ret.status === 'returned') {
      return {
        label: req?.kind === 'exchange' ? 'Awaiting replacement ship' : 'Returned',
        color: 'warning',
      };
    }
    const pending = (order.returnRequests || []).find((r: any) => r.status === 'pending');
    if (pending) {
      return { label: `${pending.kind} requested`, color: 'warning' };
    }
    return null;
  }

  if (loading) {
    return (
      <>
        <DetailSkeleton aside cards={2} rows={3} />
      </>
    );
  }
  if (!order) {
    return (
      <>
        <div className="text-muted">Order not found.</div>
        <Link href="/dashboard/orders" className={styles.back}>
          <Arrow dir="left" />
          Back to orders
        </Link>
      </>
    );
  }

  const a = order.shippingAddress;
  const token = orderStatusToken(order as any);
  const compound = compoundStatusChip();
  const itemCount = order.items.reduce((n: number, it: any) => n + (Number(it.quantity) || 1), 0);
  const pendingRequest = (order.returnRequests || []).find((r: any) => r.status === 'pending');
  const orderComplete = order.status === 'delivered' && !sellerReturnInfo() && !pendingRequest;
  const addressText = [a.fullName, a.line1, a.line2, `${a.city}, ${a.state} ${a.pincode}`, a.country].filter(Boolean).join('\n');
  // Header stepper — where this parcel is in placed → confirmed → shipped
  // → delivered, with the date each stage happened.
  const rank = STEP_RANK[order.status] ?? 0;
  const steps = [
    { label: 'Placed', at: order.createdAt },
    { label: 'Confirmed', at: order.confirmedAt },
    { label: 'Shipped', at: order.shippedAt },
    { label: 'Delivered', at: order.deliveredAt },
  ].map((s, i) => ({
    ...s,
    done: i < rank || (i === rank && rank === 3),
    current: i === rank && rank < 3,
    // The current stage names the finer state ("Awaiting pickup") when the
    // status token has one, so the stepper agrees with the chip; every
    // other stage shows the date it happened.
    sub: i === rank && rank < 3 && token.label !== s.label ? token.label : s.at ? formatDayMonth(s.at) : '',
  }));

  return (
    <div className={styles.page}>
      {/* Back pill, matching every other detail screen in both panels. */}
      <Link href="/dashboard/orders" className={styles.back}>
        <Arrow dir="left" />
        Back to orders
      </Link>

      <Card className={`${styles.panel} ${styles.summary}`}>
        <CardBody className={styles.summaryBody}>
          <div className={styles.summaryRow}>
            <div className="flex-1 min-w-0">
              <div className={styles.eyebrow}>Order</div>
              <div className={styles.summaryTitle}>
                <h1>{order.orderNumber}</h1>
                {/* "confirmed" alone is vague once a label exists but the
                    courier hasn't collected yet — the parcel is neither
                    just-confirmed nor shipped. Name that stage explicitly
                    so this agrees with what the carrier reports. */}
                <StatusChip status={token.key} label={token.label} />
                {/* Compound chip — surfaces an active return / exchange so
                    "delivered" alone doesn't read as terminal when it isn't. */}
                {compound && <StatusChip status="requested" label={compound.label} className="capitalize" />}
              </div>
              {/* Key facts at a glance — when, how big, where, how paid. */}
              <div className={styles.facts}>
                <span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
                  Placed <strong>{formatDateTime(order.createdAt)}</strong>
                </span>
                <span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 8 12 3 3 8v8l9 5 9-5V8z" /><path d="M3 8l9 5 9-5M12 13v8" /></svg>
                  <strong>{itemCount} item{itemCount === 1 ? '' : 's'}</strong> · ₹{inr(order.myItemsSubtotal)}
                </span>
                <span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" /></svg>
                  Ships to <strong>{a.city} {a.pincode}</strong>
                </span>
                <span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>
                  {paymentMethodLabel(order.paymentMethod)} · <strong>{paymentStatusLabel(order.paymentStatus)}</strong>
                </span>
                {token.detail && <span>Courier says <strong>{token.detail}</strong></span>}
              </div>
            </div>
            <div className={styles.summaryActions}>
              {/* Confirmed orders + already-shipped-without-AWB orders both get
                  the smart Ship button. The latter is a recovery path for
                  orders that were "Mark shipped"'d (old flow) without an AWB. */}
              {(order.status === 'confirmed' || (order.status === 'shipped' && !sellerShipmentInfo()?.awbCode))
                && !sellerShipmentInfo()?.awbCode && !order.fulfillmentHold && (
                <Button
                  color="primary"
                  className="font-semibold"
                  isLoading={updating === 'ship' || updating === 'couriers'}
                  onPress={openCourierPicker}
                  startContent={
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="1" y="3" width="15" height="13" />
                      <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
                      <circle cx="5.5" cy="18.5" r="2.5" />
                      <circle cx="18.5" cy="18.5" r="2.5" />
                    </svg>
                  }
                >
                  {/* ONE verb for the whole flow (UX audit S3). This button,
                      the list's row action, the hints and the toasts all say
                      "Ship order"; it used to be "Pick courier & ship",
                      "Generate label & pickup" and "Ship & schedule pickup"
                      for the same click. */}
                  Ship order
                </Button>
              )}
              {/* Delivered orders get an "Initiate return" CTA (unless a return
                  was already created). */}
              {order.status === 'delivered' && !sellerReturnInfo() && (
                <Button
                  variant="bordered"
                  className="font-semibold border-2"
                  isLoading={updating === 'return'}
                  onPress={initiateReturn}
                  startContent={
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 14 4 9 9 4" />
                      <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
                    </svg>
                  }
                >
                  Initiate return
                </Button>
              )}
              {(order.fulfillmentHold ? [] : nextActions(order.status))
                // Hide "Mark delivered" once Shiprocket has fired any webhook
                // scan — the courier-driven flow is now authoritative and the
                // manual override would just confuse the timeline. We keep the
                // button visible when no scans have arrived (mock mode, pre-
                // webhook-setup, or stuck orders) as a safety net.
                .filter((a) => !(a.key === 'delivered' && (sellerShipmentInfo()?.scans?.length || 0) > 0))
                .map((a) => (
                  <Button
                    key={a.key}
                    color={a.color}
                    className="font-semibold"
                    isLoading={updating === a.key}
                    onPress={() => setStatus(a.key)}
                  >
                    {a.label}
                  </Button>
                ))}
            </div>
          </div>

          {/* Stage stepper — one glance says how far the parcel has got.
              A cancelled order has no path to show; the chip says it. */}
          {order.status !== 'cancelled' && (
            <ol className={styles.steps} aria-label="Order progress">
              {steps.map((s) => (
                <li key={s.label} className={`${styles.step} ${s.done ? styles.stepDone : ''} ${s.current ? styles.stepCurrent : ''}`} aria-current={s.current ? 'step' : undefined}>
                  <span className={styles.stepBar} />
                  <strong>{s.label}</strong>
                  <span>{s.sub || (s.done || s.current ? '' : 'Pending')}</span>
                </li>
              ))}
            </ol>
          )}

          {/* One clear instruction telling the seller what to do now —
              a callout, not a footnote, because it is the point of the page. */}
          {order.status !== 'cancelled' && nextStepHint() && (
            <div className={`${styles.next} ${order.fulfillmentHold ? styles.nextHold : ''}`} role="status">
              <span className={styles.nextIcon} aria-hidden="true">
                {order.fulfillmentHold ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" /></svg>
                ) : orderComplete ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                )}
              </span>
              <div>
                <strong>{order.fulfillmentHold ? 'Dispatch on hold' : orderComplete ? 'All done' : 'Next step'}</strong>
                {nextStepHint()}
                {orderComplete && <> <Link href="/dashboard/payouts" className={styles.nextLink}>View payouts <Arrow /></Link></>}
              </div>
            </div>
          )}
        </CardBody>
      </Card>
      <div className={styles.columns}>
        <div className={styles.mainColumn}>
          {/* Problem block (UX audit S4) for the states BEFORE a label
              exists — the push never reached the courier, or the label
              step failed. Once a tracking number exists the ShipmentPanel
              below owns the state (and its own "Book pickup again"). */}
          {(() => {
            const info = sellerShipmentInfo();
            const pr = info && !info.awbCode ? shipmentProblem(info) : null;
            if (!pr || order.fulfillmentHold) return null;
            return (
              <div className="mt-4 rounded-xl border-2 border-rose-200 bg-rose-50/60 p-4 flex flex-wrap items-center gap-3" role="alert">
                <div className="w-9 h-9 rounded-lg bg-rose-100 text-rose-700 grid place-items-center shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                </div>
                <div className="flex-1 min-w-[200px]">
                  <div className="text-sm font-semibold text-rose-900">{pr.title}</div>
                  {pr.detail && <div className="text-xs text-rose-800 mt-0.5 leading-relaxed">{pr.detail}</div>}
                </div>
                {pr.action === 'ship' && (
                  <Button color="danger" size="sm" className="font-semibold" isLoading={updating === 'ship' || updating === 'couriers'} onPress={openCourierPicker}>
                    {pr.actionLabel}
                  </Button>
                )}
              </div>
            );
          })()}

          {/* AWB / shipment info panel — shows once shipping is set up */}
          {sellerShipmentInfo()?.awbCode && (
            <ShipmentPanel orderId={id} info={sellerShipmentInfo()} order={order} onChange={refresh} />
          )}
          {/* Customer return / exchange requests — seller approves or declines */}
          {(order.returnRequests || []).filter((r: any) => r.status === 'pending').length > 0 && (
            <div className="mt-4 rounded-xl border-2 border-amber-200 bg-amber-50/60 p-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 grid place-items-center shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-amber-700">
                    Customer request — needs your decision
                  </div>
                  <div className="flex flex-col gap-3 mt-2">
                    {(order.returnRequests || [])
                      .filter((r: any) => r.status === 'pending')
                      .map((r: any) => (
                        <div key={r._id} className="rounded-lg border border-amber-200 bg-white p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Chip size="sm" color="warning" variant="flat" className="capitalize">
                              {r.kind}
                            </Chip>
                            <span className="text-xs text-muted">
                              Submitted {formatDateTime(r.requestedAt)}
                            </span>
                          </div>
                          <div className="mt-2 text-sm font-semibold">
                            Items: {(r.items || []).map((it: any) => `${it.name}${it.size ? ` · ${it.size}` : ''} × ${it.quantity}`).join(', ')}
                          </div>
                          {(r.reasonCode || r.reason) && (
                            <div className="mt-1 text-sm text-default-700">
                              <strong>Reason:</strong> {r.reasonCode && <span className="text-muted mr-1">({r.reasonCode})</span>}{r.reason || '—'}
                            </div>
                          )}
                          {r.desiredAction && (
                            <div className="mt-1 text-sm text-default-700">
                              <strong>Wants instead:</strong> {r.desiredAction}
                            </div>
                          )}
                          {/* Customer evidence — photos/videos for damage / wrong-item claims */}
                          {Array.isArray(r.attachments) && r.attachments.length > 0 && (
                            <div className="mt-2">
                              <div className="text-xs uppercase tracking-wider text-muted font-semibold mb-1">
                                Evidence ({r.attachments.length})
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {r.attachments.map((a: any, i: number) => (
                                  <a
                                    key={i}
                                    href={imageUrl(a.url)}
                                    target="_blank"
                                    rel="noopener"
                                    className="relative w-16 h-16 rounded-lg border-2 border-default-200 overflow-hidden bg-default-100 hover:border-default-400 transition shrink-0"
                                  >
                                    {a.kind === 'image' ? (
                                      <img src={imageUrl(a.url)} alt={`Evidence ${i + 1}`} className="w-full h-full object-cover" />
                                    ) : (
                                      <video src={imageUrl(a.url)} className="w-full h-full object-cover" muted />
                                    )}
                                    <div className="absolute bottom-0 left-0 right-0 px-1 py-0.5 text-xs uppercase tracking-wider bg-black/70 text-white text-center">
                                      {a.kind}
                                    </div>
                                  </a>
                                ))}
                              </div>
                            </div>
                          )}
                          <div className="mt-3 flex gap-2">
                            <Button
                              size="sm"
                              color="success"
                              className="font-semibold"
                              isLoading={approvingId === r._id}
                              onPress={() => approveRequest(r._id)}
                            >
                              Approve & schedule pickup
                            </Button>
                            <Button
                              size="sm"
                              variant="bordered"
                              color="danger"
                              className="font-semibold border-2"
                              isLoading={decliningId === r._id}
                              onPress={() => openDecline(r._id)}
                            >
                              Decline
                            </Button>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Return shipment panel — appears once a return has been initiated */}
          {sellerReturnInfo() && (
            <div className="mt-4 rounded-xl border-2 border-purple-200 bg-purple-50/60 p-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-lg bg-purple-100 text-purple-700 grid place-items-center shrink-0">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 14 4 9 9 4" />
                    <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-purple-700">
                    Return pickup
                  </div>
                  <div className="text-sm font-semibold text-purple-900 mt-0.5">
                    Status: {sellerReturnInfo()?.status || 'return_pickup'}
                    {sellerReturnInfo()?.awbCode && (
                      <> · Tracking no. <span className="font-mono">{sellerReturnInfo()?.awbCode}</span></>
                    )}
                  </div>
                  <div className="text-xs text-purple-800 mt-1 leading-relaxed">
                    The courier collects the parcel from the customer and delivers it back to your pickup address. Tracking updates here.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Approved-request action panel — drives the post-pickup workflow:
              Exchange → Ship replacement → wait for old item → Verify
              Return  → wait for parcel → Verify → Raise refund request */}
          {(order.returnRequests || [])
            .filter((r: any) => r.status === 'approved')
            .map((r: any) => {
              const retEntry = (order.sellerShipments || []).find(
                (s: any) => String(s._id) === String(r.returnShipmentEntryId)
              );
              const parcelReceived = retEntry && ['delivered', 'returned'].includes(retEntry.status);
              const verified = !!retEntry?.verifiedAt;
              const verifiedOk = retEntry?.verifiedOk !== false;
              const isExchange = r.kind === 'exchange';
              const replacementShipped = !!r.replacementShipmentEntryId;
              const refundRaised = r.refundStatus && r.refundStatus !== 'not-requested';

              // A refund-only cancellation belongs with payment details,
              // not in a large panel implying the seller has work to do.
              if (r.kind === 'cancellation' && !retEntry && refundRaised) return null;

              return (
                <div
                  key={`actions-${r._id}`}
                  className={styles.actionPanel}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-9 h-9 rounded-lg bg-purple-100 text-purple-700 grid place-items-center shrink-0">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-purple-700">
                        Next steps · {r.kind}
                      </div>
                      <div className="flex flex-col gap-3 mt-3">
                        {/* Step 1 (exchange only): ship the replacement */}
                        {isExchange && !replacementShipped && (
                          <div className="rounded-lg border border-default-200 bg-default-50/50 p-3">
                            <div className="text-sm font-semibold">Ship the replacement</div>
                            <div className="text-xs text-default-600 mt-1 leading-relaxed">
                              Create a new shipment for the replacement parcel. The courier will deliver this and pick up the old item from the customer in the same visit.
                            </div>
                            <Button
                              size="sm"
                              color="primary"
                              className="mt-2 font-semibold"
                              isLoading={updating === 'replacement'}
                              onPress={() => shipReplacement(r._id)}
                            >
                              Ship replacement
                            </Button>
                          </div>
                        )}
                        {isExchange && replacementShipped && (
                          <div className="text-xs text-emerald-700 rounded-lg bg-emerald-50 border border-emerald-100 p-2">
                            ✓ Replacement shipped. Tracking visible above.
                          </div>
                        )}

                        {/* Step 2 (both): mark verified once the parcel comes back */}
                        {!verified && (r.kind !== 'cancellation' || retEntry) && (
                          <div className="rounded-lg border border-default-200 bg-default-50/50 p-3">
                            <div className="text-sm font-semibold">
                              Verify the returned parcel
                            </div>
                            <div className="text-xs text-default-600 mt-1 leading-relaxed">
                              {parcelReceived
                                ? (isExchange
                                    ? 'The parcel has arrived at your pickup. Inspect the items and confirm condition.'
                                    : 'The parcel has arrived. Inspect the items and confirm condition — marking verified automatically raises the refund with admin.')
                                : "Waiting for the parcel to arrive at your address. You'll be able to verify once the courier marks it delivered."}
                            </div>
                            {parcelReceived && (
                              <div className="mt-2 flex gap-2">
                                <Button
                                  size="sm"
                                  color="success"
                                  className="font-semibold text-white"
                                  isLoading={updating === 'verify'}
                                  onPress={() => markVerified(r._id, true)}
                                >
                                  Mark verified
                                </Button>
                                <Button
                                  size="sm"
                                  variant="bordered"
                                  color="danger"
                                  className="font-semibold border-2"
                                  onPress={() => markVerified(r._id, false)}
                                >
                                  Reject (damaged / wrong item)
                                </Button>
                              </div>
                            )}
                            {/* Dev-only: in mock mode there's no real courier so
                                we expose a simulate button that fires a fake
                                "Delivered" scan on the return shipment. */}
                            {mockMode && !parcelReceived && retEntry && (
                              <div className="mt-3 pt-3 border-t border-dashed border-default-300 flex items-start gap-2">
                                <div className="text-xs uppercase tracking-wider font-semibold text-amber-700 bg-amber-100 rounded px-1.5 py-0.5">
                                  Dev
                                </div>
                                <div className="flex-1">
                                  <Button
                                    size="sm"
                                    variant="bordered"
                                    className="font-semibold border-2 border-amber-400 text-amber-800"
                                    isLoading={updating === 'simulate'}
                                    onPress={() => simulateReturnDelivery(retEntry._id)}
                                  >
                                    Simulate: courier delivered to me
                                  </Button>
                                  <div className="text-xs text-muted mt-1">
                                    Mock-mode only · fires a synthetic Shiprocket delivery scan
                                    so you can test the verify → refund / replacement flow.
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        {verified && (
                          <div
                            className={`text-xs rounded-lg p-2 border ${
                              verifiedOk
                                ? 'bg-emerald-50 border-emerald-100 text-emerald-700'
                                : 'bg-rose-50 border-rose-100 text-rose-700'
                            }`}
                          >
                            {verifiedOk
                              ? `✓ Verified on ${formatDateTime(retEntry.verifiedAt)}.`
                              : `Rejected: ${retEntry.verificationNotes || 'no note'}`}
                          </div>
                        )}

                        {/* Step 3 (return only): raise refund request to admin */}
                        {!isExchange && verified && verifiedOk && !refundRaised && (
                          <div className="rounded-lg border border-default-200 bg-default-50/50 p-3">
                            <div className="text-sm font-semibold">Raise refund request</div>
                            <div className="text-xs text-default-600 mt-1 leading-relaxed">
                              You\'ve confirmed the return. THROTTLEIN admin will issue the refund to the customer — track the status below.
                            </div>
                            <Button
                              size="sm"
                              color="primary"
                              className="mt-2 font-semibold"
                              isLoading={updating === 'refund'}
                              onPress={() => raiseRefund(r._id)}
                            >
                              Raise refund request
                            </Button>
                          </div>
                        )}
                        {!isExchange && refundRaised && (
                          <div className="text-xs rounded-lg bg-default-50 border border-default-200 p-2 text-default-700">
                            Refund <span className="font-semibold capitalize">{r.refundStatus}</span>
                            {r.refundAmount ? ` · ₹${r.refundAmount}` : ''}
                            {r.refundCompletedAt && (
                              <> · Completed {formatDateTime(r.refundCompletedAt)}</>
                            )}
                            {r.refundReference && <> · Ref {r.refundReference}</>}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

          {/* Recovery callout — order is "shipped" in our system but never had
              an AWB generated. Could happen if status was flipped manually
              before Shiprocket was wired up, or if the push failed silently. */}
          {order.status === 'shipped' && !sellerShipmentInfo()?.awbCode && (
            <div className="mt-4 rounded-xl border-2 border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 grid place-items-center shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-amber-900">No courier booked yet</div>
                <div className="text-xs text-amber-800 mt-1 leading-relaxed">
                  This order is marked shipped, but no shipping label was generated and no courier is on the way. Click <span className="font-semibold">Ship order</span> above to book the courier and get a printable label.
                </div>
              </div>
            </div>
          )}

          {/* TIMELINE — forward lifecycle, extended with return / exchange
              steps inline when one is in flight. The component computes the
              reverse-leg step index from the return shipment status + scans. */}
          {/* Horizontal status timeline removed in favour of the vertical
              OrderTrackerVertical card in the right sidebar — same layout the
              customer sees, with seller-voiced descriptions. */}
          <Card className={`${styles.panel} p-6`}>
            <CardHeader className="p-0 pb-3">
              <div className={styles.sectionHeading}><h2>Order items</h2><span>{order.items.length} item{order.items.length === 1 ? '' : 's'}</span></div>
            </CardHeader>
            <CardBody className="p-0 flex flex-col gap-3">
              {order.items.map((it: any, i: number) => (
                <div key={i} className={styles.itemRow}>
                  {it.image ? (
                    <img
                      src={imageUrl(it.image)}
                      alt={it.name}
                      className="w-16 h-16 object-cover rounded border border-default-200"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded bg-default-200" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{it.name}</div>
                    <div className="text-xs text-muted">
                      {[
                        it.brand,
                        it.size && `Size ${it.size}`,
                        (it as any).color && `Colour ${(it as any).color}`,
                        `Qty ${it.quantity}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">₹{inr(it.subtotal)}</div>
                    <div className="text-xs text-muted flex items-baseline gap-1 justify-end">
                      <span>₹{inr(it.price)} each</span>
                      {it.mrp > it.price && (
                        <span className="line-through text-muted">₹{inr(it.mrp)}</span>
                      )}
                    </div>
                    {it.mrp > it.price && (
                      <div className="text-xs text-emerald-700 font-semibold mt-0.5">
                        {Math.round(((it.mrp - it.price) / it.mrp) * 100)}% off
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div className={styles.subtotal}>
                <div><span>Your subtotal</span><p>Includes only products sold by your store.</p></div>
                <strong>₹{inr(order.myItemsSubtotal)}</strong>
              </div>
            </CardBody>
          </Card>

          {/* Vertical tracker — same Flipkart-style layout the customer sees,
              with seller-voiced descriptions. Sits in the main column below
              Items so the right sidebar (Ship to / Payment) stays compact. */}
          {(() => {
            const forward = sellerShipmentInfo();
            const req = activeReturnRequest();
            const returnShipment = sellerReturnInfo();
            const replacement = req?.replacementShipmentEntryId
              ? (order.sellerShipments || []).find(
                  (s: any) =>
                    (s.kind || 'forward') === 'forward' &&
                    String(s._id) === String(req.replacementShipmentEntryId)
                )
              : null;
            return (
              <OrderTrackerVertical
                title="Order activity"
                className={styles.activity}
                neutral
                sections={buildSectionsFromOrder({
                  order,
                  forwardShipment: forward,
                  returnRequest: req,
                  returnShipment,
                  replacementShipment: replacement,
                  perspective: 'seller',
                })}
              />
            );
          })()}
        </div>

        <div className={styles.sideColumn}>
          <Card className={`${styles.panel} p-6`}>
            <CardHeader className="p-0 pb-3"><h2 className={styles.sectionTitle}>Customer & delivery</h2></CardHeader>
            <CardBody className={styles.address}>
              {/* Name + delivery address only. The customer's phone and
                  email are deliberately not shown to sellers — the
                  courier already receives the contact details directly
                  from us, so a seller never needs them to fulfil. The
                  API omits them too (see sellerOrderDto), so they can't
                  be read out of the network response either. */}
              <div className={styles.addressLabel}>Deliver to</div>
              <div className={styles.addressName}>{a.fullName}</div>
              <div className={styles.addressLines}>
                <div>{a.line1}</div>
                {a.line2 && <div>{a.line2}</div>}
                <div>{a.city}, {a.state}</div>
                <div>{a.country}</div>
              </div>
              <div className={styles.addressPin}>PIN {a.pincode}</div>
              <div className={styles.sideFoot}>
                <span>Contact details go to the courier directly.</span>
                <button type="button" className={styles.sideAction} onClick={() => copyText(addressText, M.orderDetail.addressCopied)}>
                  <CopyIcon /> Copy address
                </button>
              </div>
            </CardBody>
          </Card>

          <Card className={`${styles.panel} p-6`}>
            <CardHeader className="p-0 pb-3"><h2 className={styles.sectionTitle}>Payment & refunds</h2></CardHeader>
            <CardBody className="p-0 text-sm text-default-700">
              <dl className={styles.paymentDetails}>
                <div><dt>Method</dt><dd>{paymentMethodLabel(order.paymentMethod)}</dd></div>
                <div><dt>Payment status</dt><dd><StatusChip status={order.paymentStatus || 'pending'} label={paymentStatusLabel(order.paymentStatus)} /></dd></div>
                <div><dt>Your items</dt><dd><strong>₹{inr(order.myItemsSubtotal)}</strong></dd></div>
                {/* Net of courier and gateway charges — the figure that
                    lands in the settlement (services/payouts.sellerLine). */}
                {order.earnings && Number.isFinite(order.earnings.net) && (
                  <div>
                    <dt>Your earnings<small>After courier &amp; gateway charges</small></dt>
                    <dd><strong>₹{inr(order.earnings.net)}</strong></dd>
                  </div>
                )}
              </dl>
              {(order.returnRequests || []).filter((r: any) => r.kind === 'cancellation' && r.refundStatus && r.refundStatus !== 'not-requested').map((r: any) => (
                <div className={styles.refundSummary} key={r._id}>
                  <div><span>Refund <span className="capitalize">{r.refundStatus}</span></span>{r.refundAmount != null && <strong>₹{inr(r.refundAmount)}</strong>}</div>
                  <p>{r.refundStatus === 'completed' ? 'The refund has been completed.' : r.refundStatus === 'requested' || r.refundStatus === 'processing' ? 'Awaiting processing by the platform. Follow its progress in order activity.' : 'Check order activity for refund updates.'}</p>
                  {r.refundReference && <p>Reference: {r.refundReference}</p>}
                </div>
              ))}
              <div className={styles.sideFoot}>
                <Link className={styles.sideAction} href="/dashboard/payouts">View payouts <Arrow /></Link>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      {/* ── Decline return request modal ─────────────────────────────── */}
      <Modal isOpen={declineModal.isOpen} onOpenChange={declineModal.onOpenChange} size="lg">
        <ModalContent>
          {(close) => (
            <>
              <ModalHeader>
                <div className="font-bold">Decline customer request</div>
              </ModalHeader>
              <ModalBody>
                <p className="text-sm text-default-600 mb-3">
                  The customer will see your reason on their order detail page. Be clear and respectful.
                </p>
                <textarea
                  aria-label="Reason for declining the request"
                  rows={4}
                  className="w-full rounded-lg border-2 border-default-200 focus:border-brand-black p-3 text-sm outline-none"
                  placeholder='e.g. "Return window expired" or "Item shows signs of use beyond inspection"'
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                />
              </ModalBody>
              <ModalFooter>
                <Button variant="bordered" onPress={close}>Cancel</Button>
                <Button color="danger" className="font-semibold" isLoading={!!decliningId} onPress={submitDecline}>
                  Send decline
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* ── Courier picker modal ───────────────────────────────────────── */}
      <Modal
        isOpen={courierModal.isOpen}
        onOpenChange={courierModal.onOpenChange}
        size="2xl"
        scrollBehavior="inside"
      >
        <ModalContent>
          {(close) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <div className="font-bold">Pick a courier</div>
                <div className="text-xs text-muted font-normal">
                  {courierMeta.weightKg
                    ? `${courierMeta.weightKg} kg · ${courierMeta.pickup} → ${courierMeta.delivery}`
                    : 'Loading available couriers…'}
                </div>
              </ModalHeader>
              <ModalBody>
                {loadingCouriers ? (
                  <div className="py-8 flex items-center justify-center gap-2 text-muted">
                    <Spinner size="sm" /> Fetching couriers for this route…
                  </div>
                ) : couriers.length === 0 ? (
                  <div className={styles.empty} role="status"><p>No couriers are available for this route right now.</p><Button variant="bordered" onPress={openCourierPicker}>Try again</Button></div>
                ) : (
                  <RadioGroup
                    aria-label="Choose a courier"
                    value={chosenCourier}
                    onValueChange={setChosenCourier}
                    classNames={{ wrapper: 'gap-2' }}
                  >
                    {couriers.map((c: any) => (
                      <Radio
                        key={c.id}
                        value={String(c.id)}
                        description={`ETD ${c.etd}${c.rating ? ` · ${Number(c.rating).toFixed(1)}★` : ''}`}
                        classNames={{
                          base: styles.courierOption,
                          label: 'flex-1',
                        }}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-sm">{c.name}</span>
                          {c.recommended && (
                            <Chip size="sm" color="success" variant="flat" className="font-semibold">
                              Recommended
                            </Chip>
                          )}
                          <span className="text-sm text-default-600">
                            ₹{c.rate}
                            {c.codCharges ? ` + ₹${c.codCharges} COD` : ''}
                          </span>
                        </div>
                      </Radio>
                    ))}
                  </RadioGroup>
                )}
              </ModalBody>
              <ModalFooter className="flex justify-between items-center">
                <div className="text-xs text-muted">
                  Shipping cost is paid from the THROTTLEIN platform wallet — no charge to you.
                </div>
                <div className="flex gap-2">
                  <Button variant="bordered" onPress={close}>Cancel</Button>
                  <Button
                    color="primary"
                    className="font-semibold"
                    isDisabled={!couriers.length}
                    isLoading={updating === 'ship'}
                    onPress={() => shipWithShiprocket(Number(chosenCourier) || null)}
                  >
                    Ship with {couriers.find((c) => String(c.id) === chosenCourier)?.name || 'this courier'}
                  </Button>
                </div>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

/**
 * Self-contained panel that handles every action a seller would otherwise
 * need to do inside Shiprocket's dashboard:
 *   - Download the shipping label PDF (opens in a new tab)
 *   - Download the tax invoice PDF
 *   - Fetch the live tracking timeline
 *   - Cancel the shipment (pre-pickup only)
 */
function ShipmentPanel({
  orderId, info, order, onChange,
}: {
  orderId: string;
  info: any;
  /** Parent order — needed so we can hide "Cancel shipment" once the order
      is delivered (manually or via webhook) or has an active return. */
  order: any;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState<'label' | 'invoice' | 'track' | 'cancel' | 'reschedule' | 'couriers' | null>(null);
  const [track, setTrack] = useState<any>(null);
  /* Changing courier after a failed pickup. Kept in this panel rather than
   * reusing the page's ship picker: that one self-heals a missing
   * Shiprocket push, which cannot apply here — a tracking number already
   * exists, so the shipment is definitely on Shiprocket. */
  const swapModal = useDisclosure();
  const [swapCouriers, setSwapCouriers] = useState<any[]>([]);
  const [swapPick, setSwapPick] = useState<string>('');

  async function downloadPdf(kind: 'label' | 'invoice') {
    setBusy(kind);
    try {
      if (kind === 'invoice') {
        // Our own GST invoice, streamed as a PDF (the label is still Shiprocket's).
        await downloadPdfFile(api, `/seller/orders/${orderId}/invoice`, `Invoice-${order?.orderNumber || orderId}.pdf`);
        return;
      }
      const data = unwrap<any>(await api.get(`/seller/orders/${orderId}/${kind}`));
      if (!data?.url) throw new Error('No URL returned');
      window.open(data.url, '_blank', 'noopener');
    } catch (e: any) {
      notifyError(e, M.orderDetail.couldntFetch(kind));
    } finally {
      setBusy(null);
    }
  }

  async function loadTracking() {
    setBusy('track');
    try {
      const data = unwrap<any>(await api.get(`/seller/orders/${orderId}/track`));
      setTrack(data);
      if (data.ok) onChange();
    } catch (e: any) {
      notifyError(e, M.orderDetail.couldntLoadTracking);
    } finally {
      setBusy(null);
    }
  }

  async function cancelShipment() {
    if (!(await confirmDialog({
      title: 'Cancel this shipment?',
      message:
        'The courier booking is cancelled and the tracking number is voided. The order stays in your dashboard — you can book again with "Ship order". Only works before the courier picks up.',
      destructive: true,
      confirmLabel: 'Cancel shipment',
    }))) return;
    setBusy('cancel');
    try {
      await api.post(`/seller/orders/${orderId}/cancel-shipment`);
      notifySuccess(M.orderDetail.shipmentCancelled);
      onChange();
    } catch (e: any) {
      notifyError(e, M.orderDetail.cancelFailed);
    } finally {
      setBusy(null);
    }
  }

  // Cancel is only valid when the courier hasn't moved the parcel yet AND
  // the order itself isn't already in a terminal state. We also hide it
  // once any return / exchange request is approved (cancelling a forward
  // shipment that's already been received and is being returned makes no
  // sense — the return flow handles that separately).
  const hasActiveReturn = (order?.returnRequests || []).some(
    (r: any) => ['approved', 'completed'].includes(r.status)
  );
  const cancellable =
    info.status === 'awb' &&
    order?.status !== 'delivered' &&
    order?.status !== 'cancelled' &&
    !hasActiveReturn;

  /** Ask for another pickup. `courierId` switches carrier — the current
   *  AWB is released and a new one issued, server-side. */
  async function reschedulePickup(courierId?: number) {
    setBusy('reschedule');
    swapModal.onClose();
    try {
      const { data } = await api.post(
        `/seller/orders/${orderId}/reschedule-pickup`,
        courierId ? { courier_id: courierId } : {},
      );
      if (data?.switched) {
        notifySuccess(M.orderDetail.switchedToTrackingNoPickupBooked(data.awbCourier || 'the new courier', data.awbCode));
      } else {
        notifySuccess(M.orderDetail.pickupBookedAgain(!!data?.already));
      }
      onChange();
    } catch (e: any) {
      notifyError(e, M.orderDetail.couldntRebookThePickup);
    } finally {
      setBusy(null);
    }
  }

  /** Load the courier list for a swap, defaulting to the current one. */
  async function openCourierSwap() {
    setBusy('couriers');
    setSwapCouriers([]);
    try {
      const data = unwrap<any>(await api.get(`/seller/orders/${orderId}/couriers`));
      if (!data.ok || !(data.couriers || []).length) throw new Error('No couriers are available for this route right now');
      setSwapCouriers(data.couriers);
      const current = data.couriers.find((c: any) => Number(c.id) === Number(info.awbCourierId));
      setSwapPick(String((current || data.couriers[0]).id));
      swapModal.onOpen();
    } catch (e: any) {
      notifyError(e, M.orderDetail.couldntLoadCouriers);
    } finally {
      setBusy(null);
    }
  }

  /* UX audit W1: the panel's title, colour and copy come from the same
   * status token as the chip in the page header, so it can never say
   * "Shipment ready" under a "Pickup failed" headline. */
  const token = shipmentStatusToken(info);
  const needsRebook = token.key === 'pickup_failed' || (token.key === 'shipping_error' && !!info.awbCode);
  const delivered = token.key === 'delivered';
  const TONE: Record<string, { box: string; icon: string; title: string; body: string }> = {
    attention: { box: 'border-amber-200 bg-amber-50/60', icon: 'bg-amber-100 text-amber-700', title: 'text-amber-800', body: 'text-amber-900' },
    negative:  { box: 'border-rose-200 bg-rose-50/60',   icon: 'bg-rose-100 text-rose-700',   title: 'text-rose-800',  body: 'text-rose-900' },
    info:      { box: 'border-sky-200 bg-sky-50/60',     icon: 'bg-sky-100 text-sky-700',     title: 'text-sky-800',   body: 'text-sky-900' },
    positive:  { box: 'border-emerald-200 bg-emerald-50/60', icon: 'bg-emerald-100 text-emerald-700', title: 'text-emerald-800', body: 'text-emerald-900' },
    neutral:   { box: 'border-default-200 bg-default-50', icon: 'bg-default-100 text-default-700', title: 'text-default-800', body: 'text-default-900' },
  };
  const toneOf: Record<string, keyof typeof TONE> = {
    awaiting_pickup: 'attention', pickup_failed: 'negative', shipping_error: 'negative',
    in_transit: 'info', out_for_delivery: 'info', delivered: 'positive', delivery_failed: 'negative',
    returning: 'negative', returned: 'neutral', lost: 'negative', cancelled: 'neutral',
  };
  const tone = TONE[toneOf[token.key] || 'neutral'];
  const fmtDay = (d?: string | null) => d ? formatDayMonth(d) : '';
  const copy: Record<string, string> = {
    awaiting_pickup: `Print the label and keep the parcel packed${info.pickupScheduledAt ? ` — pickup expected ${fmtDay(info.pickupScheduledAt)}` : ''}. Status changes to In transit when the courier scans it.`,
    pickup_failed: `The courier did not collect the parcel${token.detail ? ` (courier says: ${token.detail})` : ''}. Keep it packed and book the pickup again.`,
    shipping_error: `The label is ready but the courier booking failed${info.pickupError ? `: ${info.pickupError}` : ''}. Book the pickup again.`,
    in_transit: 'On its way to the customer. Tracking updates here automatically.',
    out_for_delivery: 'With the delivery rider now. Tracking updates here automatically.',
    delivered: 'Delivered to the customer.',
    delivery_failed: `The courier could not deliver${token.detail ? ` (${token.detail})` : ''}. Choose what to do next under Delivery issues.`,
    returning: 'The parcel is coming back to your pickup address.',
    returned: 'The parcel is back with you.',
    lost: 'The courier has marked this parcel lost. Contact support to raise a claim.',
    cancelled: 'This shipment was cancelled.',
  };

  return (
    <div className={styles.shipment}>
      <div className="flex items-start gap-3">
        <div className={`w-9 h-9 rounded-lg grid place-items-center shrink-0 ${tone.icon}`}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="3" width="15" height="13" />
            <polygon points="16 8 20 8 23 11 23 16 16 16 16 8" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-semibold ${tone.title}`}>
            {token.label}
          </div>
          <div className={styles.shipmentMeta}>
            {info.awbCourier && <span>{info.awbCourier}</span>}
            <span>
              Tracking no. <span className="font-mono">{info.awbCode}</span>
              <button type="button" className={styles.copyBtn} onClick={() => copyText(String(info.awbCode), M.orderDetail.trackingCopied)} aria-label="Copy tracking number">
                <CopyIcon /> Copy
              </button>
            </span>
          </div>
          <div className={styles.shipmentDescription}>
            {copy[token.key] || (token.detail ? `Courier says: ${token.detail}.` : '')}
          </div>
        </div>
      </div>

      {/* Actions row */}
      <div className={styles.shipmentActions}>
        {needsRebook && (
          <>
            <Button
              size="sm"
              color="danger"
              className="font-semibold"
              isLoading={busy === 'reschedule'}
              onPress={() => reschedulePickup()}
            >
              Book pickup again
            </Button>
            {/* The same courier failing twice usually means it will fail
                again. Switching is the other real option — and without it
                sellers reach for "Cancel shipment", which on a paid order
                also refunds the customer. */}
            <Button
              size="sm"
              variant="bordered"
              className="font-semibold border-2"
              isLoading={busy === 'couriers'}
              onPress={openCourierSwap}
            >
              Try a different courier
            </Button>
          </>
        )}
        {/* The label is the main thing to print until the parcel leaves;
            once it is delivered the invoice is what a seller comes back
            for, so the emphasis (and the order) swaps. */}
        {(() => {
          const labelBtn = (
            <Button
              key="label"
              size="sm"
              color={needsRebook || delivered ? 'default' : 'primary'}
              variant={needsRebook || delivered ? 'bordered' : 'solid'}
              className={`font-semibold ${needsRebook || delivered ? 'border-2' : ''}`}
              isLoading={busy === 'label'}
              onPress={() => downloadPdf('label')}
              startContent={<DownloadIcon />}
            >
              {delivered ? 'Label' : 'Download label'}
            </Button>
          );
          const invoiceBtn = (
            <Button
              key="invoice"
              size="sm"
              color={delivered ? 'primary' : 'default'}
              variant={delivered ? 'solid' : 'bordered'}
              className={`font-semibold ${delivered ? '' : 'border-2'}`}
              isLoading={busy === 'invoice'}
              onPress={() => downloadPdf('invoice')}
              startContent={delivered ? <DownloadIcon /> : undefined}
            >
              {delivered ? 'Download invoice' : 'Invoice'}
            </Button>
          );
          return delivered ? [invoiceBtn, labelBtn] : [labelBtn, invoiceBtn];
        })()}
        <Button
          size="sm"
          variant="bordered"
          className="font-semibold border-2"
          isLoading={busy === 'track'}
          onPress={loadTracking}
        >
          {track ? 'Refresh tracking' : 'Show tracking'}
        </Button>
        {cancellable && (
          <Button
            size="sm"
            variant="flat"
            color="danger"
            className="font-semibold ml-auto"
            isLoading={busy === 'cancel'}
            onPress={cancelShipment}
          >
            Cancel shipment
          </Button>
        )}
      </div>

      {/* Tracking timeline */}
      {track?.ok && (
        <div className="mt-4 rounded-lg border border-default-200 bg-white p-3">
          <div className="text-sm font-semibold text-foreground mb-2">
            Tracking · {track.currentStatusLabel || track.currentStatus || 'updating'}
            {track.etd && <span className="text-muted font-normal"> · ETA {track.etd}</span>}
          </div>
          {track.events.length === 0 ? (
            <div className="text-xs text-muted">No movement yet — check back after the courier picks up.</div>
          ) : (
            <ol className="space-y-2.5">
              {track.events.map((e: any, i: number) => (
                <li key={i} className="flex items-start gap-3 text-xs">
                  <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${i === 0 ? 'bg-emerald-500 ring-4 ring-emerald-100' : 'bg-default-300'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-brand-black">{e.activity || e.status}</div>
                    <div className="text-muted mt-0.5">
                      {e.location && <>{e.location} · </>}
                      {e.date}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
      {track && !track.ok && (
        <div className="mt-3 text-xs text-rose-700">
          Tracking unavailable {track.error ? `(${track.error})` : ''}. The courier may not have scanned the parcel yet.
        </div>
      )}

      {/* Courier swap — releases the current tracking number and issues a
          new one, so the consequence is stated before it happens. */}
      <Modal isOpen={swapModal.isOpen} onOpenChange={swapModal.onOpenChange} size="lg">
        <ModalContent>
          {(close) => (
            <>
              <ModalHeader>
                <div>
                  <div className="font-bold">Try a different courier</div>
                  <div className="text-xs font-normal text-default-500 mt-0.5">
                    Tracking no. {info.awbCode} is cancelled and a new one issued. Print the new label before handing the parcel over.
                  </div>
                </div>
              </ModalHeader>
              <ModalBody>
                <RadioGroup aria-label="Choose a replacement courier" value={swapPick} onValueChange={setSwapPick}>
                  {swapCouriers.map((c: any) => {
                    const current = Number(c.id) === Number(info.awbCourierId);
                    return (
                      <Radio classNames={{base:styles.courierOption}} key={c.id} value={String(c.id)} description={
                        `${c.etd || 'ETA not quoted'}${c.rate != null ? ` · ₹${c.rate}` : ''}${current ? ' · the one that failed' : ''}`
                      }>
                        {c.name}
                      </Radio>
                    );
                  })}
                </RadioGroup>
              </ModalBody>
              <ModalFooter>
                <Button variant="bordered" onPress={close}>Keep current courier</Button>
                <Button
                  color="primary"
                  className="font-semibold"
                  isDisabled={!swapPick || Number(swapPick) === Number(info.awbCourierId)}
                  isLoading={busy === 'reschedule'}
                  onPress={() => reschedulePickup(Number(swapPick))}
                >
                  Switch and book pickup
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
