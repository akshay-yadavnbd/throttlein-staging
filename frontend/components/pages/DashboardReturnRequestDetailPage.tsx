'use client';

/**
 * Seller — single return / exchange request detail page.
 *
 * Full-page view of one customer request. Shows everything the seller needs
 * to decide:
 *   - Order metadata + customer info + delivery address
 *   - Items the customer wants to send back
 *   - Reason code + reason text + desired action (for exchanges)
 *   - Photo / video evidence (clickable thumbnails open in new tab)
 *   - Decision banner if already resolved
 *   - Action footer with Approve / Decline (only when pending)
 *
 * Data source: GET /api/seller/return-requests/:reqId
 * Actions:
 *   POST /api/seller/orders/:orderNumber/return-request/:reqId/approve
 *   POST /api/seller/orders/:orderNumber/return-request/:reqId/decline
 */
import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardBody, Chip, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure } from '@heroui/react';
import Button from '@/components/common/SellerButton';
import { DetailSkeleton } from '@/components/ui';
import { api, imageUrl, unwrap } from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import { notifyError, notifySuccess, notifyWarning } from '@/lib/notify';
import { M } from '@/lib/messages';

type Detail = {
  orderNumber: string;
  customer: string;
  shippingAddress?: any;
  reqId: string;
  kind: 'return' | 'exchange';
  status: 'pending' | 'approved' | 'declined' | 'completed' | 'cancelled';
  reason: string;
  reasonCode: string;
  desiredAction: string;
  items: { name: string; size?: string; quantity: number }[];
  attachments: { url: string; kind: 'image' | 'video'; mimeType?: string; sizeBytes?: number }[];
  requestedAt: string;
  decisionAt?: string | null;
  decisionReason?: string;
};

const STATUS_COLOR: Record<Detail['status'], 'default' | 'success' | 'warning' | 'danger'> = {
  pending: 'warning',
  approved: 'success',
  declined: 'danger',
  completed: 'success',
  cancelled: 'default',
};

