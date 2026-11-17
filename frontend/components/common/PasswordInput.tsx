'use client';

import { useState } from 'react';
import { Input } from '@heroui/react';

type InputProps = React.ComponentProps<typeof Input>;
type Props = Omit<InputProps, 'type' | 'endContent'>;

/**
 * Password input with show/hide eye toggle.
 *
 * Defaults:
 *  - `variant="bordered"` (matches the other auth/profile inputs)
 *  - A small lock icon in the `startContent` slot, mirroring the
 *    person/mail/phone icons used in the sign-in / sign-up forms.
 *  - `classNames` for the bordered look (2px border that deepens to
 *    `default-400` on hover and `brand-black` on focus) — merged with
 *    any classNames the caller passes so overrides still work.
 *
 * Eye toggle uses HeroUI's `endContent` slot:
 *  - SVG sized in `em` so it inherits font-size and aligns vertically
 *  - `pointer-events-none` on the SVG so clicks hit the button
 *  - `tabIndex={-1}` keeps Tab order on the actual form fields
 */
export default function PasswordInput(props: Props) {
  const [visible, setVisible] = useState(false);

  // Merge bordered styling with whatever the caller passed so the
  // default look applies everywhere without overriding explicit
  // per-call customisations.
  const mergedClassNames = {
    ...DEFAULT_BORDERED_CLASSES,
    ...(props.classNames || {}),
    inputWrapper: [
      DEFAULT_BORDERED_CLASSES.inputWrapper,
      (props.classNames as any)?.inputWrapper || '',
    ]
      .filter(Boolean)
      .join(' '),
  };

  return (
    <Input
      variant={props.variant ?? 'bordered'}
      startContent={
        props.startContent ?? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-4 h-4 text-default-400 shrink-0"
            aria-hidden
          >
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        )
      }
      {...props}
      classNames={mergedClassNames}
      type={visible ? 'text' : 'password'}
      endContent={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          tabIndex={-1}
          className="flex items-center justify-center self-center text-default-400 hover:text-default-700 transition focus:outline-none"
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      }
    />
  );
}

/** Default bordered styling — matches the auth/profile sign-in inputs. */
const DEFAULT_BORDERED_CLASSES = {
  inputWrapper: [
    'h-12 bg-white',
    'border-2 border-default-200',
    'data-[hover=true]:border-default-400',
    'group-data-[focus=true]:border-brand-black',
  ].join(' '),
  label: 'text-xs font-semibold',
  input: 'text-sm',
};

function EyeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1.25em"
      height="1.25em"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="pointer-events-none flex-shrink-0"
      aria-hidden
    >
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1.25em"
      height="1.25em"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="pointer-events-none flex-shrink-0"
      aria-hidden
    >
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}
