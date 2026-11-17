'use client';

/**
 * Shared toggle for the admin panel — the workspace look (small charcoal
 * track, plain white thumb) instead of HeroUI's default primary-coloured
 * switch with its glow. Drop-in for HeroUI's `<Switch>`; every prop
 * passes through.
 */
import { Switch, type SwitchProps } from '@heroui/react';
import styles from './AdminSwitch.module.css';

export default function AdminSwitch({ classNames, className, ...props }: SwitchProps) {
  const on = !!props.isSelected;
  return (
    <Switch
      size="sm"
      {...props}
      className={`${styles.base} ${on ? styles.on : ''} ${className || ''}`}
      classNames={{
        ...classNames,
        wrapper: `${styles.wrapper} ${classNames?.wrapper || ''}`,
        thumb: `${styles.thumb} ${classNames?.thumb || ''}`,
        label: `${styles.label} ${classNames?.label || ''}`,
      }}
    />
  );
}
