'use client';

import { Button, Tooltip } from '@heroui-v3/react';
import type { ReactNode } from 'react';

/**
 * An icon-only button that cannot ship without an accessible name.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────
 * This is the audit's single worst accessibility finding, and it's
 * structural rather than a one-off mistake:
 *
 *   - 8 of 14 `isIconOnly` HeroUI buttons in admin had no `aria-label`
 *   - 67 of 69 raw `<button>` elements had none
 *   - 8 of 16 seller dashboard pages had no `aria-label` anywhere at all
 *
 * The move-up/move-down arrow pairs in Testimonials and PromoBlocksEditor
 * are pure SVG, so a screen reader announces literally nothing — the
 * control is unusable and undiscoverable.
 *
 * A lint rule would help, but the durable fix is to make the label part of
 * the TYPE. `label` is required, so an unlabelled icon button is a
 * compile error rather than a review comment somebody has to catch.
 *
 * ── THE LABEL DOES DOUBLE DUTY ─────────────────────────────────────
 * It becomes both the `aria-label` and the tooltip. That's deliberate:
 * icon-only controls are also a problem for sighted users who don't
 * recognise the glyph, and keeping the two in sync by construction means
 * they can't drift apart.
 */

export type IconButtonProps = {
  /**
   * What the button DOES, as a verb phrase: "Move up", "Delete seller",
   * "Edit page". Required — see the note above.
   *
   * Not "arrow-up" and not "button": it's read aloud in place of the icon,
   * so it has to describe the action, not the picture.
   */
  label: string;
  /** The glyph. Sized by the button variant, so don't set dimensions. */
  children: ReactNode;
  onPress?: () => void;
  size?: 'sm' | 'md' | 'lg';
  /**
   * `tertiary` (default) is the quiet table-row action.
   * `danger` for destructive, `secondary` for a bordered toolbar button.
   */
  variant?: 'primary' | 'secondary' | 'tertiary' | 'outline' | 'ghost' | 'danger';
  isDisabled?: boolean;
  /** Set false for dense toolbars where N tooltips would be noise. */
  showTooltip?: boolean;
  /** For toggle buttons — announces on/off state. */
  isPressed?: boolean;
  className?: string;
  type?: 'button' | 'submit' | 'reset';
};

export default function IconButton({
  label,
  children,
  onPress,
  size = 'sm',
  variant = 'tertiary',
  isDisabled = false,
  showTooltip = true,
  isPressed,
  className,
  type = 'button',
}: IconButtonProps) {
  const button = (
    <Button
      isIconOnly
      aria-label={label}
      // `aria-pressed` only when this is genuinely a toggle. Setting it
      // unconditionally would announce every plain button as a toggle.
      aria-pressed={isPressed}
      className={className}
      isDisabled={isDisabled}
      size={size}
      type={type}
      variant={variant}
      onPress={onPress}
    >
      {children}
    </Button>
  );

  // A disabled button doesn't receive hover/focus in most browsers, so a
  // tooltip on it would never open — skip the wrapper rather than render a
  // dead one.
  if (!showTooltip || isDisabled) return button;

  return (
    <Tooltip>
      {button}
      <Tooltip.Content>{label}</Tooltip.Content>
    </Tooltip>
  );
}
