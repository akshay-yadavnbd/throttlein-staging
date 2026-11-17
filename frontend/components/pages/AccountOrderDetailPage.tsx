'use client';

import { use, useEffect, useState } from 'react';
import { useOrderPolling } from '@/lib/useOrderPolling';
import { shipmentDisplayStatus, forwardSlices, orderStatusToken, paymentMethodLabel, paymentStatusLabel, type StatusKey } from '@/lib/orderStatusDisplay';
import Link from 'next/link';
import {
  Button, Spinner,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure,
  Textarea, Checkbox,
} from '@heroui/react';
import CustomerShell from '@/components/common/CustomerShell';
import StatusChip from '@/components/ui/StatusChip';
import { Thumb, panelLinkClass, primaryButtonClass, secondaryButtonClass } from '@/components/common/AccountUI';
import { formatDate } from '@/lib/dates';
import OrderTrackerVertical, { buildSectionsFromOrder } from '@/components/common/OrderTrackerVertical';
import { customerApi } from '@/lib/customerApi';
import { downloadPdf } from '@/lib/downloadPdf';
import { imageUrl, unwrap } from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';

type Order = any;

// Pre-built reason chips so customers can answer in two clicks.
const REASON_CODES = [
  { code: 'size-issue', label: "Size doesn't fit" },
  { code: 'damaged', label: 'Arrived damaged' },
  { code: 'wrong-item', label: 'Wrong item' },
  { code: 'not-as-desc', label: 'Not as described' },
  { code: 'changed-mind', label: 'Changed my mind' },
  { code: 'other', label: 'Other' },
];

const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n);

/** "Tuesday, 27 Jun" — used for delivered/cancelled dates in the new
 *  "Order Summary" card. */
function weekdayDate(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });
}

/**
 * Estimated delivery date for in-flight orders — same fallback chain as
 * the inline IIFE further down the page (real ETD from the forward
 * shipment, else +5 days from ship date, else +7 days from order date).
 * Duplicated here (rather than shared) so the existing block below is
 * left completely untouched.
 */
function estimateDelivery(order: any): Date | null {
  const etds = forwardSlices(order).filter(s => s.status !== 'cancelled' && s.status !== 'delivered')
    .map(s => s.etd ? new Date(s.etd).getTime() : NaN).filter(Number.isFinite);
  const realEtd = etds.length ? new Date(Math.max(...etds)) : null;
  return realEtd;
}

/**
 * Same section-building logic as the inline IIFE further down the page
 * (forward shipment + latest approved/completed return → sections for
 * OrderTrackerVertical). Duplicated here — rather than refactoring the
 * existing block to share it — so the "Track Order" modal can render the
 * tracker without touching any already-working code.
 */
function ParcelTrackers({ order }: { order: any }) {
  const slices = forwardSlices(order);
  if (!slices.length) return <OrderTrackerVertical sections={buildSectionsFromOrder({ order })} />;
  return <div className="space-y-4">{slices.map((forward: any, index) => {
    const request = [...(order.returnRequests || [])]
      .filter((r: any) => String(r.seller) === String(forward.seller) && ['approved', 'completed'].includes(r.status))
      .sort((a: any, b: any) => new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime())[0];
    const ret = (order.sellerShipments || []).find((s: any) => String(s._id) === String(request?.returnShipmentEntryId));
    const replacement = (order.sellerShipments || []).find((s: any) => String(s._id) === String(request?.replacementShipmentEntryId));
    const itemNames = (order.items || []).filter((it: any) => String(it.seller) === String(forward.seller)).map((it: any) => it.name).join(', ');
    return <section key={forward._id || index} className="space-y-2">
      <h3 className="text-sm font-semibold">Parcel {index + 1} · {shipmentDisplayStatus(forward, 'customer')}</h3>
      <p className="text-xs text-default-600">{itemNames}</p>
      {forward.etd && <p className="text-xs text-default-600">Estimated delivery: {new Date(forward.etd).toLocaleDateString('en-IN')}</p>}
      {forward.trackingSyncedAt && <p className="text-xs text-default-500">Tracking checked: {new Date(forward.trackingSyncedAt).toLocaleString('en-IN')}</p>}
      <OrderTrackerVertical sections={buildSectionsFromOrder({
        order, forwardShipment: forward, returnRequest: request,
        returnShipment: ret, replacementShipment: replacement,
      })} />
    </section>;
  })}</div>;
}