export default function DashboardReturnRequestDetailPage({
  params,
}: {
  params: Promise<{ reqId: string }>;
}) {
  const { reqId } = use(params);
  const router = useRouter();

  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [approving, setApproving] = useState(false);

  const declineModal = useDisclosure();
  const [declineReason, setDeclineReason] = useState('');
  const [declining, setDeclining] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = unwrap<any>(await api.get(`/seller/return-requests/${reqId}`));
      setDetail(data.request);
    } catch (e: any) {
      notifyError(e, M.returnRequestDetail.couldntLoadRequest);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [reqId]);

  async function approve() {
    if (!detail) return;
    if (!(await confirmDialog({
      title: `Approve this ${detail.kind}?`,
      message: "Shiprocket will book a reverse pickup from the customer's address. You can track it on the order detail page once approved.",
      confirmLabel: 'Approve & schedule pickup',
    }))) return;
    setApproving(true);
    try {
      await api.post(`/seller/orders/${detail.orderNumber}/return-request/${detail.reqId}/approve`);
      notifySuccess(M.returnRequestDetail.approvedPickupScheduled);
      load();
    } catch (e: any) {
      notifyError(e, M.returnRequestDetail.couldntApprove);
    } finally {
      setApproving(false);
    }
  }

  function openDecline() {
    setDeclineReason('');
    declineModal.onOpen();
  }
  async function submitDecline() {
    if (!detail) return;
    if (declineReason.trim().length < 5) {
      notifyWarning(M.returnRequestDetail.giveTheCustomerAReason5Characters);
      return;
    }
    setDeclining(true);
    try {
      await api.post(
        `/seller/orders/${detail.orderNumber}/return-request/${detail.reqId}/decline`,
        { reason: declineReason }
      );
      notifySuccess(M.returnRequestDetail.declined);
      declineModal.onClose();
      load();
    } catch (e: any) {
      notifyError(e, M.returnRequestDetail.declineFailed);
    } finally {
      setDeclining(false);
    }
  }

  if (loading) {
    return (
      <>
        <DetailSkeleton aside cards={2} rows={3} />
      </>
    );
  }
  if (!detail) {
    return (
      <>
        <div className="text-muted">Request not found.</div>
        <Link href="/dashboard/return-requests" className="text-sm text-brand-700 hover:underline">
          ← Back to all requests
        </Link>
      </>
    );
  }

  const a = detail.shippingAddress || {};

  return (
    <>
      <Link
        href="/dashboard/return-requests"
        className="text-sm text-muted hover:text-brand-black inline-flex items-center gap-1 mb-4"
      >
        ← Back to all requests
      </Link>

      {/* HEADER */}
      <Card className="mb-4">
        <CardBody className="p-6 flex flex-col gap-3">
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl md:text-2xl font-bold capitalize">
                  {detail.kind} request
                </h1>
                <Chip
                  color={STATUS_COLOR[detail.status]}
                  variant="flat"
                  className="capitalize font-semibold"
                >
                  {detail.status}
                </Chip>
              </div>
              <div className="text-sm text-default-600 mt-1">
                <Link
                  href={`/dashboard/orders/${detail.orderNumber}`}
                  className="font-semibold hover:underline"
                >
                  {detail.orderNumber}
                </Link>
                {' · '}
                {detail.customer}
                {' · Submitted '}
                {new Date(detail.requestedAt).toLocaleString('en-IN', {
                  year: 'numeric', month: 'short', day: 'numeric',
                  hour: 'numeric', minute: '2-digit',
                })}
                {detail.decisionAt && (
                  <>
                    {' · Decided '}
                    {new Date(detail.decisionAt).toLocaleString('en-IN', {
                      year: 'numeric', month: 'short', day: 'numeric',
                      hour: 'numeric', minute: '2-digit',
                    })}
                  </>
                )}
              </div>
            </div>
            {detail.status === 'pending' && (
              <div className="flex gap-2">
                <Button
                  variant="bordered"
                  color="danger"
                  className="font-semibold border-2"
                  onPress={openDecline}
                >
                  Decline
                </Button>
                <Button
                  color="success"
                  className="font-semibold text-white"
                  isLoading={approving}
                  onPress={approve}
                >
                  Approve & schedule pickup
                </Button>
              </div>
            )}
          </div>

          {detail.status === 'pending' && (
            <div className="rounded-lg bg-amber-50 border border-amber-100 p-3 text-xs text-amber-900 leading-relaxed">
              <strong>Approve</strong> books the reverse pickup with Shiprocket and the parcel comes back to your pickup address. <strong>Decline</strong> requires a short comment that the customer will see on their order page.
            </div>
          )}
          {detail.status === 'approved' && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-3 text-sm text-emerald-800">
              Reverse pickup is on the way. Track it on the order detail page.
            </div>
          )}
          {detail.status === 'declined' && detail.decisionReason && (
            <div className="rounded-lg bg-rose-50 border border-rose-100 p-3 text-sm text-rose-800">
              <span className="font-semibold">You declined: </span>
              {detail.decisionReason}
            </div>
          )}
          {detail.status === 'cancelled' && (
            <div className="rounded-lg bg-default-50 border border-default-200 p-3 text-sm text-default-700">
              Customer cancelled this request before you decided.
            </div>
          )}
        </CardBody>
      </Card>

      {/* MAIN GRID — Items + Reason on top, Evidence below, Address sidebar */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 flex flex-col gap-4">
          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardBody className="p-5">
                <div className="text-xs uppercase tracking-wider text-muted font-semibold mb-2">
                  Items
                </div>
                <ul className="text-sm space-y-1.5">
                  {detail.items.map((it, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span>
                        {it.name}
                        {it.size && <span className="text-muted"> · Size {it.size}</span>}
                      </span>
                      <span className="text-muted">× {it.quantity}</span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>

            <Card>
              <CardBody className="p-5">
                <div className="text-xs uppercase tracking-wider text-muted font-semibold mb-2">
                  Reason
                </div>
                {detail.reasonCode && (
                  <div className="text-xs text-muted mb-1">({detail.reasonCode})</div>
                )}
                <div className="text-sm text-default-700 whitespace-pre-wrap">
                  {detail.reason || (
                    <span className="text-muted">No additional details from the customer.</span>
                  )}
                </div>
                {detail.desiredAction && (
                  <div className="mt-3 pt-3 border-t border-default-200">
                    <div className="text-xs text-muted mb-1">Wants instead</div>
                    <div className="text-sm text-default-700">{detail.desiredAction}</div>
                  </div>
                )}
              </CardBody>
            </Card>
          </div>

          {/* EVIDENCE GALLERY — larger tiles on the dedicated page */}
          {detail.attachments && detail.attachments.length > 0 && (
            <Card>
              <CardBody className="p-5">
                <div className="text-xs uppercase tracking-wider text-muted font-semibold mb-3">
                  Customer evidence ({detail.attachments.length})
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {detail.attachments.map((att, i) => (
                    <a
                      key={i}
                      href={imageUrl(att.url)}
                      target="_blank"
                      rel="noopener"
                      className="relative aspect-square rounded-lg border-2 border-default-200 overflow-hidden bg-default-100 hover:border-default-400 transition"
                    >
                      {att.kind === 'image' ? (
                        <img
                          src={imageUrl(att.url)}
                          alt={`Evidence ${i + 1}`}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <video
                          src={imageUrl(att.url)}
                          className="w-full h-full object-cover"
                          controls
                          muted
                        />
                      )}
                      <div className="absolute bottom-1.5 left-1.5 px-2 py-0.5 rounded text-xs uppercase tracking-wider bg-black/70 text-white font-semibold">
                        {att.kind}
                      </div>
                    </a>
                  ))}
                </div>
                <div className="text-xs text-muted mt-3">
                  Click any thumbnail to open the full file in a new tab. Videos play inline — click them to see fullscreen.
                </div>
              </CardBody>
            </Card>
          )}
        </div>

        {/* SIDEBAR — Customer delivery address (where the reverse pickup happens) */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardBody className="p-5">
              <div className="text-xs uppercase tracking-wider text-muted font-semibold mb-2">
                Pickup from
              </div>
              {/* Name + address only — the buyer's phone/email are not
                  exposed to sellers (see sellerOrderDto). The courier
                  gets the contact details from us when the reverse
                  pickup is booked, so the seller doesn't need them. */}
              <div className="font-semibold text-sm">{a.fullName}</div>
              <div className="mt-2 text-sm text-default-700">
                {a.line1}
                {a.line2 && <><br />{a.line2}</>}
                <br />
                {[a.city, a.state, a.pincode].filter(Boolean).join(', ')}
                {a.country && <><br />{a.country}</>}
              </div>
              <div className="text-xs text-muted mt-3 leading-relaxed">
                On approval, Shiprocket dispatches a courier to this address and delivers the parcel back to your registered pickup.
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      {/* DECLINE REASON MODAL */}
      <Modal isOpen={declineModal.isOpen} onOpenChange={declineModal.onOpenChange} size="lg">
        <ModalContent>
          {(close) => (
            <>
              <ModalHeader>
                <div className="font-bold">
                  Decline {detail.kind} on {detail.orderNumber}
                </div>
              </ModalHeader>
              <ModalBody>
                <p className="text-sm text-default-600 mb-3">
                  The customer will see your reason on their order page. Be clear and respectful.
                </p>
                <textarea
                  rows={4}
                  className="w-full rounded-lg border-2 border-default-200 focus:border-brand-black p-3 text-sm outline-none"
                  placeholder='e.g. "Return window expired" or "Item shows signs of use beyond inspection"'
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                />
              </ModalBody>
              <ModalFooter>
                <Button variant="bordered" onPress={close}>Cancel</Button>
                <Button color="danger" className="font-semibold" isLoading={declining} onPress={submitDecline}>
                  Send decline
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
}
