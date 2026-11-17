'use client';

import { forwardRef } from 'react';
import { Button, type ButtonProps } from '@heroui/react';
import styles from './SellerButton.module.css';

/** Consistent compact actions for the seller workspace and its dialogs. */
const SellerButton = forwardRef<HTMLButtonElement, ButtonProps>(function SellerButton(
  { className, isIconOnly, color, ...props }, ref,
) {
  return <Button {...props} ref={ref} color={color} isIconOnly={isIconOnly}
    className={`${className || ''} ${styles.button} ${isIconOnly ? styles.icon : ''} ${color === 'primary' ? styles.primary : ''}`} />;
});

export default SellerButton;
