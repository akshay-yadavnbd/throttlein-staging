'use client';

/**
 * Shared text input for the admin panel — the workspace form look (40px,
 * 1px #e2e7eb border that darkens on focus), labels above the field.
 * Drop-in for HeroUI's `<Input>`; every prop passes through, and callers
 * can add `classNames` without losing the base styling.
 *
 * Labels sit outside by default so Chrome's autofill can't paint over a
 * floating label on first render. Pass labelPlacement="inside" to opt out.
 * For a search box with icon + clear, use `<SearchInput>`.
 */
import { Input, type InputProps } from '@heroui/react';

export default function AdminInput(props: InputProps) {
  const userClassNames = (props.classNames || {}) as Record<string, string>;
  return (
    <Input
      variant="bordered"
      labelPlacement="outside"
      placeholder=" "
      {...props}
      classNames={{
        ...userClassNames,
        label: `text-[12px] font-medium text-[#39434c] ${userClassNames.label || ''}`.trim(),
        inputWrapper:
          `h-10 min-h-10 border border-[#e2e7eb] data-[hover=true]:border-[#c9d1d8] group-data-[focus=true]:!border-[#59656f] shadow-none rounded-lg bg-white ${
            userClassNames.inputWrapper || ''
          }`.trim(),
        input: `text-[13px] text-[#252c32] placeholder:text-[#929ba3] ${userClassNames.input || ''}`.trim(),
        description: `text-[11px] text-[#74808a] ${userClassNames.description || ''}`.trim(),
        // Flush with the field edge — HeroUI pads the helper row by 4px,
        // which read as a misaligned hint under every input.
        helperWrapper: `px-0 pb-0 pt-1.5 ${userClassNames.helperWrapper || ''}`.trim(),
      }}
    />
  );
}
