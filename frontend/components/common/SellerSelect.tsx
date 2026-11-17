"use client";

import { useRef } from 'react';
import { Select, SelectItem } from '@heroui/react';
import styles from './SellerSelect.module.css';

export type SellerSelectOption = { value: string; label: string; disabled?: boolean };

type Props = {
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  options: SellerSelectOption[];
  disabled?: boolean;
  fullWidth?: boolean;
  id?: string;
};

/** Styled single-select with keyboard navigation, typeahead and managed focus. */
export default function SellerSelect({ ariaLabel, value, onChange, options, disabled, fullWidth, id }: Props) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  const selected = options.find(option => option.value === value);
  return <div ref={wrapperRef} className={`${styles.root} ${fullWidth ? styles.fullWidth : ''}`} onKeyDownCapture={event => {
    if (event.key === 'Escape') restoreFocus.current = true;
  }}><Select
    id={id}
    aria-label={ariaLabel}
    className={styles.control}
    classNames={{ trigger: styles.trigger, value: styles.value, selectorIcon: styles.icon, popoverContent: styles.popover, listbox: styles.listbox, listboxWrapper: styles.listboxWrapper }}
    selectedKeys={selected ? [`option:${selected.value}`] : []}
    disabledKeys={options.filter(option => option.disabled).map(option => `option:${option.value}`)}
    onSelectionChange={keys => {
      if (keys === 'all') return;
      const key = Array.from(keys)[0];
      const option = options.find(item => `option:${item.value}` === key);
      if (option) { restoreFocus.current = true; onChange(option.value); }
    }}
    onClose={() => {
      if (!restoreFocus.current) return;
      restoreFocus.current = false;
      requestAnimationFrame(() => wrapperRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }));
    }}
    isDisabled={disabled}
    disallowEmptySelection
    disableAnimation
    variant="bordered"
    size="sm"
    placeholder="Select an option"
    popoverProps={{ placement: 'bottom-end', offset: 6, shouldBlockScroll: false }}
    listboxProps={{ emptyContent: 'No options available' }}
  >
    {options.map(option => <SelectItem key={`option:${option.value}`} textValue={option.label} classNames={{ base: styles.option, title: styles.optionText, selectedIcon: styles.check }}>{option.label}</SelectItem>)}
  </Select></div>;
}
