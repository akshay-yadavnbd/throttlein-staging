'use client';

/**
 * Shared form primitives — every auth form (customer + seller login /
 * signup, forgot / reset password, seller verify) and the contact form
 * render with the same visual language:
 *
 *   - Label ABOVE the input; required fields get a red asterisk.
 *   - 44px input, white, 1px #d6d6d6 border, 10px radius. Hover darkens
 *     the border; focus turns it black with a soft grey ring. Once the
 *     field has a value the background tints to #f6f6f6.
 *   - Optional leading icon (`icon`) and invalid state (`invalid`): red
 *     border + red ring, paired with `FormField`'s `error` line.
 *   - `FormField` takes `hint` (grey helper text) or `error` (red, with an
 *     icon) and renders it under the input, so validation reads the same
 *     on every form.
 *
 * Plain HTML inputs, not HeroUI, so the style is stable regardless of
 * theme tweaks. Pair `FormField` with `FormInput` / `FormPasswordInput` /
 * `FormTextarea`.
 */

import { useId, useState } from 'react';
import type {
  InputHTMLAttributes,
  TextareaHTMLAttributes,
  ReactNode,
} from 'react';

export function FormField({
  label,
  required,
  children,
  htmlFor,
  hint,
  error,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
  htmlFor?: string;
  /** Grey helper line under the input. Hidden while `error` is set. */
  hint?: ReactNode;
  /** Red validation message under the input. */
  error?: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="flex flex-col gap-2">
      <span className="text-sm leading-[1.32] font-semibold text-[#000]">
        {label}
        {required && (
          // Red asterisk on required fields — purely visual; the
          // `required` attribute on the input itself handles
          // browser-side validation.
          <span aria-hidden className="text-[#dc2626] ml-0.5">*</span>
        )}
      </span>
      {children}
      {error ? (
        <span role="alert" className="-mt-0.5 inline-flex items-start gap-1.5 text-xs leading-[1.4] text-[#dc2626]">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true">
            <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
          </svg>
          <span>{error}</span>
        </span>
      ) : hint ? (
        <span className="-mt-0.5 text-xs leading-[1.4] text-[#6b6b6b]">{hint}</span>
      ) : null}
    </label>
  );
}

/* One class string for every text-like input, so the three components
   below can never drift apart. */
function inputClass(filled: boolean, invalid: boolean, lead: 'none' | 'icon' | 'prefix', extra: string) {
  return (
    'w-full h-11 rounded-[10px] border text-sm text-[#141414] transition ' +
    (lead === 'icon' ? 'pl-10 pr-3.5 ' : lead === 'prefix' ? 'pl-[52px] pr-3.5 ' : 'px-3.5 ') +
    (filled ? 'bg-[#f6f6f6] ' : 'bg-white ') +
    (invalid
      ? 'border-[#dc2626] focus:border-[#dc2626] focus:shadow-[0_0_0_3px_rgba(220,38,38,0.12)] '
      : 'border-[#d6d6d6] hover:border-[#a8a8ad] focus:border-[#141414] focus:shadow-[0_0_0_3px_rgba(20,20,20,0.10)] ') +
    'placeholder:text-[#9b9b9b] focus:outline-none ' +
    extra
  );
}

