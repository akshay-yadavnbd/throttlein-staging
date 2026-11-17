'use client';

/**
 * Host for `confirmDialog()` — one confirm modal for the whole panel, in
 * the shared AdminModal look: an icon (red for destructive asks, neutral
 * otherwise), an eyebrow, the question as the title, the consequences as
 * the sub line, and a Cancel / confirm footer.
 */
import { useEffect, useState } from 'react';
import { Modal, ModalContent, ModalHeader, ModalFooter } from '@heroui/react';
import AdminButton from '@/components/AdminButton';
import { IconTrash, IconHelp } from '@/components/EditorShell';
import {
  __registerConfirmHost,
  __resolveConfirm,
  type ConfirmOpts,
} from '@/lib/confirm';
import modal from '@/components/AdminModal.module.css';

export default function ConfirmProvider() {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null);

  useEffect(() => {
    __registerConfirmHost(setOpts);
  }, []);

  const close = () => __resolveConfirm(false);
  const ok = () => __resolveConfirm(true);

  return (
    <Modal
      isOpen={!!opts}
      onClose={close}
      placement="center"
      size="md"
      hideCloseButton
      classNames={{ base: modal.modal, backdrop: modal.backdrop }}
    >
      <ModalContent>
        {opts && (
          <>
            <ModalHeader className={modal.header}>
              <span className={`${modal.icon} ${opts.destructive ? modal.danger : modal.info}`}>
                {opts.destructive ? <IconTrash /> : <IconHelp />}
              </span>
              <div className="min-w-0 flex-1">
                <div className={modal.eyebrow}>{opts.destructive ? 'This can’t be undone' : 'Please confirm'}</div>
                <div className={modal.title}>{opts.title || 'Are you sure?'}</div>
                <div className={modal.sub}>{opts.message}</div>
              </div>
            </ModalHeader>
            <ModalFooter className={modal.footer}>
              <AdminButton variant="bordered" onPress={close}>{opts.cancelLabel || 'Cancel'}</AdminButton>
              <AdminButton color={opts.destructive ? 'danger' : 'primary'} onPress={ok} autoFocus>
                {opts.confirmLabel || (opts.destructive ? 'Delete' : 'Confirm')}
              </AdminButton>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
