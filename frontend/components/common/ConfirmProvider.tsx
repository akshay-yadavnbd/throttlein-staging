'use client';

import { useEffect, useState } from 'react';
import {
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter,
} from '@heroui/react';
import Button from './SellerButton';
import styles from './ConfirmProvider.module.css';
import {
  __registerConfirmHost,
  __resolveConfirm,
  type ConfirmOpts,
} from '@/lib/confirm';

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
      size="sm"
      backdrop="opaque"
      scrollBehavior="inside"
      classNames={{ base: styles.dialog, backdrop: styles.backdrop }}
      hideCloseButton
    >
      <ModalContent>
        {opts && (
          <>
            <ModalHeader className={styles.header}>
              {opts.title || 'Are you sure?'}
            </ModalHeader>
            <ModalBody className={styles.body}>
              <p>{opts.message}</p>
            </ModalBody>
            <ModalFooter className={styles.footer}>
              <Button autoFocus variant="bordered" className={styles.cancel} onPress={close}>
                {opts.cancelLabel || 'Cancel'}
              </Button>
              <Button
                color={opts.destructive ? 'danger' : 'primary'}
                className={opts.destructive ? styles.destructive : undefined}
                onPress={ok}
              >
                {opts.confirmLabel || (opts.destructive ? 'Delete' : 'Confirm')}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