function IconSlot({ icon, invalid }: { icon: ReactNode; invalid: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 [&>svg]:h-4 [&>svg]:w-4 ${invalid ? 'text-[#dc2626]' : 'text-[#8a8a8a]'}`}
    >
      {icon}
    </span>
  );
}

/** Fixed text at the start of the field, e.g. "+91" on a mobile number. */
function PrefixSlot({ text }: { text: string }) {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-semibold tabular-nums text-[#141414]">
      {text}
    </span>
  );
}

type Extras = {
  /** Leading icon (18px stroke SVG), e.g. `<MailIcon />`. */
  icon?: ReactNode;
  /** Fixed leading text instead of an icon, e.g. "+91". */
  prefix?: string;
  /** Red border + ring. Pair with `FormField`'s `error`. */
  invalid?: boolean;
};

export function FormInput(props: InputHTMLAttributes<HTMLInputElement> & Extras) {
  const { className = '', value, defaultValue, onChange, icon, prefix, invalid = false, ...rest } = props;

  // Whether the input has a value, to tint the background once filled.
  // Controlled inputs derive it from `value`; uncontrolled ones track
  // their own typing from `defaultValue` onwards.
  const [typedFilled, setTypedFilled] = useState(() => !!String(defaultValue ?? '').length);
  const filled = value !== undefined ? !!String(value).length : typedFilled;

  const input = (
    <input
      {...rest}
      aria-invalid={invalid || undefined}
      value={value}
      defaultValue={defaultValue}
      onChange={(e) => {
        setTypedFilled(!!e.target.value.length);
        onChange?.(e);
      }}
      className={inputClass(filled, invalid, prefix ? 'prefix' : icon ? 'icon' : 'none', className)}
    />
  );
  if (!icon && !prefix) return input;
  return (
    <div className="relative">
      {prefix ? <PrefixSlot text={prefix} /> : <IconSlot icon={icon} invalid={invalid} />}
      {input}
    </div>
  );
}

export function FormPasswordInput(
  props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & Extras,
) {
  const [show, setShow] = useState(false);
  const { className = '', value, defaultValue, onChange, icon, invalid = false, ...rest } = props;

  // Same filled-state tracking as FormInput.
  const [typedFilled, setTypedFilled] = useState(() => !!String(defaultValue ?? '').length);
  const filled = value !== undefined ? !!String(value).length : typedFilled;

  return (
    // Relative wrapper so the show/hide toggle can absolute-position
    // inside the input's right edge.
    <div className="relative">
      {icon && <IconSlot icon={icon} invalid={invalid} />}
      <input
        {...rest}
        aria-invalid={invalid || undefined}
        value={value}
        defaultValue={defaultValue}
        onChange={(e) => {
          setTypedFilled(!!e.target.value.length);
          onChange?.(e);
        }}
        type={show ? 'text' : 'password'}
        className={inputClass(filled, invalid, icon ? 'icon' : 'none', 'pr-12 ' + className)}
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-[#6b6b6b] transition hover:bg-[#f0f0f0] hover:text-[#141414]"
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-6.5 0-10-7-10-7a18.5 18.5 0 0 1 5.06-5.94" />
      <path d="M9.9 5.08A10.94 10.94 0 0 1 12 5c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19" />
      <path d="M9.88 9.88a3 3 0 0 0 4.24 4.24" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

export function FormTextarea(
  props: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean },
) {
  const { className = '', invalid = false, ...rest } = props;
  return (
    <textarea
      {...rest}
      aria-invalid={invalid || undefined}
      className={
        'w-full p-4 rounded-[10px] border bg-white text-sm text-[#141414] transition resize-none ' +
        (invalid
          ? 'border-[#dc2626] focus:shadow-[0_0_0_3px_rgba(220,38,38,0.12)] '
          : 'border-[#d6d6d6] hover:border-[#a8a8ad] focus:border-[#141414] focus:shadow-[0_0_0_3px_rgba(20,20,20,0.10)] ') +
        'placeholder:text-[#9b9b9b] focus:outline-none ' +
        className
      }
    />
  );
}

/* ── Leading icons for the auth forms ───────────────────────────────── */
const iconProps = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const,
};
export const MailIcon = () => (
  <svg {...iconProps}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
);
export const LockIcon = () => (
  <svg {...iconProps}><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
);
export const UserIcon = () => (
  <svg {...iconProps}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
);
export const PhoneIcon = () => (
  <svg {...iconProps}><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" /></svg>
);

/**
 * Keydown guard for digits-only fields: swallows letters and symbols at
 * the keyboard, so the field never shows a character it will drop. Keys
 * with modifiers (paste, select-all) and navigation keys pass through;
 * pasted text is cleaned by the field's onChange.
 */
export function digitsOnlyKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key.length === 1 && !/\d/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) e.preventDefault();
}

/** Stable id for pairing a label with an input across the helpers. */
export function useFieldId(prefix: string) {
  const id = useId();
  return `${prefix}-${id}`;
}
