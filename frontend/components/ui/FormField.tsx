'use client';

import {
  Description,
  FieldError,
  Input,
  Label,
  TextArea,
  TextField,
} from '@heroui-v3/react';
import type { ReactNode } from 'react';

/**
 * The text field for every admin form.
 *
 * ── WHAT THIS REPLACES ──────────────────────────────────────────────
 * FIVE competing input skins, which is why forms looked different from
 * page to page:
 *
 *   1. admin `AdminInput` — forces `variant="bordered"`,
 *      `labelPlacement="outside"`, `h-11`, `border-2 border-[#e0e0e0]`,
 *      and wins specificity with `!border-brand-black`
 *   2. frontend `FormField` — a 52px pill, 1px `#e0e0e0`, filled→`bg-[#EEE]`
 *   3. `ProductForm`'s local `INPUT_PROPS` — 44px, `border-2`, file-scoped
 *   4. `SELECT_CLASS` in the same file — a fifth skin for native selects
 *   5. raw HeroUI `<Input variant="bordered">` — 21 sites bypassing (1)
 *
 * Plus the drift within them: 41 of 51 seller Inputs set
 * `labelPlacement="outside"` and 10 didn't, so floating labels sat next to
 * stacked labels on the same screen; 14 admin call sites re-passed
 * `labelPlacement` redundantly, and 10 overrode `classNames` outright,
 * defeating the wrapper's purpose.
 *
 * ── WHY THE SKIN IS NOT SET HERE ────────────────────────────────────
 * All five of those baked pixel values and hex borders into the component.
 * That's what made them impossible to restyle. Here the appearance comes
 * from the theme's `--field-*` tokens (background, border, placeholder,
 * radius) in themes/nude.css. Changing the input look is a theme edit, not
 * 132 call-site edits.
 *
 * Notably `--field-border` is `#9C8F7E`, chosen because it clears 3.16:1
 * against white — WCAG 2.1 SC 1.4.11 requires >= 3.0 for the boundary of a
 * form control, and the old `#e0e0e0` managed 1.58:1. Every one of the five
 * skins failed that.
 *
 * ── VALIDATION ──────────────────────────────────────────────────────
 * `error` drives both `isInvalid` and `FieldError`, so the visual state and
 * the announced message cannot disagree. TextField hides the description
 * automatically while invalid, so help text doesn't compete with the error.
 * The audit found no form-level validation summary anywhere and
 * `isInvalid`/`errorMessage` passed inconsistently.
 */

type BaseProps = {
  /** Visible label. Always required — a placeholder is not a label. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Help text. Hidden automatically while `error` is set. */
  description?: ReactNode;
  /** Validation message. Presence marks the field invalid. */
  error?: string | null;
  isRequired?: boolean;
  isDisabled?: boolean;
  isReadOnly?: boolean;
  /** Form field name, for native submission. */
  name?: string;
  className?: string;
  autoFocus?: boolean;
};

export type FormFieldProps = BaseProps & {
  type?: 'text' | 'email' | 'password' | 'url' | 'tel' | 'number' | 'search';
  /** Renders a TextArea instead of an Input. */
  multiline?: false;
};

export type FormTextAreaProps = BaseProps & {
  multiline: true;
  rows?: number;
};

/**
 * One component for both single-line and multiline, because the label /
 * description / error contract is identical and splitting them produced
 * `AdminInput` + `AdminTextarea` that drifted apart.
 */
export default function FormField(props: FormFieldProps | FormTextAreaProps) {
  const {
    label,
    value,
    onChange,
    placeholder,
    description,
    error,
    isRequired = false,
    isDisabled = false,
    isReadOnly = false,
    name,
    className = '',
    autoFocus = false,
  } = props;

  const isInvalid = Boolean(error);

  return (
    <TextField
      fullWidth
      autoFocus={autoFocus}
      className={className}
      isDisabled={isDisabled}
      isInvalid={isInvalid}
      isReadOnly={isReadOnly}
      isRequired={isRequired}
      name={name}
      // ARIA validation, not native: the pages here validate on submit and
      // render their own messages. `native` would also trigger the browser's
      // own bubble, giving two error UIs for one field.
      validationBehavior="aria"
      value={value}
      // v3 hands the string straight through — no `e.target.value`. This is
      // the most common v2→v3 slip, so it's centralised here.
      onChange={onChange}
      {...(props.multiline ? {} : { type: props.type ?? 'text' })}
    >
      <Label>{label}</Label>

      {props.multiline ? (
        <TextArea placeholder={placeholder} rows={props.rows ?? 4} />
      ) : (
        <Input placeholder={placeholder} />
      )}

      {/* Description first, error second. TextField hides the description
          while invalid, so only one is ever visible. */}
      {description && <Description>{description}</Description>}
      {isInvalid && <FieldError>{error}</FieldError>}
    </TextField>
  );
}
