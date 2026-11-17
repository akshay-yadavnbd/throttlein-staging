'use client';

import { forwardRef } from 'react';
import { Button, type ButtonProps } from '@heroui/react';
import styles from './AdminButton.module.css';

/** Compact workspace actions (36px, charcoal primary) — same as the seller dashboard's SellerButton. */
const AdminButton = forwardRef<HTMLButtonElement, ButtonProps>(function AdminButton(
  { className, isIconOnly, color, ...props }, ref,
) {
  return <Button {...props} ref={ref} color={color} isIconOnly={isIconOnly}
    className={`${className || ''} ${styles.button} ${isIconOnly ? styles.icon : ''} ${color === 'primary' ? styles.primary : ''} ${color === 'danger' ? styles.danger : ''}`} />;
});

export default AdminButton;
