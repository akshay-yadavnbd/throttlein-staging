# Commerce audit — remediation record

Companion to `2026-09-21-commerce-audit.md`. One entry per finding: what
changed, where, and how it was verified. Verification is by the isolated
harness `2026-09-21-commerce-fixes-verify.cjs` (fakes only — no database,
network, payment or shipment calls), plus the existing backend suites.

Status legend: **Fixed** (code changed + verified) · **Fixed (code)**
(changed, no automated assertion yet) · **Owner action** (needs a human).

---

## P0 — containment

### A01 · Credentials committed to Git — *partly done, owner action required*

`backend/.env`, `frontend/.env` and `admin/.env` are no longer tracked
(`git rm --cached`), `.gitignore` now covers all three, and
`*.env.example` files were generated with **keys only, values stripped**
(verified: no `KEY=value` line survives in any example).

> **This does not un-expose anything.** The values still exist in earlier
> commits. Rotate every secret that was in those files — Mongo URI, JWT
> secret, super-admin password, AWS key/secret, Shiprocket password,
> Razorpay key secret, the frontend revalidation secret — and then purge
> history (`git filter-repo`) or treat the repo as compromised. No
> credential was read, printed or changed during this work.

### A02 · Payment not bound to the order — **Fixed**

New `models/CheckoutIntent.js`: an immutable, customer-owned snapshot
(line items at resolved prices, address, totals, `amountPaise`, currency,
provider order id) written by `/razorpay/init` **before** any money moves.
`/razorpay/verify` now fetches the provider payment and asserts
order-id / captured-state / amount / currency against that intent, then
finalizes **from the snapshot** — never from the live cart. The duplicate
lookup is scoped to the intent's owner.

*Verified:* a ₹100 capture is refused for a ₹50,000 intent; a matching
capture finalizes at the intent's total even when the live cart differs;
a different account cannot redeem the payment.

### A04 · Private files reachable via the public proxy — **Fixed**

`routes/fileRoutes.js` now deny-lists any path segment named `kyc` or
`return-evidence`, restricts `sellers/<id>/…` to the `products` purpose,
and otherwise requires a known public top-level prefix — refusing with
`no-store` and a log line. Return evidence uploads moved to their own
private `return-evidence/` prefix and are presigned in responses (new
`attachments[].url` handling in `utils/signImages.js`). The disk-mode
`/uploads` static mount now serves image/video extensions only.

*Verified:* a synthetic KYC key is refused **without S3 being contacted**;
`products/…` still serves.

### A03 · Server-rendered HTML bypassed sanitization — **Fixed**

`RichTextView` imports `isomorphic-dompurify`, so the same allowlist runs
during SSR and in the browser. The raw-HTML fallback is gone: if a
sanitizer is somehow unavailable the content renders as escaped text.

*Verified:* SSR output of `<img onerror=…>` contains no `onerror`, and
benign markup survives.

### A05 · Unsafe admin bootstrap — **Fixed (code)**

`utils/seedAdmin.js` requires explicit `SUPER_ADMIN_EMAIL` +
`SUPER_ADMIN_PASSWORD` (no defaults), rejects placeholder/short
passwords, **never** promotes an existing account, and never logs the
password. Unconfigured deployments simply skip the bootstrap.

---

## P1 — checkout and inventory

### A06 · Captured payment with no local order — **Fixed (code)**

`POST /api/hooks/razorpay` is mounted and signature-verified against the
raw body (`express.json({ verify })` captures it). `payment.captured`
finalizes from the intent, so an order exists even if the browser never
returns. Unmatched captures and amount mismatches are logged for
reconciliation rather than silently dropped.

### A07 · Non-atomic inventory and finalization — **Fixed (code)**

