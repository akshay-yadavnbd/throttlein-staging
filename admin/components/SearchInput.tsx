'use client';

/**
 * Shared search-input component for the admin panel.
 *
 * Bordered pill style — 2px #e0e0e0 border, hover deepens to #a3a3a3,
 * focus snaps to brand-black. Magnifier icon prepended, clearable × button
 * appended when there's text. Matches the same style used on the seller
 * dashboard's Brands & Categories search controls so the visual language
 * stays consistent across the two apps.
 *
 * Usage:
 *   <SearchInput
 *     value={search}
 *     onChange={setSearch}
 *     placeholder="Search sellers…"
 *     className="w-[320px]"
 *   />
 */

import { Input } from '@heroui/react';

export default function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className = '',
  size = 'md',
  autoFocus = false,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  autoFocus?: boolean;
}) {
  return (
    <Input
      size={size}
      variant="bordered"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoFocus={autoFocus}
      isClearable
      onClear={() => onChange('')}
      startContent={
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-4 h-4 text-default-500 shrink-0"
          aria-hidden
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
      }
      className={className}
      classNames={{
        inputWrapper:
          'bg-white border-2 border-[#e0e0e0] data-[hover=true]:border-[#a3a3a3] group-data-[focus=true]:!border-brand-black transition rounded-lg h-11 shadow-none',
        input: 'text-sm placeholder:text-default-500',
      }}
    />
  );
}
