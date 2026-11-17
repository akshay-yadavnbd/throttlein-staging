'use client';

/**
 * FigmaCheckbox — a plain-HTML checkbox built to match the Figma
 * "filters sidebar" spec exactly (node 3139:2359). Direct CSS spec
 * pulled from the Figma frame:
 *
 *     width: 20px; height: 20px;
 *     border-radius: 4px;
 *     border: 1px solid #BDBDBD;   // Interactives/Neutral/Secondary/border
 *     background: #fff;
 *
 *   - Checked:  fill swaps to #1a1410, border collapses to the same
 *               color, white check icon (14px, strokeWidth 3)
 *   - Label:    Poppins 14px, color #1a1410, 12px (gap-3) from box
 *
 * HeroUI's Checkbox couldn't be coaxed into matching the design because
 * its default rounding made the box read as a circle even with
 * className overrides. Replacing it with a small custom control gives
 * the storefront's filter sidebar a pixel-accurate match to Figma
 * without dragging in any extra library surface.
 *
 * Truncation: the outer label uses `flex` (not inline-flex) + `min-w-0`
 * so it participates correctly in a parent flex column's shrink-to-fit
 * behaviour. The children wrapper carries `min-w-0 flex-1 truncate` so
 * long category / brand names ellipsize cleanly instead of pushing the
 * row wider and triggering a horizontal sidebar scrollbar.
 *
 * The control is fully accessible:
 *   - `<input type="checkbox">` lives behind the visual box (sr-only)
 *   - Space / Enter toggle it via native browser behaviour
 *   - The visible box reacts to the input's :checked / :focus-visible
 *     state via peer-checked / peer-focus-visible Tailwind classes
 *   - The clickable surface is the entire label so taps anywhere on
 *     the row toggle the checkbox
 */

import React from 'react';

export interface FigmaCheckboxProps {
  /** Controlled state — whether the box is currently ticked. */
  checked: boolean;
  /** Fires with the new boolean state on toggle. */
  onChange: (next: boolean) => void;
  /** Optional disabled state — dims the row and blocks toggles. */
  disabled?: boolean;
  /** Optional className for the outer label element. */
  className?: string;
  /** Visible label text — wraps in the label so the whole row is clickable. */
  children?: React.ReactNode;
}

export default function FigmaCheckbox({
  checked,
  onChange,
  disabled = false,
  className = '',
  children,
}: FigmaCheckboxProps) {
  return (
    <label
      className={`flex items-center cursor-pointer select-none gap-3 min-w-0 ${
        disabled ? 'opacity-50 cursor-not-allowed' : ''
      } ${className}`}
    >
      {/* Real input — invisible but focusable, drives the visible
          box's appearance via `peer-checked:*` and `peer-focus-visible:*`. */}
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      {/* Visible box — 20×20, 4px radius, 1px #BDBDBD border on a
          white background per Figma node 3139:2359. Checked state
          fills with #1a1410 and collapses the border into the fill. */}
      <span
        aria-hidden
        className={
          'w-[20px] h-[20px] shrink-0 rounded-[4px] border border-[#BDBDBD] bg-white grid place-items-center transition-colors duration-150 ' +
          'peer-checked:bg-[#1a1410] peer-checked:border-[#1a1410] ' +
          'peer-focus-visible:shadow-[0_0_0_3px_rgba(26,20,16,0.15)]'
        }
      >
        {/* Check icon — 14px white stroke on the dark fill, 3px
            stroke weight so it carries visual weight at the small
            box size. Opacity tween mirrors the bg tween. */}
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`w-[14px] h-[14px] text-white transition-opacity duration-150 ${
            checked ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <polyline points="3 8.5 6.5 12 13 5" />
        </svg>
      </span>
      {children !== undefined && (
        // `min-w-0 flex-1 truncate` lets long names (long category
        // labels, long brand names) ellipsize within the parent
        // column instead of overflowing horizontally.
        <span className="font-poppins text-[14px] leading-tight text-[#1a1410] min-w-0 flex-1 truncate">
          {children}
        </span>
      )}
    </label>
  );
}