export default function AccountOrderDetailPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const { orderNumber: id } = use(params);
  // `id` is the orderNumber string (e.g. TIN-2026-000001). Kept as `id` here
  // so the rest of the file's API calls work unchanged — the backend accepts
  // either ObjectId or orderNumber.
  const [order, setOrder] = useState<Order | null>(null);
  const [sellerPolicy, setSellerPolicy] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  // Seller id of the parcel whose invoice is downloading.
  const [downloadingInvoice, setDownloadingInvoice] = useState<string | null>(null);

  // "Track Order" modal — opened from the new Order Summary card's
  // Track Order button, shows the same vertical tracker rendered inline
  // further down the page.
  const trackModal = useDisclosure();

  // Return / exchange modal state
  const returnModal = useDisclosure();
  const [reqKind, setReqKind] = useState<'return' | 'exchange'>('return');
  const [reqSellerId, setReqSellerId] = useState<string>('');
  const [reqItems, setReqItems] = useState<Record<string, boolean>>({});
  const [reqReasonCode, setReqReasonCode] = useState('size-issue');
  const [reqReason, setReqReason] = useState('');
  const [reqDesiredAction, setReqDesiredAction] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Evidence uploads — only used when reasonCode is one of the codes below.
  const [evidence, setEvidence] = useState<{ url: string; kind: 'image' | 'video'; mimeType: string; sizeBytes: number }[]>([]);
  const [uploading, setUploading] = useState(false);
  // COD refund destination — only used when the order was COD AND kind=return.
  // Customer can either give UPI (preferred) or full bank details.
  const [refundChannel, setRefundChannel] = useState<'upi' | 'bank'>('upi');
  const [refundUpi, setRefundUpi] = useState('');
  const [refundBank, setRefundBank] = useState({ bankName: '', accountNo: '', ifsc: '' });

  // ─── Product review state ─────────────────────────────────────────
  // Customer can rate + write a comment for each item once the order
  // reaches `delivered`. The map below caches existing reviews keyed by
  // productId so the buttons can flip between "Leave a review" and
  // "Edit your review", and re-submits update rather than duplicate.
  const reviewModal = useDisclosure();
  const [myReviews, setMyReviews] = useState<Record<string, any>>({});
  const [reviewItem, setReviewItem] = useState<any | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewHover, setReviewHover] = useState(0);
  // "Rate your Order" banner — a single star row above the items list
  // that kicks off the same review modal for whichever item hasn't been
  // reviewed yet (falls back to the first item if everything's reviewed).
  const [orderRatingHover, setOrderRatingHover] = useState(0);

  function startOrderReview(prefillRating = 0) {
    const target = order?.items?.find((it: any) => !myReviews[String(it.product)]) || order?.items?.[0];
    if (!target) return;
    openReviewModal(target);
    if (prefillRating > 0) setReviewRating(prefillRating);
  }
  const [reviewTitle, setReviewTitle] = useState('');
  const [reviewComment, setReviewComment] = useState('');
  const [reviewSaving, setReviewSaving] = useState(false);
  // Optional photos attached to the review — same two-step
  // upload-then-submit flow as ProductDetailPage's "Write a review"
  // modal: pick a file, it uploads immediately, and the returned
  // key/path is stashed here ready to send with the final POST /reviews.
  const [reviewImages, setReviewImages] = useState<string[]>([]);
  const [reviewImagesUploading, setReviewImagesUploading] = useState(false);

  async function handleReviewImagePick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files || []);
    e.target.value = '';
    if (!picked.length) return;
    const remaining = 6 - reviewImages.length;
    if (remaining <= 0) return;
    const toUpload = picked.slice(0, remaining);
    const fd = new FormData();
    toUpload.forEach((f) => fd.append('images', f));
    setReviewImagesUploading(true);
    try {
      const data = unwrap<any>(await customerApi.post('/reviews/uploads/images', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }));
      setReviewImages((prev) => [...prev, ...(data.images || [])].slice(0, 6));
    } catch (e: any) {
      notifyError(e, M.accountOrderDetail.couldntUploadPhoto);
    } finally {
      setReviewImagesUploading(false);
    }
  }

  function removeReviewImage(idx: number) {
    setReviewImages((prev) => prev.filter((_, i) => i !== idx));
  }

  function load() {
    setLoading(true);
    customerApi
      .get(`/orders/${id}`)
      .then((r) => {
        const data = unwrap<any>(r);
        setOrder(data.order);
        setSellerPolicy(data.sellerPolicy || {});
        // Fan-out: once we know the order's _id, fetch the customer's
        // existing reviews for the items in this order. Keyed by
        // productId so the per-item button can flip state.
        return customerApi.get('/reviews/mine', {
          params: { orderId: data.order._id },
        });
      })
      .then((res) => {
        const map: Record<string, any> = {};
        for (const r of (res ? unwrap<{ reviews?: any[] }>(res).reviews : undefined) || []) {
          map[String(r.product)] = r;
        }
        setMyReviews(map);
      })
      .catch(() => {
        // /reviews/mine 404s if order wasn't found — same handler closes
        // the loader so the UI doesn't hang.
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, [id]);
  useOrderPolling(async signal => {
    const data = unwrap<any>(await customerApi.get(`/orders/${id}`, { signal }));
    setOrder(data.order);
    setSellerPolicy(data.sellerPolicy || {});
  }, id);

  /* ─── Review modal handlers ───────────────────────────────────── */

  function openReviewModal(item: any) {
    setReviewItem(item);
    const existing = myReviews[String(item.product)];
    if (existing) {
      // Editing: keep the customer's previous values.
      setReviewRating(existing.rating || 0);
      setReviewHover(0);
      setReviewTitle(existing.title || '');
      setReviewComment(existing.comment || '');
      setReviewImages(Array.isArray(existing.images) ? existing.images : []);
    } else {
      // New review: start at 0 so the customer has to make a
      // deliberate choice rather than accepting a default 5★.
      setReviewRating(0);
      setReviewHover(0);
      setReviewTitle('');
      setReviewComment('');
      setReviewImages([]);
    }
    reviewModal.onOpen();
  }

  async function submitReview() {
    if (!reviewItem) return;
    if (reviewRating < 1) {
      notifyWarning(M.accountOrderDetail.pleaseSelectARatingFrom1To);
      return;
    }
    if (!reviewComment.trim()) {
      notifyWarning(M.accountOrderDetail.pleaseWriteAShortCommentAboutThe);
      return;
    }
    // Guard against submitting while a photo upload is still in flight —
    // otherwise "Post review" could fire before every picked photo has
    // finished uploading.
    if (reviewImagesUploading) {
      notifyWarning(M.accountOrderDetail.pleaseWaitForYourPhotosToFinish);
      return;
    }
    setReviewSaving(true);
    try {
      const data = unwrap<any>(await customerApi.post('/reviews', {
        productId: reviewItem.product,
        orderId: order?._id,
        rating: reviewRating,
        title: reviewTitle.trim(),
        comment: reviewComment.trim(),
        images: reviewImages,
      }));
      // Optimistically update the local cache so the button label
      // flips to "Edit your review" without a full reload.
      setMyReviews((prev) => ({
        ...prev,
        [String(reviewItem.product)]: data.review,
      }));
      notifySuccess(M.accountOrderDetail.reviewSaved(!!myReviews[String(reviewItem.product)]));
      reviewModal.onClose();
    } catch (e: any) {
      notifyError(e, M.accountOrderDetail.couldntSaveReview);
    } finally {
      setReviewSaving(false);
    }
  }

  /** Deletes the caller's own review for a product (scoped server-side to
   *  `{product, customer}`), then drops it from the local `myReviews`
   *  cache so the "Edit review" buttons flip back to "Write a review". */
  async function deleteReview(productId: string) {
    if (!(await confirmDialog({
      title: 'Delete this review?',
      message: 'This will permanently remove your review for this product.',
      destructive: true,
      confirmLabel: 'Delete review',
      cancelLabel: 'Keep review',
    }))) return;
    try {
      await customerApi.delete(`/reviews/${productId}`);
      setMyReviews((prev) => {
        const next = { ...prev };
        delete next[String(productId)];
        return next;
      });
      notifySuccess(M.accountOrderDetail.reviewDeleted);
    } catch (e: any) {
      notifyError(e, M.accountOrderDetail.couldntDeleteReview);
    }
  }

  // Each seller invoices their own parcel, and only once it's delivered —
  // the API streams the GST invoice PDF for the chosen seller.
  async function downloadInvoice(sellerId: string) {
    setDownloadingInvoice(sellerId);
    try {
      await downloadPdf(customerApi, `/orders/${id}/invoice?seller=${encodeURIComponent(sellerId)}`, `Invoice-${order?.orderNumber || id}.pdf`);
    } catch (e: any) {
      notifyError(e, M.accountOrderDetail.couldntDownloadTheInvoice);
    } finally {
      setDownloadingInvoice(null);
    }
  }

  async function cancel() {
    if (!(await confirmDialog({
      title: 'Cancel this order?',
      message: 'This will cancel the order and restore product stock. You can place a new order anytime.',
      destructive: true,
      confirmLabel: 'Cancel order',
      cancelLabel: 'Keep order',
    }))) return;
    setCancelling(true);
    try {
      await customerApi.post(`/orders/${id}/cancel`);
      notifySuccess(M.accountOrderDetail.orderCancelled);
      load();
    } catch (e: any) {
      notifyError(e, M.accountOrderDetail.couldntCancel);
    } finally {
      setCancelling(false);
    }
  }

  /** Sellers that ship items in this order, with their per-seller item slice. */
  function sellersInOrder(): { sellerId: string; items: any[]; policy: any }[] {
    if (!order) return [];
    const map = new Map<string, any[]>();
    for (const it of order.items || []) {
      const k = String(it.seller || '');
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(it);
    }
    return Array.from(map.entries()).map(([sellerId, items]) => ({
      sellerId, items, policy: sellerPolicy[sellerId] || {},
    }));
  }

  /** Is a given seller still inside their return window? */
  function withinWindow(sellerId: string, kind: 'return' | 'exchange'): boolean {
    const p = sellerPolicy[sellerId];
    if (!p) return false;
    const days = kind === 'exchange' ? p.exchangePolicyDays : p.returnPolicyDays;
    if (!days || days === 0) return false;
    const deliveredAt = order?.deliveredAt || order?.updatedAt || order?.createdAt;
    if (!deliveredAt) return false;
    const cutoff = new Date(deliveredAt).getTime() + days * 86400000;
    return Date.now() <= cutoff;
  }

  /** Existing pending/approved request for a given seller (one at a time). */
  function existingRequestFor(sellerId: string): any | null {
    return (order?.returnRequests || []).find(
      (r: any) => String(r.seller) === String(sellerId)
        && ['pending', 'approved'].includes(r.status)
    ) || null;
  }

  function openRequestModal(sellerId: string, kind: 'return' | 'exchange') {
    setReqKind(kind);
    setReqSellerId(sellerId);
    setReqReasonCode(kind === 'exchange' ? 'size-issue' : 'damaged');
    setReqReason('');
    setReqDesiredAction('');
    setEvidence([]);
    setRefundChannel('upi');
    setRefundUpi('');
    setRefundBank({ bankName: '', accountNo: '', ifsc: '' });
    // Pre-select all items from this seller.
    const items = (order.items || []).filter((it: any) => String(it.seller) === sellerId);
    setReqItems(Object.fromEntries(items.map((it: any) => [String(it.product), true])));
    returnModal.onOpen();
  }

  // Only ask for refund details if it's a COD return (online refunds happen
  // automatically through Razorpay).
  const refundChannelNeeded = reqKind === 'return' && order?.paymentMethod === 'cod';

  /**
   * Upload evidence files immediately when the customer picks them. We get
   * back canonical URLs and store them in state so the modal can preview
   * thumbnails. URLs go with the submit call.
   */
  async function handleEvidencePick(files: FileList | null) {
    if (!files || !files.length) return;
    // Cap total to 6 (matches backend multer limit).
    const remaining = 6 - evidence.length;
    if (remaining <= 0) {
      notifyWarning(M.accountOrderDetail.youCanUploadAtMost6Files);
      return;
    }
    const picked = Array.from(files).slice(0, remaining);
    const fd = new FormData();
    picked.forEach((f) => fd.append('files', f));
    setUploading(true);
    try {
      const data = unwrap<any>(await customerApi.post('/uploads/return-evidence', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }));
      setEvidence((prev) => [...prev, ...(data.attachments || [])]);
    } catch (e: any) {
      notifyError(e, M.accountOrderDetail.couldntUpload);
    } finally {
      setUploading(false);
    }
  }

  function removeEvidence(idx: number) {
    setEvidence((prev) => prev.filter((_, i) => i !== idx));
  }

  // Reasons that warrant evidence — damage / wrong-item / not-as-described.
  // "Size doesn't fit" and "Changed my mind" don't need photos.
  const evidenceReasonCodes = new Set(['damaged', 'wrong-item', 'not-as-desc']);
  const evidenceRequired = evidenceReasonCodes.has(reqReasonCode);

  async function submitRequest() {
    if (!order || !reqSellerId) return;
    const items = Object.entries(reqItems)
      .filter(([, on]) => on)
      .map(([productId]) => ({ product: productId, quantity: 1 }));
    if (!items.length) {
      notifyWarning(M.accountOrderDetail.pickAtLeastOneItem);
      return;
    }
    if (reqReason.trim().length < 5 && reqReasonCode === 'other') {
      notifyWarning(M.accountOrderDetail.tellUsABitMoreAtLeast);
      return;
    }
    if (reqKind === 'exchange' && !reqDesiredAction.trim()) {
      notifyWarning(M.accountOrderDetail.pleaseTellTheSellerWhatYoudLike);
      return;
    }
    if (evidenceRequired && evidence.length === 0) {
      notifyWarning(M.accountOrderDetail.pleaseAttachAtLeastOnePhotoOr);
      return;
    }
    // COD return: validate refund destination before submitting.
    if (refundChannelNeeded) {
      if (refundChannel === 'upi') {
        if (!/^[\w.\-]+@[\w]+$/.test(refundUpi.trim())) {
          notifyWarning(M.accountOrderDetail.enterAValidUPIIDEG);
          return;
        }
      } else {
        if (!refundBank.bankName.trim() || !refundBank.accountNo.trim() || !refundBank.ifsc.trim()) {
          notifyWarning(M.accountOrderDetail.fillInBankNameAccountNumberAnd);
          return;
        }
      }
    }
    setSubmitting(true);
    try {
      await customerApi.post(`/orders/${id}/return-request`, {
        kind: reqKind,
        sellerId: reqSellerId,
        reasonCode: reqReasonCode,
        reason: reqReason,
        desiredAction: reqDesiredAction,
        items,
        attachments: evidence,
        // COD refund destination — only sent for return + cod.
        ...(refundChannelNeeded
          ? refundChannel === 'upi'
            ? { refundUpi: refundUpi.trim() }
            : {
              refundBankName: refundBank.bankName.trim(),
              refundAccountNo: refundBank.accountNo.trim(),
              refundIfsc: refundBank.ifsc.trim().toUpperCase(),
            }
          : {}),
      });
      notifySuccess(M.accountOrderDetail.requestSubmitted(reqKind === 'exchange' ? 'Exchange' : 'Return'));
      returnModal.onClose();
      load();
    } catch (e: any) {
      notifyError(e, M.accountOrderDetail.requestFailed);
    } finally {
      setSubmitting(false);
    }
  }

  async function cancelRequest(reqId: string) {
    if (!(await confirmDialog({
      title: 'Cancel this request?',
      message: 'You can submit a new one later if you change your mind.',
      destructive: true,
      confirmLabel: 'Cancel request',
      cancelLabel: 'Keep it',
    }))) return;
    try {
      await customerApi.post(`/orders/${id}/return-request/${reqId}/cancel`);
      notifySuccess(M.accountOrderDetail.requestCancelled);
      load();
    } catch (e: any) {
      notifyError(e, M.accountOrderDetail.cancelFailed);
    }
  }

  if (loading) {
    return (
      <CustomerShell>
        <div aria-busy="true" aria-label="Loading order">
          <div className="h-3 w-24 animate-pulse rounded bg-[#e9ece8]" />
          <div className="mt-3 h-7 w-64 animate-pulse rounded bg-[#e9ece8]" />
          <div className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="space-y-5">
              <div className="h-44 animate-pulse rounded-2xl bg-white" />
              <div className="h-56 animate-pulse rounded-2xl bg-white" />
            </div>
            <div className="space-y-5">
              <div className="h-60 animate-pulse rounded-2xl bg-white" />
              <div className="h-32 animate-pulse rounded-2xl bg-white" />
            </div>
          </div>
        </div>
      </CustomerShell>
    );
  }
  if (!order) {
    return (
      <CustomerShell>
        <div className="rounded-2xl border border-dashed border-[#d5dbe0] bg-white px-6 py-14 text-center">
          <p className="text-sm font-semibold text-[#252c32]">We couldn’t find that order</p>
          <p className="mx-auto mt-1 max-w-xs text-[13px] text-[#74808a]">It may belong to another account, or the link is wrong.</p>
          <Link href="/account/orders" className={`${primaryButtonClass} mt-4`}>
            See your orders
          </Link>
        </div>
      </CustomerShell>
    );
  }

  const canCancel = ['placed', 'confirmed'].includes(order.status);
  const a = order.shippingAddress || {};
  const status = orderStatusToken(order, null, 'customer');
  const step = progressStep(order, status.key);
  const isDelivered = order.status === 'delivered';
  const isCancelled = order.status === 'cancelled';
  const parcels = forwardSlices(order);
  const deliveredParcels = parcels.filter((s: any) => s.status === 'delivered');
  const eta = estimateDelivery(order);
  const units = (order.items || []).reduce((s: number, it: any) => s + (it.quantity || 1), 0);

  // Money, from the order's own fields: total = items + delivery + COD fee.
  // Prices include GST, so there is no separate tax line to add.
  const mrpTotal = (order.items || []).reduce(
    (s: number, it: any) => s + (Number(it.mrp) || Number(it.price) || 0) * (it.quantity || 1),
    0,
  );
  const deliveryCharges = order.shippingFee || 0;
  const discount = Math.max(0, mrpTotal - (order.itemsTotal || 0));
  const codFee = order.codFee || Math.max(0, (order.total || 0) - (order.itemsTotal || 0) - deliveryCharges);
  const paymentLine =
    order.paymentInstrument?.method === 'emi'
      ? [
          'EMI',
          order.paymentInstrument.emi?.tenureMonths && `${order.paymentInstrument.emi.tenureMonths} months`,
          order.paymentInstrument.emi?.issuer || order.paymentInstrument.bank,
        ]
          .filter(Boolean)
          .join(' · ')
      : paymentMethodLabel(order.paymentMethod);

  // "Rate your order" picks the first item not yet reviewed (else the first item).
  const reviewTarget = (order.items || []).find((it: any) => !myReviews[String(it.product)]) || order.items?.[0];
  const reviewTargetReview = reviewTarget ? myReviews[String(reviewTarget.product)] : null;
  const allReviewed = (order.items || []).every((it: any) => myReviews[String(it.product)]);
  const ratingShown = orderRatingHover || reviewTargetReview?.rating || 0;

  return (
    <CustomerShell>
      <Link href="/account/orders" className="inline-flex items-center gap-1 text-xs font-medium text-[#74808a] hover:text-[#252c32]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5" aria-hidden>
          <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        All orders
      </Link>
      <header className="mb-5 mt-2 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold tabular-nums tracking-[-0.02em] text-[#252c32] sm:text-2xl">
              {order.orderNumber}
            </h1>
            <StatusChip label={status.label} status={status.key} />
          </div>
          <p className="mt-1 text-[13px] text-[#74808a]">
            Placed {formatDate(order.createdAt)} · {units} item{units === 1 ? '' : 's'} · ₹{inr(order.total)}
          </p>
        </div>
      </header>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* ─── MAIN COLUMN ─── */}
        <div className="flex min-w-0 flex-col gap-5">
          {/* Where it is */}
          <section className="overflow-hidden rounded-2xl border border-[#e3e7eb] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <div className="flex items-start gap-4 p-5">
              <span
                className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${
                  isDelivered ? 'bg-[#eef3e3] text-[#4b6b16]' : isCancelled ? 'bg-[#fff1ee] text-[#a3392b]' : 'bg-[#141414] text-white'
                }`}
              >
                {isDelivered ? <CheckIcon /> : isCancelled ? <CrossIcon /> : <TruckIcon />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold text-[#252c32]">
                  {isDelivered
                    ? `Delivered on ${weekdayDate(order.deliveredAt || order.updatedAt)}`
                    : isCancelled
                      ? `Cancelled on ${weekdayDate(order.cancelledAt || order.updatedAt)}`
                      : eta
                        ? `Arriving by ${weekdayDate(eta)}`
                        : status.label}
                </p>
                <p className="mt-0.5 text-[13px] text-[#74808a]">
                  {isDelivered
                    ? `To ${a.fullName || 'you'}, ${a.city || ''}`
                    : isCancelled
                      ? order.paymentStatus === 'paid' || order.paymentStatus === 'refunded'
                        ? 'Your payment is refunded to the original method.'
                        : 'Nothing was charged for this order.'
                      : eta
                        ? `${status.key === 'multiple' ? `${parcels.length} parcels` : status.label} · courier’s estimate`
                        : 'We’ll show a delivery date once the courier has it.'}
                </p>
              </div>
            </div>

            {step !== null && !isCancelled && (
              <ol className="grid grid-cols-4 px-5 pb-5" aria-label="Order progress">
                {PROGRESS.map((label, i) => {
                  const done = i <= step;
                  return (
                    <li key={label} className="relative flex flex-col items-center text-center" aria-current={i === step ? 'step' : undefined}>
                      {i > 0 && <span aria-hidden className={`absolute right-1/2 top-[7px] h-0.5 w-full ${done ? 'bg-[#141414]' : 'bg-[#e3e7eb]'}`} />}
                      <span
                        aria-hidden
                        className={`relative grid h-4 w-4 place-items-center rounded-full ${done ? 'bg-[#141414]' : 'border-2 border-[#d5dbe0] bg-white'} ${
                          i === step && step < 3 ? 'ring-4 ring-[#141414]/10' : ''
                        }`}
                      >
                        {done && (
                          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" className="h-2.5 w-2.5">
                            <path d="m5 12 5 5 9-10" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </span>
                      <span className={`mt-2 text-[11px] ${done ? 'font-semibold text-[#252c32]' : 'text-[#9aa3ab]'}`}>{label}</span>
                    </li>
                  );
                })}
              </ol>
            )}

            {parcels.length > 0 && (
              <ul className="divide-y divide-[#edf0f2] border-t border-[#edf0f2]" aria-label="Parcels">
                {parcels.map((s: any, i: number) => (
                  <li key={s._id || i} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3 text-xs">
                    <span className="font-semibold text-[#252c32]">
                      {parcels.length > 1 ? `Parcel ${i + 1}` : 'Your parcel'}
                      {parcels.length > 1 && sellerPolicy[String(s.seller)]?.storeName && (
                        <span className="font-normal text-[#74808a]"> · {sellerPolicy[String(s.seller)].storeName}</span>
                      )}
                    </span>
                    <span className="text-[#5d6871]">
                      {shipmentDisplayStatus(s, 'customer')}
                      {s.awbCode && <span className="ml-2 tabular-nums text-[#9aa3ab]">AWB {s.awbCode}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap gap-2 border-t border-[#edf0f2] bg-[#fafbfa] px-5 py-3">
              <button type="button" className={primaryButtonClass} onClick={trackModal.onOpen}>
                {isDelivered || isCancelled ? 'See order history' : 'Track order'}
              </button>
              {canCancel && (
                <button
                  type="button"
                  onClick={cancel}
                  disabled={cancelling}
                  className="inline-flex items-center justify-center rounded-lg px-3.5 py-2 text-xs font-semibold text-[#a3392b] transition hover:bg-[#fff1ee] disabled:opacity-60"
                >
                  {cancelling ? 'Cancelling…' : 'Cancel order'}
                </button>
              )}
            </div>
          </section>

          {/* Rate it — once it has arrived */}
          {isDelivered && reviewTarget && (
            <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-[#e3e7eb] bg-[#f6f7f2] p-5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-[#252c32]">{allReviewed ? 'Thanks for your reviews' : 'How was your order?'}</p>
                <p className="mt-0.5 text-xs text-[#74808a]">
                  {allReviewed ? 'You can edit them any time.' : 'Your rating helps other riders choose.'}
                </p>
              </div>
              <div className="flex items-center gap-0.5" onMouseLeave={() => setOrderRatingHover(0)}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => startOrderReview(n)}
                    onMouseEnter={() => setOrderRatingHover(n)}
                    aria-label={`Rate ${n} star${n === 1 ? '' : 's'}`}
                    className="rounded p-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#59656f]"
                  >
                    <StarIcon filled={n <= ratingShown} />
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Items */}
          <section className="overflow-hidden rounded-2xl border border-[#e3e7eb] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
            <h2 className="px-5 pb-3 pt-5 text-sm font-semibold text-[#252c32]">
              Items <span className="font-normal text-[#9aa3ab]">({order.items.length})</span>
            </h2>
            <ul>
              {order.items.map((it: any, i: number) => {
                const review = myReviews[String(it.product)];
                const meta = [it.brand, it.color, it.size && `Size ${it.size}`].filter(Boolean).join(' · ');
                return (
                  <li key={it._id || i} className="flex gap-4 border-t border-[#edf0f2] px-5 py-4">
                    <Thumb src={it.image} alt="" size="lg" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <p className="line-clamp-2 text-[13px] font-semibold leading-snug text-[#252c32]">{it.name}</p>
                        <span className="shrink-0 text-[13px] font-semibold tabular-nums text-[#252c32]">₹{inr(it.subtotal)}</span>
                      </div>
                      <p className="mt-1 text-xs text-[#74808a]">
                        {meta && <>{meta} · </>}Qty {it.quantity}
                        {it.quantity > 1 && <> · ₹{inr(it.price)} each</>}
                      </p>
                      {it.returnedQuantity > 0 && (
                        <p className="mt-1 text-xs font-medium text-[#a3392b]">{it.returnedQuantity} returned</p>
                      )}
                      {isDelivered && (
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                          {review && (
                            <span className="inline-flex items-center gap-0.5" aria-label={`You rated ${review.rating} out of 5`}>
                              {[1, 2, 3, 4, 5].map((n) => (
                                <StarIcon key={n} filled={n <= review.rating} small />
                              ))}
                            </span>
                          )}
                          <button type="button" onClick={() => openReviewModal(it)} className={panelLinkClass}>
                            {review ? 'Edit review' : 'Write a review'}
                          </button>
                          {review && (
                            <button
                              type="button"
                              onClick={() => deleteReview(it.product)}
                              className="rounded text-xs font-semibold text-[#74808a] hover:text-rose-700 hover:underline"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Returns & exchanges — per seller, each with its own window */}
          {isDelivered && (
            <section className="rounded-2xl border border-[#e3e7eb] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
              <h2 className="text-sm font-semibold text-[#252c32]">Return or exchange</h2>
              <p className="mt-0.5 text-xs text-[#74808a]">Each seller sets their own window and reviews your request.</p>
              <div className="mt-4 flex flex-col gap-3">
                {sellersInOrder().map(({ sellerId, policy }) => {
                  const existing = existingRequestFor(sellerId);
                  const returnOk = withinWindow(sellerId, 'return');
                  const exchangeOk = withinWindow(sellerId, 'exchange');
                  const finalReq = (order.returnRequests || [])
                    .filter((r: any) => String(r.seller) === sellerId)
                    .sort((x: any, y: any) => new Date(y.requestedAt).getTime() - new Date(x.requestedAt).getTime())[0];
                  return (
                    <div key={sellerId} className="rounded-xl border border-[#e3e7eb] p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold text-[#252c32]">{policy.storeName || 'Seller'}</p>
                          <p className="mt-0.5 text-xs text-[#74808a]">
                            {policy.returnPolicyDays ? `Returns within ${policy.returnPolicyDays} days` : 'No returns'}
                            {' · '}
                            {policy.exchangePolicyDays ? `Exchanges within ${policy.exchangePolicyDays} days` : 'No exchanges'}
                          </p>
                        </div>
                        {!existing && (returnOk || exchangeOk) && (
                          <div className="flex gap-2">
                            {returnOk && (
                              <button type="button" className={secondaryButtonClass} onClick={() => openRequestModal(sellerId, 'return')}>
                                Return
                              </button>
                            )}
                            {exchangeOk && (
                              <button type="button" className={primaryButtonClass} onClick={() => openRequestModal(sellerId, 'exchange')}>
                                Exchange
                              </button>
                            )}
                          </div>
                        )}
                        {!existing && !returnOk && !exchangeOk && (policy.returnPolicyDays || policy.exchangePolicyDays) ? (
                          <span className="text-xs text-[#9aa3ab]">Window closed</span>
                        ) : null}
                      </div>

                      {finalReq && (
                        <div className="mt-3 border-t border-[#edf0f2] pt-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusChip status={finalReq.status} label={requestLabel(finalReq)} />
                            <span className="text-xs text-[#9aa3ab]">{formatDate(finalReq.requestedAt)}</span>
                            {finalReq.status === 'pending' && (
                              <button
                                type="button"
                                onClick={() => cancelRequest(finalReq._id)}
                                className="ml-auto rounded text-xs font-semibold text-[#74808a] hover:text-rose-700 hover:underline"
                              >
                                Cancel request
                              </button>
                            )}
                          </div>
                          {finalReq.reason && (
                            <p className="mt-2 text-xs text-[#5d6871]">
                              <span className="font-semibold text-[#39434c]">Your reason:</span> {finalReq.reason}
                            </p>
                          )}
                          {finalReq.desiredAction && (
                            <p className="mt-1 text-xs text-[#5d6871]">
                              <span className="font-semibold text-[#39434c]">You asked for:</span> {finalReq.desiredAction}
                            </p>
                          )}
                          {finalReq.status === 'declined' && finalReq.decisionReason && (
                            <p className="mt-2 rounded-lg border border-[#f0d6d2] bg-[#fff6f4] px-3 py-2 text-xs text-[#8c3a2e]">
                              <span className="font-semibold">Seller declined:</span> {finalReq.decisionReason}
                            </p>
                          )}
                          {finalReq.status === 'approved' && (
                            <p className="mt-2 rounded-lg border border-[#dce9c4] bg-[#f6faee] px-3 py-2 text-xs text-[#4b6b16]">
                              Approved. A courier will pick it up from your address; keep the parcel ready.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        {/* ─── SIDE COLUMN ─── */}
        <div className="flex min-w-0 flex-col gap-5">
          <SideCard title="Payment">
            <dl className="flex flex-col gap-2 text-[13px]">
              <Line label="MRP" value={`₹${inr(mrpTotal)}`} />
              {discount > 0 && <Line label="Discount" value={<span className="font-semibold text-[#4b6b16]">−₹{inr(discount)}</span>} />}
              <Line label="Items" value={`₹${inr(order.itemsTotal)}`} />
              <Line label="Delivery" value={deliveryCharges > 0 ? `₹${inr(deliveryCharges)}` : <span className="font-semibold text-[#4b6b16]">Free</span>} />
              {codFee > 0 && <Line label="Cash on delivery fee" value={`₹${inr(codFee)}`} />}
              <div className="mt-1 flex items-baseline justify-between border-t border-[#edf0f2] pt-3">
                <dt className="text-sm font-semibold text-[#252c32]">Total</dt>
                <dd className="text-xl font-semibold tabular-nums tracking-[-0.02em] text-[#252c32]">₹{inr(order.total)}</dd>
              </div>
              <p className="-mt-1 text-right text-[11px] text-[#9aa3ab]">Inclusive of taxes</p>
            </dl>
            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg bg-[#f6f7f9] px-3 py-2.5 text-xs">
              <span className="text-[#39434c]">{paymentLine}</span>
              <span className="font-semibold text-[#252c32]">
                {/* A cancelled order never collects a pending payment (COD, unpaid online). */}
                {isCancelled && order.paymentStatus === 'pending' ? 'Not charged' : paymentStatusLabel(order.paymentStatus)}
              </span>
            </div>
          </SideCard>

          <SideCard title="Delivery address">
            <address className="not-italic text-[13px] leading-relaxed text-[#5d6871]">
              <span className="block font-semibold text-[#252c32]">{a.fullName}</span>
              <span className="block">{[a.line1, a.line2].filter(Boolean).join(', ')}</span>
              <span className="block">
                {[a.city, a.state].filter(Boolean).join(', ')} {a.pincode}
              </span>
              {a.phone && <span className="mt-1 block tabular-nums text-[#74808a]">{a.phone}</span>}
            </address>
          </SideCard>

          {deliveredParcels.length > 0 && (
            <SideCard title={deliveredParcels.length > 1 ? 'Invoices' : 'Invoice'}>
              <ul className="flex flex-col gap-2">
                {deliveredParcels.map((s: any) => {
                  const sid = String(s.seller);
                  return (
                    <li key={String(s._id || sid)}>
                      <button
                        type="button"
                        onClick={() => downloadInvoice(sid)}
                        disabled={downloadingInvoice !== null}
                        className="flex w-full items-center gap-3 rounded-lg border border-[#e2e7eb] px-3 py-2.5 text-left transition hover:border-[#c9d1d8] disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#59656f]"
                      >
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#f3f4f2] text-[#39434c]">
                          <DocIcon />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold text-[#252c32]">
                            {deliveredParcels.length > 1 ? sellerPolicy[sid]?.storeName || 'Seller' : 'Tax invoice'}
                          </span>
                          <span className="block text-[11px] text-[#74808a]">
                            {downloadingInvoice === sid ? 'Preparing PDF…' : 'PDF · GST invoice'}
                          </span>
                        </span>
                        <DownloadIcon />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </SideCard>
          )}

          <SideCard title="Need help?">
            <p className="text-xs text-[#74808a]">Questions about this order? We reply within 48 hours.</p>
            <Link href="/contact" className={`${secondaryButtonClass} mt-3 w-full`}>
              Contact support
            </Link>
          </SideCard>
        </div>
      </div>



      {/* ─── Return / Exchange request modal ────────────────────────────── */}
      <Modal
        isOpen={returnModal.isOpen}
        onOpenChange={returnModal.onOpenChange}
        size="2xl"
        scrollBehavior="inside"
      >
        <ModalContent>
          {(close) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <div className="font-bold">
                  {reqKind === 'exchange' ? 'Request exchange' : 'Request return'}
                </div>
                <div className="text-xs text-default-500 font-normal">
                  {sellerPolicy[reqSellerId]?.storeName || 'Seller'} will review and either approve the pickup or reply with a reason.
                </div>
              </ModalHeader>
              <ModalBody className="flex flex-col gap-4">
                {/* Items picker */}
                <div>
                  <div className="text-sm font-semibold mb-2">Which items?</div>
                  <div className="flex flex-col gap-2">
                    {(order.items || [])
                      .filter((it: any) => String(it.seller) === reqSellerId)
                      .map((it: any) => (
                        <Checkbox
                          key={String(it.product)}
                          isSelected={!!reqItems[String(it.product)]}
                          onValueChange={(v) =>
                            setReqItems((prev) => ({ ...prev, [String(it.product)]: v }))
                          }
                        >
                          <span className="text-sm">
                            {it.name}
                            {it.size && <span className="text-default-500"> · Size {it.size}</span>}
                            <span className="text-default-500"> · Qty {it.quantity}</span>
                          </span>
                        </Checkbox>
                      ))}
                  </div>
                </div>

                {/* Reason picker */}
                <div>
                  <div className="text-sm font-semibold mb-2">Reason</div>
                  <div className="flex flex-wrap gap-2">
                    {REASON_CODES.map((r) => (
                      <button
                        key={r.code}
                        type="button"
                        onClick={() => setReqReasonCode(r.code)}
                        className={`px-3 py-1.5 rounded-full text-xs font-medium border-2 transition ${reqReasonCode === r.code
                          ? 'bg-brand-black text-white border-brand-black'
                          : 'bg-white text-default-700 border-default-200 hover:border-default-400'
                          }`}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                </div>

                <Textarea
                  label={reqReasonCode === 'other' ? 'Tell us more (required)' : 'Add more details (optional)'}
                  placeholder="Anything that'll help the seller handle this faster…"
                  value={reqReason}
                  onValueChange={setReqReason}
                  minRows={2}
                  maxRows={4}
                />

                {/* Evidence — only shown for reasons where photos help.
                    Required for damage / wrong-item / not-as-described. */}
                {evidenceRequired && (
                  <div>
                    <div className="text-sm font-semibold mb-1">
                      Photo / video evidence
                      <span className="text-rose-600">*</span>
                    </div>
                    <div className="text-xs text-default-500 mb-3 leading-relaxed">
                      Attach clear photos showing the damage or issue. Short video clips help too. Up to 6 files, ~50 MB each.
                    </div>

                    {/* Existing thumbnails */}
                    {evidence.length > 0 && (
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        {evidence.map((a, i) => (
                          <div
                            key={i}
                            className="relative aspect-square rounded-lg border-2 border-default-200 overflow-hidden bg-default-100"
                          >
                            {a.kind === 'image' ? (
                              <img
                                src={imageUrl(a.url)}
                                alt={`Evidence ${i + 1}`}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <video
                                src={imageUrl(a.url)}
                                className="w-full h-full object-cover"
                                muted
                              />
                            )}
                            <button
                              type="button"
                              onClick={() => removeEvidence(i)}
                              className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 text-white text-xs grid place-items-center hover:bg-black"
                              aria-label="Remove"
                            >
                              ×
                            </button>
                            <div className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded text-xs uppercase tracking-wider bg-black/70 text-white">
                              {a.kind}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* File picker */}
                    {evidence.length < 6 && (
                      <label className="flex items-center justify-center gap-2 cursor-pointer rounded-lg border-2 border-dashed border-default-300 hover:border-default-500 bg-default-50/30 hover:bg-default-50 px-4 py-6 text-sm text-default-600 transition">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                          <circle cx="8.5" cy="8.5" r="1.5" />
                          <polyline points="21 15 16 10 5 21" />
                        </svg>
                        {uploading ? (
                          <span>Uploading…</span>
                        ) : (
                          <span>
                            Click to add photos / videos
                            <span className="text-default-400"> ({evidence.length} / 6)</span>
                          </span>
                        )}
                        <input
                          type="file"
                          className="hidden"
                          accept="image/*,video/*"
                          multiple
                          disabled={uploading}
                          onChange={(e) => {
                            handleEvidencePick(e.target.files);
                            // reset so picking the same file twice still
                            // fires onChange — useful if a user removes
                            // and re-adds the exact same attachment.
                            e.target.value = '';
                          }}
                        />
                      </label>
                    )}
                  </div>
                )}

                {reqKind === 'exchange' && (
                  <Textarea
                    label="What would you like instead?"
                    placeholder='e.g. "Same jacket but size L" or "Different colour — black"'
                    value={reqDesiredAction}
                    onValueChange={setReqDesiredAction}
                    minRows={2}
                    maxRows={3}
                  />
                )}

                {/* COD refund destination — only shown for COD returns. Online
                    refunds go back to the original payment method automatically. */}
                {refundChannelNeeded && (
                  <div className="rounded-lg border-2 border-default-200 p-4">
                    <div className="text-sm font-semibold mb-1">Where should we send your refund?</div>
                    <div className="text-xs text-default-500 mb-3 leading-relaxed">
                      Your order was COD, so we need an account to send the refund to. UPI is fastest. Once approved, the THROTTLEIN team transfers within 5-7 business days.
                    </div>
                    <div className="flex gap-2 mb-3">
                      <button
                        type="button"
                        onClick={() => setRefundChannel('upi')}
                        className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm font-semibold transition ${refundChannel === 'upi'
                          ? 'border-brand-black bg-brand-black text-white'
                          : 'border-default-200 hover:border-default-400'
                          }`}
                      >
                        UPI
                      </button>
                      <button
                        type="button"
                        onClick={() => setRefundChannel('bank')}
                        className={`flex-1 rounded-lg border-2 px-3 py-2 text-sm font-semibold transition ${refundChannel === 'bank'
                          ? 'border-brand-black bg-brand-black text-white'
                          : 'border-default-200 hover:border-default-400'
                          }`}
                      >
                        Bank account
                      </button>
                    </div>
                    {refundChannel === 'upi' ? (
                      <input
                        type="text"
                        className="w-full rounded-lg border-2 border-default-200 focus:border-brand-black p-2.5 text-sm outline-none"
                        placeholder="yourname@upi"
                        value={refundUpi}
                        onChange={(e) => setRefundUpi(e.target.value)}
                      />
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          className="col-span-2 rounded-lg border-2 border-default-200 focus:border-brand-black p-2.5 text-sm outline-none"
                          placeholder="Bank name (e.g. HDFC Bank)"
                          value={refundBank.bankName}
                          onChange={(e) => setRefundBank({ ...refundBank, bankName: e.target.value })}
                        />
                        <input
                          type="text"
                          className="rounded-lg border-2 border-default-200 focus:border-brand-black p-2.5 text-sm outline-none"
                          placeholder="Account number"
                          value={refundBank.accountNo}
                          onChange={(e) => setRefundBank({ ...refundBank, accountNo: e.target.value })}
                        />
                        <input
                          type="text"
                          className="rounded-lg border-2 border-default-200 focus:border-brand-black p-2.5 text-sm outline-none uppercase"
                          placeholder="IFSC code"
                          value={refundBank.ifsc}
                          onChange={(e) => setRefundBank({ ...refundBank, ifsc: e.target.value })}
                        />
                      </div>
                    )}
                  </div>
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="bordered" onPress={close}>Cancel</Button>
                <Button color="primary" className="font-semibold" isLoading={submitting} onPress={submitRequest}>
                  Submit {reqKind === 'exchange' ? 'exchange' : 'return'} request
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* ─── Track Order modal — opened from the new Order Summary card's
          "Track Order" button. Renders the same vertical tracker shown
          inline further down the page (via the shared getTrackerSections
          helper), just in a modal so it's reachable without scrolling. */}
      <Modal
        isOpen={trackModal.isOpen}
        onClose={trackModal.onClose}
        placement="center"
        size="lg"
        scrollBehavior="inside"
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <div className="font-bold text-brand-black">Track your order</div>
            <div className="text-xs text-default-500 font-normal">{order.orderNumber}</div>
          </ModalHeader>
          <ModalBody className="pb-6">
            <ParcelTrackers order={order} />
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* ─── Product review modal ──────────────────────────────────────
          Opens from the per-item "Leave a review" button when an order
          is delivered. Single rating + optional title + comment that
          the backend stores against (product, customer). Re-opens with
          the existing values when the customer wants to edit. */}
      <Modal
        isOpen={reviewModal.isOpen}
        onClose={reviewModal.onClose}
        placement="center"
        size="lg"
      >
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <div className="text-base font-bold text-brand-black">
              {reviewItem && myReviews[String(reviewItem.product)]
                ? 'Edit your review'
                : 'Leave a review'}
            </div>
            {reviewItem && (
              <div className="text-sm text-default-600 font-normal truncate">
                {reviewItem.name}
              </div>
            )}
          </ModalHeader>
          <ModalBody className="flex flex-col gap-4">
            {/* Star rating selector — click sets the rating, hover
                shows a preview without committing. */}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-default-600 mb-2">
                Your rating
              </div>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((n) => {
                  const filled = n <= (reviewHover || reviewRating);
                  return (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setReviewRating(n)}
                      onMouseEnter={() => setReviewHover(n)}
                      onMouseLeave={() => setReviewHover(0)}
                      aria-label={`Rate ${n} star${n === 1 ? '' : 's'}`}
                      className="p-1 outline-none focus-visible:ring-0"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill={filled ? 'currentColor' : 'none'}
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={`w-8 h-8 transition ${filled
                          ? 'text-amber-500'
                          : 'text-default-300 hover:text-amber-400'
                          }`}
                      >
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                    </button>
                  );
                })}
                <span className="ml-2 text-sm font-semibold text-brand-black tabular-nums">
                  {reviewRating > 0
                    ? `${reviewRating}.0`
                    : <span className="text-default-500 font-normal italic">Tap to rate</span>}
                </span>
              </div>
            </div>

            {/* Optional headline */}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-default-600 mb-2">
                Headline{' '}
                <span className="font-normal normal-case text-default-500">
                  (optional)
                </span>
              </div>
              <input
                type="text"
                value={reviewTitle}
                onChange={(e) => setReviewTitle(e.target.value)}
                maxLength={120}
                placeholder="Summarise your experience in one line"
                className="w-full px-3 py-2 rounded-lg border-2 border-default-200 focus:border-brand-black outline-none text-sm bg-white"
              />
            </div>

            {/* Comment */}
            <Textarea
              label="Your review"
              placeholder="What did you like or not like? How was the fit / quality / value?"
              isRequired
              minRows={4}
              maxRows={8}
              value={reviewComment}
              onValueChange={setReviewComment}
              variant="bordered"
            />

            {/* Optional photos — same upload-then-attach flow as the
                return/exchange evidence uploader elsewhere in the app. */}
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-default-600 mb-2">
                Add photos{' '}
                <span className="font-normal normal-case text-default-500">
                  (optional, up to 6)
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {reviewImages.map((img, idx) => (
                  <div key={idx} className="relative w-16 h-16 rounded-lg overflow-hidden border border-default-200 shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={imageUrl(img)} alt={`Review photo ${idx + 1}`} className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeReviewImage(idx)}
                      aria-label="Remove photo"
                      className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/70 text-white text-xs leading-none grid place-items-center hover:bg-black"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {reviewImages.length < 6 && (
                  <label className="w-16 h-16 rounded-lg border-2 border-dashed border-default-300 shrink-0 grid place-items-center cursor-pointer text-default-500 hover:border-brand-black hover:text-brand-black transition text-xs font-semibold text-center px-1">
                    {reviewImagesUploading ? (
                      <Spinner size="sm" />
                    ) : (
                      <>+ Add</>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      disabled={reviewImagesUploading}
                      onChange={handleReviewImagePick}
                      className="hidden"
                    />
                  </label>
                )}
              </div>
            </div>

            <div className="text-xs text-default-500 leading-relaxed">
              Reviews are public on the product page. Be honest — other
              riders count on your feedback to make a call.
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={reviewModal.onClose}>
              Cancel
            </Button>
            <Button
              color="primary"
              className="font-semibold"
              isLoading={reviewSaving}
              onPress={submitReview}
            >
              {reviewItem && myReviews[String(reviewItem.product)]
                ? 'Save changes'
                : 'Post review'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </CustomerShell>
  );
}

/* ─── Pieces ───────────────────────────────────────────────────────── */

const PROGRESS = ['Placed', 'Confirmed', 'Shipped', 'Delivered'] as const;

/** Where the order is on the happy path, or null once it left it (returned, lost…). */
function progressStep(order: any, key: StatusKey): number | null {
  const byKey: Partial<Record<StatusKey, number>> = {
    placed: 0,
    confirmed: 1,
    awaiting_pickup: 1,
    pickup_failed: 1,
    in_transit: 2,
    out_for_delivery: 2,
    delivery_failed: 2,
    delivered: 3,
  };
  if (key in byKey) return byKey[key]!;
  if (key === 'multiple') return ({ placed: 0, confirmed: 1, shipped: 2, delivered: 3 } as Record<string, number>)[order.status] ?? 0;
  return null;
}

/** "Return requested", "Exchange approved"… */
function requestLabel(r: any): string {
  const kind = r.kind === 'exchange' ? 'Exchange' : 'Return';
  const word: Record<string, string> = {
    pending: 'requested',
    approved: 'approved',
    declined: 'declined',
    completed: 'completed',
    cancelled: 'cancelled',
  };
  return `${kind} ${word[r.status] || r.status}`;
}

function SideCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#e3e7eb] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <h2 className="mb-3 text-sm font-semibold text-[#252c32]">{title}</h2>
      {children}
    </section>
  );
}

