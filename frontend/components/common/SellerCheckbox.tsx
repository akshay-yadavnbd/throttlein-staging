'use client';

import { Checkbox, type CheckboxProps } from '@heroui/react';

/**
 * The seller workspace's checkbox: an 18px square with a 1px grey
 * border that fills charcoal with a lime tick when selected. HeroUI's
 * default draws a thick rounded box that reads heavier than every input
 * beside it; the label is 12px like the rest of the form copy.
 *
 * Disabled boxes keep full opacity (the copy must stay readable) and
 * show a not-allowed cursor instead.
 */
export default function SellerCheckbox({ classNames, ...props }: CheckboxProps) {
  return (
    <Checkbox
      size="sm"
      {...props}
      classNames={{
        ...classNames,
        base: `max-w-full items-start gap-0 p-0 m-0 data-[disabled=true]:opacity-100 data-[disabled=true]:cursor-not-allowed ${classNames?.base ?? ''}`,
        wrapper: `mr-2.5 mt-px h-[18px] w-[18px] shrink-0 rounded-[5px] border border-[#c5ced5] bg-white shadow-none before:hidden after:rounded-[4px] after:bg-[#191d21] group-data-[hover=true]:border-[#8d99a3] group-data-[selected=true]:border-[#191d21] group-data-[focus-visible=true]:ring-2 group-data-[focus-visible=true]:ring-[#59656f] group-data-[focus-visible=true]:ring-offset-2 group-data-[disabled=true]:border-[#dfe5ea] group-data-[disabled=true]:bg-[#f3f5f7] ${classNames?.wrapper ?? ''}`,
        icon: `h-3 w-3 text-[#bdff00] ${classNames?.icon ?? ''}`,
        label: `text-[12px] leading-5 text-[#323d46] group-data-[disabled=true]:text-[#8d99a3] ${classNames?.label ?? ''}`,
      }}
    />
  );
}
