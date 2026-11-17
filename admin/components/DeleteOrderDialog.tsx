'use client';

/**
 * "Delete order" for admins — an archive, not a hard delete (product
 * decision): the order disappears from every list people look at (admin
 * orders and dashboards, the seller's and the customer's order lists) but
 * stays in the database, so payments, refunds, seller payouts and tracking
 * keep working on it, and Restore brings it back unchanged.
 *
 * Any order may be deleted; the dialog spells out what deleting does NOT do
 * (refund money, stop a parcel) so a live order isn't removed by mistake.
 *
 * Backend: POST /api/admin/orders/:orderNumber/archive { reason } · …/restore
 */
import { useState } from 'react';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@heroui/react';
import AdminButton from '@/components/AdminButton';
import AdminTextarea from '@/components/AdminTextarea';
import { api } from '@/lib/api';
import { confirmDialog } from '@/lib/confirm';
import modal from './AdminModal.module.css';
import { notifyError, notifySuccess } from '@/lib/notify';
import { M } from '@/lib/messages';

export type DeletableOrder = {
  orderNumber: string;
  total: number;
  status: string;
  paymentMethod?: string;
  paymentStatus?: string;
  customerName?: string;
};

const inr = (n: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(n || 0);

export default function DeleteOrderDialog({ order, onClose, onDeleted }: {
  order: DeletableOrder | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [reason, setReason] = useState('');
  const [working, setWorking] = useState(false);
  const [forNumber, setForNumber] = useState<string | null>(null);
  // Fresh reason per order opened (render-time reset, not an effect).
  if (order && order.orderNumber !== forNumber) { setForNumber(order.orderNumber); setReason(''); }

  async function remove() {
    if (!order) return;
    setWorking(true);
    try {
      await api.post(`/admin/orders/${order.orderNumber}/archive`, { reason: reason.trim() });
      notifySuccess(M.deleteOrderDialog.orderDeleted(order.orderNumber));
      onClose();
      onDeleted();
    } catch (e: any) {
      notifyError(e, M.deleteOrderDialog.couldntDeleteTheOrder);
    } finally {
      setWorking(false);
    }
  }

  const paidOnline = order?.paymentStatus === 'paid';
  const live = !!order && !['cancelled', 'delivered'].includes(order.status);

  return (
    <Modal isOpen={!!order} onClose={() => !working && onClose()} placement="center" size="lg" hideCloseButton classNames={{ base: modal.modal, backdrop: modal.backdrop }}>
      <ModalContent>
        {order && (
          <>
            <ModalHeader className={modal.header}>
              <span className={`${modal.icon} ${modal.danger}`}><IconTrash /></span>
              <div className="min-w-0 flex-1">
                <div className={modal.eyebrow}>Delete order</div>
                <div className={modal.title}>Delete {order.orderNumber}?</div>
                <div className={modal.sub}>
                  ₹{inr(order.total)}{order.customerName ? ` · ${order.customerName}` : ''} · {order.status}{order.paymentStatus ? ` · payment ${order.paymentStatus}` : ''}
                </div>
              </div>
              <button type="button" className={modal.close} onClick={onClose} disabled={working} aria-label="Close"><IconClose /></button>
            </ModalHeader>
            <ModalBody className={modal.body}>
              <div className={modal.effects}>
                <p>What happens</p>
                <ul>
                  <li><IconCheck />It disappears from Orders, the dashboard, and the seller’s and customer’s order lists.</li>
                  <li><IconCheck />Payments, refunds, seller payouts and tracking keep working on it in the background.</li>
                  <li><IconCheck />You can restore it any time from Orders → Deleted.</li>
                </ul>
              </div>
              {(paidOnline || live) && (
                <div className={modal.callout} role="note">
                  {paidOnline && <><strong>The customer has paid.</strong> Deleting doesn’t refund them — any refund still goes through the Refund queue. </>}
                  {live && <><strong>This order is still {order.status}.</strong> Deleting doesn’t cancel it or stop a booked parcel — cancel it first if it shouldn’t ship.</>}
                </div>
              )}
              <AdminTextarea
                label="Reason" labelPlacement="outside" variant="bordered" minRows={2} maxRows={4} maxLength={300}
                placeholder="Optional — e.g. test order, duplicate. Kept in the audit log."
                value={reason} onChange={(e) => setReason(e.target.value)}
              />
            </ModalBody>
            <ModalFooter className={modal.footer}>
              <AdminButton variant="bordered" onPress={onClose} isDisabled={working}>Cancel</AdminButton>
              <AdminButton color="danger" onPress={remove} isLoading={working}>Delete order</AdminButton>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

/** Restore a deleted order after a confirm; resolves true when it worked. */
export async function restoreOrder(orderNumber: string): Promise<boolean> {
  const ok = await confirmDialog({
    title: `Restore ${orderNumber}?`,
    message: 'It comes back exactly as it was — in Orders, the dashboard, and the seller’s and customer’s order lists.',
    confirmLabel: 'Restore order',
  });
  if (!ok) return false;
  try {
    await api.post(`/admin/orders/${orderNumber}/restore`);
    notifySuccess(M.deleteOrderDialog.orderRestored(orderNumber));
    return true;
  } catch (e: any) {
    notifyError(e, M.deleteOrderDialog.couldntRestoreTheOrder);
    return false;
  }
}

const svg = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
function IconTrash() { return <svg {...svg}><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>; }
function IconClose() { return <svg {...svg} width="14" height="14"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>; }
function IconCheck() { return <svg {...svg}><polyline points="20 6 9 17 4 12" /></svg>; }
