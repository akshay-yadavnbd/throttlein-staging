'use client';

/**
 * Shared textarea for the admin panel — same look and label placement as
 * <AdminInput>, for multi-line text. Drop-in for HeroUI's `<Textarea>`.
 */
import { Textarea, type TextAreaProps } from '@heroui/react';

export default function AdminTextarea(props: TextAreaProps) {
  const userClassNames = (props.classNames || {}) as Record<string, string>;
  return (
    <Textarea
      variant="bordered"
      labelPlacement="outside"
      placeholder=" "
      {...props}
      classNames={{
        ...userClassNames,
        label: `text-[12px] font-medium text-[#39434c] ${userClassNames.label || ''}`.trim(),
        inputWrapper:
          `border border-[#e2e7eb] data-[hover=true]:border-[#c9d1d8] group-data-[focus=true]:!border-[#59656f] shadow-none rounded-lg bg-white ${
            userClassNames.inputWrapper || ''
          }`.trim(),
        input: `text-[13px] text-[#252c32] placeholder:text-[#929ba3] ${userClassNames.input || ''}`.trim(),
        description: `text-[11px] text-[#74808a] ${userClassNames.description || ''}`.trim(),
        helperWrapper: `px-0 pb-0 pt-1.5 ${userClassNames.helperWrapper || ''}`.trim(),
      }}
    />
  );
}