Stock now moves via `reserveStock()` — conditional `$gte` decrements on
both the product and the exact variant row, with `releaseStock()` rollback.
COD reserves **before** creating the order (all lines or none); a paid
order is created first (captured money must never be orderless) and a
reservation conflict is flagged on the order for operations. Added unique
partial indexes on `razorpayPaymentId` and `idempotencyKey`; both 11000
paths return the existing order. The cart page sends an `Idempotency-Key`
per COD attempt. Intent claiming (`pending → finalizing`) is a
`findOneAndUpdate`, so the browser verify and the webhook cannot both
finalize.

### A08 · Checkout priced differently from the product page — **Fixed (code)**

`buildOrderPayload` resolves each line with the same arithmetic the PDP
uses: `max(1, round(variantPrice − offerSavings(basePrice)))`, using the
shared live-offer resolver (now exporting `loadLiveOffersForSellers` /
`bestOfferForProduct`). The applied offer is snapshotted on the line.

### A09 · No revalidation of variant / seller / product — **Fixed (code)**

Every line is re-checked at order time: product `status === 'active'`,
seller `status === 'approved'`, the exact variant exists, quantities are
positive integers ≤ 100, and duplicate cart lines for one SKU are
**summed** before the stock test. Unavailable lines are now rejected with
a message instead of being silently dropped.

### A10 · Colliding order numbers — **Fixed (code)**

New `models/Counter.js` with an atomic `$inc`; the pre-save hook consumes
it (seeded past legacy values via `$max`). Deletions can no longer reissue
a live number.

### A11 · COD collection didn't reconcile — **Fixed (code)**

`codFee` is persisted on the order, and `pushOrderToShiprocket` allocates
shipping + COD fees across seller slices proportionally to merchandise
value (remainder to the largest slice), so
`Σ(sub_total + shipping_charges + transaction_charges)` equals the
customer's payable total.

---

## P1 — fulfilment, cancellation, returns

### A12 · One seller controlled the whole order — **Fixed**

Sellers now write their **own** `sellerShipments` slice (`confirmedAt`,
`status`, `deliveredAt`). `deriveOrderAggregate()` computes the
customer-facing status from all forward slices: delivered only when every
non-cancelled slice is delivered, shipped when any has shipped, cancelled
when all are. COD `paymentStatus` flips to paid only at full delivery.
The Shiprocket webhook uses the same derivation.

*Verified:* seller A's delivery leaves the order un-delivered while B is
in transit; the order flips only after B delivers too.

### A13 · Retry re-pushed every seller — **Fixed**

`pushOrderToShiprocket(order, { onlySeller })`; the retry endpoint passes
the caller, skips sellers that already have a forward entry, and refuses
to run on a cancelled order or over a healthy shipment.

*Verified:* A's retry pushes only A; B keeps exactly one entry with its
original shipment id.

### A14 · Failed pickup looked like success — **Fixed (code)**

`pickupBookedAt` / `pickupError` are tracked separately from the AWB. The
ship response returns `pickupBooked` + `pickupError`; the cached-success
path retries **pickup only** (never regenerates an AWB). The seller
dashboard shows a distinct error toast when a label exists without a
booking.

### A15 · Webhook identity and state regression — **Fixed**

Slices persist `channelOrderId` (our exact external reference); matching
is `channelOrderId → shipmentId → awbCode`, and reverse/replacement legs
now store both the reference and any AWB. Unmatched events are logged as
errors. Terminal states (delivered / returned / cancelled / rto_delivered
/ lost) can no longer be demoted by a late scan.

*Verified:* a late "in transit" scan leaves a delivered slice delivered.

### A16 · Incomplete cancellation lifecycle — **Fixed (code)**

Cancellation is claimed atomically (`placed|confirmed → cancelled`),
carrier cancellation is **awaited per slice**, exact-SKU stock is restored
exactly once (guarded by `stockRestoredAt`) and **only** when every
shipment is confirmed stopped, and a prepaid order raises a
`kind: 'cancellation'` refund obligation into the admin queue. Seller-side
shipment cancellation now restores that seller's stock. Ship and
retry-push refuse cancelled orders.

