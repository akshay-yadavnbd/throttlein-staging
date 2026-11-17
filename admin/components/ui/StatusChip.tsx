'use client';

import { Chip } from '@heroui-v3/react';

/**
 * One status chip for the whole admin panel.
 *
 * ── WHAT THIS REPLACES ──────────────────────────────────────────────
 * The audit found 15 independent `Record<status, colour>` maps in admin
 * and 6 more in the seller dashboard — `statusColor`, `accountStatusColor`,
 * `STATUS_COLOR`, `SHIPMENT_COLOR`, `orderStatusColor`, `sellerStatusColor`
 * and several inline ternaries. They disagreed: the same word ("pending")
 * mapped to different colours on different pages, and several were
 * hand-styled with raw `emerald-*`/`amber-*`/`rose-*` classes because
 * HeroUI v2 only let us theme `primary`.
 *
 * v3 themes success/warning/danger as real tokens (see themes/nude.css),
 * so status colour is now a lookup, once, here.
 *
 * ── WHY A VOCABULARY, NOT A COLOUR PROP ─────────────────────────────
 * Call sites pass the DOMAIN status (`'pending'`, `'delivered'`, `'rto'`),
 * never a colour. That's the point: it makes "which colour is pending?" a
 * question with one answer, and it means a design change is one edit here
 * rather than 21.
 *
 * Unknown values fall through to neutral rather than throwing — a new
 * backend status should look unstyled, not crash a list page.
 */

/** Semantic buckets. Every domain status maps onto one of these. */
type Tone = 'neutral' | 'positive' | 'attention' | 'negative' | 'info';

/**
 * Tone → explicit utility classes, NOT HeroUI's `color` prop.
 *
 * ── WHY THIS BYPASSES `<Chip color=…>` ──────────────────────────────
 * On HeroUI v3.2.3 the Chip's colour variant collapsed to `success` for
 * EVERY value on one particular page (the admin dashboard) while working
 * correctly on others. Reproduced with a raw `<Chip color="danger">`
 * rendered side by side with a `<Chip color="warning">` on that page: both
 * emitted `chip--success`, exactly one colour class each, so it was not a
 * class-merge collision. The same raw chips rendered correctly on a
 * different route, and the compiled module was verified live in the
 * browser to contain the correct tone→colour map.
 *
 * I could not identify the mechanism. What I could establish is that it is
 * upstream of this component — it is the Chip's own variant computation,
 * not our mapping — and that it silently produces WRONG INFORMATION:
 * "Cancelled" rendering in success green on an orders list is worse than
 * an ugly chip, because someone will read it and believe it.
 *
 * So the colour is applied with explicit classes over the theme's own
 * `*-soft` / `*-soft-foreground` tokens. That is deterministic, still
 * fully themed (change the token, every chip follows), and immune to
 * whatever the variant system is doing. `variant="tertiary"` keeps HeroUI's
 * shape, size and typography while contributing no colour of its own.
 *
 * Revisit when v3 updates: if `color` becomes reliable, this can go back
 * to the prop.
 */
/*
 * Text colour is the RAW semantic token (`text-success`), not the
 * `*-soft-foreground` derivative. The soft foregrounds mix the colour
 * toward black, which read as muddy pastels next to HeroUI's own docs
 * chips — per product decision these should be vibrant. The raw tokens
 * were chroma-tuned for exactly this in themes/nude.css (#15803D /
 * #B45309 / #C2261C / #1D6FA5) and clear WCAG AA on white; the soft tint
 * behind them is nearly white, so measured contrast stays AA (verified
 * live via pixel sampling: 4.6–5.5:1 on the rendered chips).
 * `info` composes its tint with `bg-info/10` because --info is our own
 * token — HeroUI derives no `-soft` pair for it.
 */
const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-default-soft text-default-soft-foreground',
  positive: 'bg-success-soft text-success',
  attention: 'bg-warning-soft text-warning',
  negative: 'bg-danger-soft text-danger',
  info: 'bg-info/10 text-info',
};

/**
 * The full status vocabulary across sellers, orders, shipments, KYC,
 * refunds, brand requests, pages and blog posts — collected from the 21
 * maps this replaces. Keys are lowercased before lookup, so callers don't
 * have to care whether the API said `Pending` or `pending`.
 */