function Line({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[#5d6871]">{label}</dt>
      <dd className="tabular-nums text-[#252c32]">{value}</dd>
    </div>
  );
}

function StarIcon({ filled, small = false }: { filled: boolean; small?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? '#141414' : 'none'}
      stroke={filled ? '#141414' : '#9aa3ab'}
      strokeWidth="1.6"
      strokeLinejoin="round"
      className={small ? 'h-3 w-3' : 'h-6 w-6'}
      aria-hidden
    >
      <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z" />
    </svg>
  );
}

const Svg = ({ children, className = 'h-5 w-5' }: { children: React.ReactNode; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
    {children}
  </svg>
);
const CheckIcon = () => <Svg><path d="m5 12 5 5 9-10" /></Svg>;
const CrossIcon = () => <Svg><path d="M18 6 6 18M6 6l12 12" /></Svg>;
const TruckIcon = () => (
  <Svg>
    <path d="M3 6h11v10H3zM14 9h4l3 3v4h-7" />
    <circle cx="7" cy="17.5" r="1.8" />
    <circle cx="17" cy="17.5" r="1.8" />
  </Svg>
);
const DocIcon = () => (
  <Svg className="h-4 w-4">
    <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 13h6M9 17h4" />
  </Svg>
);
const DownloadIcon = () => (
  <Svg className="h-4 w-4 shrink-0 text-[#74808a]">
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </Svg>
);