### A17 · Re-verifying a return inflated stock — **Fixed**

The restock is claimed with a conditional update on the shipment
subdocument (`restockedAt: null`); only the winner moves inventory.

*Verified:* two sequential verifications restore exactly one unit.

### A18 · Duplicate / unretryable refunds — **Fixed**

The `requested|failed → processing` claim is an atomic `findOneAndUpdate`
written **before** the provider call. Completion is derived from the
provider's own status and amount (partial refunds no longer mark the whole
order refunded); failures return to a retryable state; a stable
`refundRequestId` note is attached for reconciliation.

*Verified:* two concurrent calls initiate exactly one provider refund and
the loser is rejected.

### A19 · Returns matched by product, not line — **Fixed (code)**

Order lines carry `_id`, a `returnedQuantity` counter and
`returnPolicyDays` / `exchangePolicyDays` **snapshotted at purchase**.
Return requests reference `orderItemId` and snapshot size / colour /
price. Eligibility and the window now come from the **seller's own
delivered slice**, an ambiguous product reference across variants is
rejected rather than guessed, quantities are capped by what remains
returnable, and a refunded request moves to `completed` so it stops
blocking later requests.

### A20 · Unguarded replacement shipments — **Fixed (code)**

Replacement dispatch requires `status === 'approved'` **and** a verified,
accepted return parcel, and reserves replacement stock (honouring a
requested size/colour swap) with rollback, guarded by
`replacementStockReservedAt`.

### A21 · Seller responses leaked other sellers' data — **Fixed (code)**

New `sellerOrderDto()` builds the payload explicitly: own items,
shipments and requests only; no payment id, no signature, no payment
instrument, and the customer's bank/UPI payout fields stripped.

---

## Additional gaps

- **JWT revocation — Fixed (code).** `User.tokenVersion` is embedded in
  every token as `tv` and bumped whenever a password is written; `protect`
  refuses stale generations. Change-password returns a fresh token so the
  current device stays signed in while others are logged out.
- **Seed scripts — Fixed.** `seedDemoProducts.js` and
  `seedJacketSubcategories.js` were **truncated mid-statement**; endings
  restored (error handling, disconnect, runner). All 134 backend source
  files now parse.
- **Unbounded order feeds — Fixed (code).** Customer and seller lists
  paginate (`?page`, `?limit`, default 50, cap 200) and return a
  `pagination` block plus `X-Total-Count`; added
  `{user, createdAt}` and `{items.seller, createdAt}` indexes.

### Still open (not addressed here)

- **Seller settlement ledger.** No per-seller payable/payout accounting
  exists. Still unbuilt — decide whether it is in-product or external.
- **Serviceability at payment time.** Couriers are still only checked
  after the order exists; a customer can pay before we know anyone can
  carry the parcel.
- **Durable background work.** Emails and Shiprocket pushes still run
  in-process after finalization; a restart can lose them. An outbox +
  worker is the right fix.
- **History cleanup for A01** (owner action).

---

## Verification performed

1. `node docs/audits/2026-09-21-commerce-fixes-verify.cjs` — 10
   assertions covering A02 (×3), A03, A04, A12, A13, A15, A17, A18. All
   pass. Fakes only; no external calls.
2. `npm run test:multisite` — 24 passed. `npm run test:pickup-verify` —
   38 passed (unchanged).
3. `node --check` across all 134 backend source files — clean.
4. esbuild parse of every changed frontend/admin file — clean.

Items marked **Fixed (code)** have no automated assertion yet. Before
trading on this flow, exercise them against a real database and the
Razorpay/Shiprocket sandboxes: simultaneous last-unit purchases, an
interrupted payment recovered by webhook, duplicate callbacks, a partial
multi-seller delivery, a cancellation racing a dispatch, and a partial
refund.