const STATUS_TONE: Record<string, Tone> = {
  // ── Lifecycle: approved / live / done ──
  active: 'positive',
  approved: 'positive',
  verified: 'positive',
  published: 'positive',
  live: 'positive',
  // Static-route SEO: an override Page record exists for the route.
  seo_override: 'positive',
  completed: 'positive',
  delivered: 'positive',
  paid: 'positive',
  settled: 'positive',
  fulfilled: 'positive',
  success: 'positive',
  in_stock: 'positive',

  // ── Waiting on someone ──
  pending: 'attention',
  pending_approval: 'attention',
  // Order lifecycle: 'placed' is the initial state (no one is late yet, so
  // neutral); 'confirmed' means the seller accepted and now owes shipment.
  placed: 'neutral',
  confirmed: 'attention',
  submitted: 'attention',
  requested: 'attention',
  under_review: 'attention',
  in_review: 'attention',
  processing: 'attention',
  awaiting_pickup: 'attention',
  // Label generated and courier booked, parcel NOT yet collected. A
  // distinct state from `shipped` — the carrier reports it as PICKUP
  // SCHEDULED and the box is still with the seller.
  pickup_scheduled: 'attention',
  scheduled: 'attention',
  partial: 'attention',
  low_stock: 'attention',
  draft: 'neutral',

  // ── Shipment vocabulary (lib/orderStatusDisplay StatusKey) ──
  // These are the keys every order screen renders; the tones mirror
  // STATUS_KEY_TONE there. A failed pickup / delivery is the seller's
  // problem to act on, so it reads as negative, not merely "attention".
  pickup_failed: 'negative',
  delivery_failed: 'negative',
  shipping_error: 'negative',
  returning: 'negative',
  multiple: 'neutral',

  // ── In flight ──
  shipped: 'info',
  in_transit: 'info',
  out_for_delivery: 'info',
  picked_up: 'info',
  // Shiprocket shipment lifecycle (admin order detail): queued = not
  // yet pushed; pushed/awb = registered with the courier.
  queued: 'neutral',
  pushed: 'info',
  awb: 'info',
  return_pickup: 'attention',

  // ── Failed / stopped ──
  rejected: 'negative',
  declined: 'negative',
  failed: 'negative',
  undelivered: 'attention',
  lost: 'negative',
  rto_initiated: 'negative',
  rto_in_transit: 'negative',
  rto_delivered: 'negative',
  cancelled: 'negative',
  canceled: 'negative',
  refunded: 'negative',
  returned: 'negative',
  rto: 'negative',
  ndr: 'negative',
  suspended: 'negative',
  blocked: 'negative',
  expired: 'negative',
  out_of_stock: 'negative',
  unverified: 'negative',

  // ── Not started ──
  not_started: 'neutral',
  inactive: 'neutral',
  unpublished: 'neutral',
  archived: 'neutral',
  none: 'neutral',
};

/** Normalise `Pending Approval`, `pending-approval`, `PENDING_APPROVAL`. */
function normalise(status: string): string {
  return String(status || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

/** Turn a snake/kebab status into something a human reads. */
function humanise(status: string): string {
  const s = String(status || '').trim();
  if (!s) return '—';
  return s
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export type StatusChipProps = {
  /** Domain status, any casing. e.g. 'pending', 'Out For Delivery', 'RTO'. */
  status: string;
  /** Override the rendered text. The tone still derives from `status`. */
  label?: string;
  /**
   * Secondary wording shown in smaller muted text under the chip — the
   * courier's own phrase ("Pickup Exception") behind our plain label
   * ("Pickup failed"). Ops users need it to talk to the courier; it is
   * never the headline (UX audit X1).
   */
  hint?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

export default function StatusChip({
  status,
  label,
  hint,
  size = 'sm',
  className = '',
}: StatusChipProps) {
  const tone = STATUS_TONE[normalise(status)] ?? 'neutral';

  const chip = (
    <Chip
      // `tertiary` is the colourless variant — it contributes shape,
      // padding and type but no background or text colour, so the tone
      // classes below aren't fighting it. See the note on TONE_CLASS for
      // why the colour isn't passed via `color`.
      className={`whitespace-nowrap ${TONE_CLASS[tone]} ${className}`}
      size={size}
      variant="tertiary"
    >
      {/* The status TEXT is always rendered — never colour alone. The audit
          flagged colour-only status indication (HeroStat's accent dots, the
          KYC file border tints) as a WCAG 1.4.1 failure. */}
      <Chip.Label>{label ?? humanise(status)}</Chip.Label>
    </Chip>
  );
  if (!hint) return chip;
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      {chip}
      <span className="text-[13px] leading-tight text-muted">{hint}</span>
    </span>
  );
}

/** Exported so a page can ask "is this a failure?" without duplicating the
 *  vocabulary — e.g. to decide whether to show a retry action. */
export function statusTone(status: string): Tone {
  return STATUS_TONE[normalise(status)] ?? 'neutral';
}
