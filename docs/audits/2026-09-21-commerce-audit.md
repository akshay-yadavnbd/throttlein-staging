# Commerce and security audit — 21 September 2026

## Assessment and scope

The current checkout and seller fulfilment flow has release-blocking security, payment, inventory, and multi-seller consistency issues. Happy-path screens exist, but they do not establish correct behavior under retries, simultaneous purchases, payment callback failure, partial delivery, cancellation, and refunds.

This is a source audit of the current working tree, supported by seven isolated reproductions. It covers buyer cart and checkout, Razorpay integration, seller shipping, Shiprocket callbacks, cancellations, returns/exchanges, refunds, authentication/permissions, private files, rich-text rendering, startup configuration, and test coverage. It is not a claim that every line or deployed integration has been verified. No live database, payment, shipment, credential-validity, or authenticated browser tests were performed.

Existing edits in `backend/src/controllers/orderController.js` and `frontend/components/pages/DashboardOrderDetailPage.tsx` were reviewed as present and left untouched. Only this report and a local reproduction script were added.

Priority: **P0** = immediate containment; **P1** = fix before relying on the flow for production trading; **P2** = important follow-up. Provider-specific outcomes mentioned below are risks inferred from the requests the application sends, not observations of live provider behavior.

## How the implemented flow works

| Stage | Current behavior | Main code |
|---|---|---|
| Add to cart | Authenticated customer adds a product, size, colour, quantity. Product and seller approval are checked when adding. | `backend/src/controllers/cartController.js:41` |
| Checkout | `/cart` is also the checkout page. Buyer chooses a saved address and COD, online payment, or EMI. Totals are displayed from cart products. | `frontend/components/pages/CartPage.tsx:83`, `:187` |
| COD | `POST /api/orders` builds the current cart, checks stock and delivery exclusions, checks COD eligibility, then persists the order. | `backend/src/controllers/orderController.js:1497` |
| Online / EMI | `POST /api/orders/razorpay/init` creates a provider order. Browser opens Razorpay. Its success handler calls `/razorpay/verify`. Backend verifies HMAC, rebuilds the current cart, and marks a new order paid. | `frontend/components/pages/CartPage.tsx:227`; `backend/src/controllers/orderController.js:1535`, `:1596` |
| Finalization | Order is written; stock is decremented separately; cart is emptied; emails and per-seller Shiprocket pushes run asynchronously. | `backend/src/controllers/orderController.js:1397` |
| Seller receives order | Dashboard lists orders containing that seller's items. Seller can mark confirmed. | `backend/src/controllers/orderController.js:1660`, `:1681`; `frontend/components/pages/DashboardOrderDetailPage.tsx:62` |
| Seller dispatches | Seller chooses a courier, assigns an AWB/shipping label, schedules pickup, and prints documents. A failed initial push can be retried. | `frontend/components/pages/DashboardOrderDetailPage.tsx:81`; `backend/src/controllers/orderController.js:727`, `:783`, `:1111` |
| Tracking / delivery | Shiprocket webhooks update shipment scans and selected order-level states. Manual seller delivery is also possible. | `backend/src/routes/webhookRoutes.js:100`; `backend/src/controllers/orderController.js:1681` |
| Returns | Buyer requests a return/exchange. Seller approves reverse shipment, verifies receipt, and for a return raises an admin refund request. Exchanges have a replacement shipment action. | `backend/src/controllers/orderController.js:1792`, `:2009`, `:2143`, `:2319` |
| Refunds | Admin initiates Razorpay refund or records an externally completed COD transfer. | `backend/src/controllers/orderController.js:2578` |

## Immediate security and payment findings

### A01 — P0 — Credential values are committed to Git

**Evidence:** `git ls-files` and a values-redacted inspection of `git show HEAD:backend/.env` confirm committed nonempty database URI, JWT secret, super-admin password, AWS access key/secret, Shiprocket password, and Razorpay key secret fields. `frontend/.env` also commits a revalidation secret. Examples: `backend/.env:7`, `:21`, `:26`, `:43`, `:44`, `:57`, `:71`; `frontend/.env:8`.

**Impact:** Repository access can expose application/infrastructure credentials. Their present validity and deployment use were not tested. Removing the files in a new commit alone does not remove earlier copies.

**Fix:** Treat actual credentials in these fields as potentially exposed, rotate/revoke them, move secrets to deployment secret storage, stop tracking the files, provide placeholder-only examples, and enable secret scanning. Coordinate history cleanup separately; no credentials or history were changed during this audit.

### A02 — P0 — Payment is not bound to the order being fulfilled

**Evidence:** `backend/src/controllers/orderController.js:1609` verifies HMAC, but `:1639` reconstructs the order from the current cart and `:1643` marks it paid. The provider payment fetch at `:1632` is used only for payment-instrument metadata. There is no amount/currency/capture-state comparison or persisted checkout ownership lookup. The duplicate lookup at `:1616` is also not scoped to the current customer.

**Reproduction:** With fake dependencies and a correctly signed fake payment for INR 100, the actual verification controller passed a current INR 50,000 cart to finalization as paid.

**Impact:** A valid lower-value payment can fund a different, higher-value cart. A failed provider lookup does not stop this path. Replayed verification data can return another user's existing order if the payment tuple is known.

**Fix:** Persist a checkout intent owned by the customer, with immutable line items, currency, amount and provider order ID. Verify the payment against that intent and its provider state. Finalize exactly once from that snapshot; scope duplicate responses to the owner.

### A03 — P1 — Server-rendered rich text bypasses sanitization

**Evidence:** `frontend/components/common/RichTextView.tsx:115` returns normalized raw HTML when `window` is absent; `:155` passes it to `dangerouslySetInnerHTML`. Product descriptions accept seller HTML (`backend/src/controllers/productController.js:1247`, `:2657`), and product detail is server-rendered with `initialCatalog` in `frontend/app/(storefront)/product/[slug]/page.tsx`.

**Reproduction:** Rendering the actual component server-side retained a synthetic `<img onerror=...>` attribute in the resulting markup. No browser payload was executed.

**Impact:** Untrusted seller content can introduce stored XSS into the first server response. Client sanitization after hydration is too late to protect that response. Customer and seller tokens are accessible to same-origin JavaScript through browser storage.

**Fix:** Sanitize with a server-capable allowlist before emitting HTML, with the same policy on client rendering. Audit existing stored HTML. Remove the raw-HTML fallback; add CSP as an additional layer.

### A04 — P1 — Private KYC files are reachable through an unauthenticated proxy

**Evidence:** `backend/src/routes/fileRoutes.js:49` accepts arbitrary S3 object keys with only a traversal check, fetches them with backend credentials, and marks the response public/cacheable. It is mounted before protected customer routes in `backend/server.js`. KYC objects use `sellers/<seller>/kyc/` (`backend/src/controllers/kycController.js:1011`).

**Reproduction:** Invoking the actual file handler with no user and a synthetic KYC object key returned a fake private document from fake S3.

**Impact:** Anyone who obtains a private key can bypass the intended signed-URL lifetime and ownership checks. A private S3 bucket does not close this proxy path. The risk requires a known/leaked key; this is not evidence of bucket listing.

**Fix:** Allowlist public media prefixes on this route. Require authorization and non-public cache headers for private content. Separate private disk uploads from the global `/uploads` static mount too.

### A05 — P1 — Startup can create a predictable administrator or promote an existing account

**Evidence:** `backend/src/utils/seedAdmin.js:13` supplies fallback administrator credentials; `:19` promotes an existing account based only on its email; `:37` logs the newly created password. The seed runs on every backend startup.

**Impact:** Misconfigured deployments can create a predictable administrator, expose its password in logs, or promote an existing customer account without replacing its password.

**Fix:** Make administrator provisioning explicit, disallow production defaults, require a trusted provisioning operation, remove password logging, and refuse automatic promotion of ordinary users.

## Checkout and inventory findings

### A06 — P1 — A captured payment can have no local order or recovery path

**Evidence:** Init deliberately writes no local checkout/order (`orderController.js:1535`). Local creation depends on the browser callback (`CartPage.tsx:295`). `verifyWebhookSignature` is defined in `backend/src/services/razorpay.js:133` but has no mounted consumer. No payment reconciliation worker was found.

**Impact:** Closing the browser, losing the verify response/request, or failing stock validation after payment can leave money captured with no local order. The UI shows a verification error, and another attempt starts a new payment.

**Fix:** Save a pending checkout before payment, finalize from authenticated capture events, add reconciliation and resumable status lookup, and ensure browser retries reuse the same intent.

### A07 — P1 — Inventory and order creation are not atomic or safely repeatable

**Evidence:** `orderController.js:1290` reads stock, `:1411` creates the order, `:1449` decrements stock without a stock predicate, and `:1473` clears the cart, with no transaction. The payment duplicate check is a read-before-create; `Order.js:73` has no unique payment-ID constraint. COD has no idempotency key.

**Impact:** Concurrent customers can oversell. Multiple cart lines for one product are checked independently. Failures after order creation can leave an order without all decrements or without cart cleanup. Once created, a retry may return the existing paid order without repairing incomplete finalization. Parallel verification can reuse the payment; the separate order-number collision may reject some races, but is not a correctness guarantee.

**Fix:** Use immutable checkout lines and atomic stock reservations, transactionally commit order/inventory state, enforce appropriate unique payment/intent indexes, and use idempotency keys on checkout commands. Dispatch external work through a durable outbox.

### A08 — P1 — Checkout pricing differs from product-page pricing

**Evidence:** `ProductDetailPage.tsx:769` uses selected variant price and `:779` applies offer savings. Public products are decorated through `backend/src/utils/resolveOffers.js:135`. Cart population uses stored product prices, and `orderController.js:1320` always uses `p.price` rather than selected variant/offer pricing.

**Impact:** Active offers can disappear at checkout. A higher-priced variant can be sold for the base product price. Display, charge, invoice and refund values do not share one pricing definition.

**Fix:** Introduce one server-side quote calculation for selected SKU, offers, shipping, COD fees and totals, and use it for cart, payment initialization, immutable order snapshots and refunds.

### A09 — P1 — Checkout does not revalidate variant or seller/product eligibility

**Evidence:** Cart addition checks product/seller approval, but `buildOrderPayload` only checks total product stock. It does not verify an exact variant exists, variant availability, product active status, or seller account/KYC approval. Seller lookup selects COD and delivery-exclusion fields only (`orderController.js:1286`, `:1344`).

**Impact:** Items added before suspension or unpublishing can still be purchased. A sold-out or nonexistent colour/size can be ordered while another variant supplies aggregate stock. A deleted item is silently skipped when other cart items remain.

**Fix:** Revalidate every line against an exact SKU and active seller/product state, validate positive integer quantities, reject changed/unavailable lines explicitly, and reserve that SKU's inventory.

### A10 — P1 — Order numbers collide under concurrency

**Evidence:** `backend/src/models/Order.js:295` derives the next identifier from `countDocuments() + 1` while `orderNumber` is unique.

**Impact:** Simultaneous new orders can compute the same number, causing one to fail. For online checkout this happens after payment. Deleting records can also reuse a number that still exists.

**Fix:** Use an atomic sequence or collision-safe identifier independent of collection count.

### A11 — P1 — COD collection payload excludes fees included in the order total

**Evidence:** `orderController.js:1333` adds shipping, `:1408` adds the COD convenience charge, but the per-seller Shiprocket payload sets shipping and transaction charges to zero and only sends the seller merchandise subtotal (`:533`). The COD charge is not separately persisted in the Order schema/payload.

**Impact:** Carrier collection inputs do not reconcile with the buyer's payable total. Example: INR 500 merchandise + INR 49 shipping + INR 30 COD fee is recorded as INR 579 while the shipment carries INR 500 and zero extra charges. Actual carrier collection was not tested.

**Fix:** Persist the full fee breakdown and allocate all collectible charges across seller shipments so their sum equals the order amount. Confirm provider collection behavior in sandbox tests.

## Seller fulfilment and cancellation findings

### A12 — P1 — One seller controls the status of an entire multi-seller order

**Evidence:** `orderController.js:1681` allows any seller owning one item to write global status. Marking delivered also marks the whole COD payment paid. `webhookRoutes.js:240` marks the order delivered when any forward shipment is delivered.

**Reproduction:** A delivery callback for seller A changed the global order to delivered while seller B remained shipped.

**Impact:** Other sellers' action buttons disappear or change prematurely, customer tracking is inaccurate, and return windows start before remaining deliveries. COD payment meaning also differs between manual delivery and webhooks.

**Fix:** Record fulfilment and timestamps per seller shipment. Derive aggregate order state from all required forward shipments and distinguish partial states. Separate delivery, customer COD collection, and remittance/settlement states.

### A13 — P1 — Retrying one seller's shipment pushes every seller again

**Evidence:** `orderController.js:790` removes the caller's entries, then `:793` calls the helper that unconditionally iterates all order sellers (`:454`). Fresh random external IDs are generated on each push.

**Reproduction:** Seller A's retry created new shipments for A and B even though B already had a shipped entry; B ended with two entries.

**Impact:** Duplicate shipments and potential charges, lost tracking references for the retried seller, and corrupt aggregate status. The endpoint also lacks a cancelled-order/healthy-shipment guard.

**Fix:** Target exactly one seller/fulfilment attempt, preserve successful external IDs, use persisted stable external references, and reconcile unknown provider outcomes before retrying. Add an atomic per-shipment claim.

### A14 — P1 — Failed pickup scheduling cannot be retried through the shipping action

**Evidence:** `orderController.js:1218` catches pickup failure, then persists status `awb` and responds with success. Future calls return cached success when an AWB exists (`:1136`), before scheduling pickup.

**Impact:** Seller can receive a successful shipping response and have a label, but no courier booking. Repeating the action does not recover pickup scheduling.

**Fix:** Track AWB assignment and pickup booking separately. Return the partial failure, provide a pickup-only retry, and never regenerate an AWB simply to retry pickup. Record and surface booking acknowledgement.

### A15 — P1 — Shipment callbacks cannot reliably match reverse shipments and can regress state

**Evidence:** Producer IDs use a random suffix (`orderController.js:36`), while `webhookRoutes.js:87` interprets that suffix as a seller slug. Fallback uses a stored AWB only. Return creation stores order/shipment IDs but no AWB (`orderController.js:2086`). Unknown callbacks are acknowledged and discarded (`webhookRoutes.js:155`). Status is overwritten unconditionally (`:165`).

**Impact:** The reference lookup fails for current IDs; AWB fallback saves ordinary forward shipments but cannot match a new reverse shipment with no stored AWB. Sellers may wait forever for the returned/delivered prerequisite to verification. Late callbacks can regress a delivered or cancelled shipment.

**Fix:** Persist and match the exact external reference, provider order ID, shipment ID and AWB. Retain unmatched events for reconciliation and enforce timestamp/state transition rules.

### A16 — P1 — Cancellation does not complete the money/inventory/shipment lifecycle

**Evidence:** Customer cancellation (`orderController.js:2699`) marks cancelled, restores only aggregate stock, starts carrier cancellation without waiting for its outcome, and never raises a prepaid refund. Seller shipment cancellation (`:684`) restores no inventory and starts no refund. Shipping/retry endpoints lack an order-cancelled guard.

**Impact:** A prepaid customer may have a cancelled order but no refund request. Variants remain deducted after customer cancellation. Seller-cancelled stock remains unavailable. Cancellation and dispatch can race, and inventory can be released even if external shipment cancellation fails.

**Fix:** Use an idempotent cancellation workflow per fulfilment slice, block conflicting transitions, persist carrier-cancellation outcome, restore the correct SKU exactly once when appropriate, and create a traceable refund obligation.

## Returns, refunds and data isolation

### A17 — P1 — Re-verifying a return repeatedly increases inventory

**Evidence:** `orderController.js:2180` restocks every approved returned request. `restockedAt` is written but never checked. Request status remains approved.

**Reproduction:** Two sequential successful verification calls for one returned unit added two stock units.

**Fix:** Claim verification/restock atomically, identify inventory movements by unique return-line IDs, and make repeat requests return the original result. Move the request through explicit terminal states.

### A18 — P1 — Refund execution can duplicate, misreport completion, and become unretryable

**Evidence:** `orderController.js:2587` sets processing only in memory before calling Razorpay. Concurrent requests can both read requested. Provider responses immediately set completed and globally refunded regardless of refund amount/status (`:2602`). Errors persist failed, but the endpoint only accepts requested (`:2583`), while `admin/app/refunds/page.tsx:429` offers processing for failed requests.

**Reproduction:** Two concurrent controller invocations initiated two fake provider refunds for one request. This demonstrates duplicate API invocation; whether the real provider accepts both depends on its remaining-refundable-amount rules.

**Fix:** Atomically claim the refund before external work, use a stable refund operation reference, reconcile uncertain outcomes, support controlled retries, track partial versus full refunds, and mark completion from confirmed provider outcomes. Keep manual-transfer records explicit.

### A19 — P1 — Returns are matched by product rather than purchased variant/line

**Evidence:** Request item matching uses only product IDs (`orderController.js:1852`), refund/restock uses the first matching product (`:2198`, `:2234`), and order lines have `_id: false` (`Order.js:23`). Delivery eligibility accepts any delivered shipment (`:1801`); policy is read from the seller's current settings (`:1823`), ignoring product-specific policies. Approved requests are not moved to completed after refunds, blocking future requests via `:1840`.

**Impact:** Returning one size/colour can select multiple lines, restore the wrong variant and calculate the wrong amount. Sellers can change post-purchase eligibility by changing their policy. Partially delivered orders may allow premature returns; completed cases can block legitimate later returns.

**Fix:** Give order lines immutable IDs and SKU snapshots; snapshot policies on purchase; track returned/refunded quantities per line and delivery timestamps per shipment; complete requests when resolved.

### A20 — P1 — Replacement shipments lack approval, receipt and inventory checks

**Evidence:** `orderController.js:2319` checks ownership, exchange kind and absence of an existing replacement; it does not require approved status or verified receipt, resolve a replacement SKU, or reserve/decrement replacement inventory. The requested replacement is free text.

**Impact:** A direct API call can dispatch against a pending, declined or cancelled exchange. Replacement stock and variant changes are not accounted for; stock can appear available after being shipped.

**Fix:** Model explicit exchange states, select a real replacement SKU, validate available inventory, and record independent returned/replacement stock movements. Decide explicitly whether advance exchanges are permitted.

### A21 — P1 — Seller responses expose other sellers' return/payment data

**Evidence:** `orderController.js:1663`, `:1717` and `:1738` spread the full order object and replace only `items`. All `returnRequests`, other sellers' shipments, payment IDs/signature and instrument details remain. Return records can include customer bank/UPI payout details.

**Impact:** One seller can read information belonging to other seller slices and customer payment/refund details unrelated to fulfilment. Frontend filtering does not limit the API response.

**Fix:** Return an explicit seller DTO with only authorized items, own shipments/requests, necessary customer shipping information and allowed payment summary fields. Do not serialize payment signatures or unrelated bank data.

## Additional gaps and verification results

- **P1 operational gap — No seller settlement ledger found.** The admin has an account-wide COD remittance read, but no implementation was found for per-seller payable balance, deductions, refunds, settlement runs or payout reconciliation. Some seeded seller copy promises weekly/T+7 settlements. If this is handled externally, document ownership and reconciliation; otherwise it is unfinished functionality. This is a source finding, not a review of tax requirements or off-platform operations.
- **P1 operational gap — No carrier serviceability check at payment time.** Seller exclusions are checked, but live serviceability is requested only by the seller after an order exists (`orderController.js:750`). A customer can pay before the system discovers no supported carrier. Use a validated quote for every seller origin/destination or explicitly defined manual fulfilment handling.
- **P1 security gap — Password changes do not revoke existing JWTs.** `authController.js:522` and `:643` update passwords, while `middleware/auth.js:14` only verifies JWT and current user status. No password-change timestamp/token version check was found. Add session invalidation for password reset and administrative security actions.
- **P2 — Background work is not durable.** Finalization starts emails/Shiprocket work in process (`orderController.js:1475`); a restart can lose work, and no queued shipment placeholder is committed before starting. A durable outbox/worker should cover shipping, notifications and reconciliation, with failures visible to operations.
- **P2 — Order feeds are unbounded.** Customer and seller list endpoints load every matching order (`orderController.js:1661`, `:1748`). Add bounded pagination, indexes and summary DTOs before history grows.
- **P2 — Missing commerce regression coverage.** Existing backend test scripts cover site permissions and pickup OTP; no checkout, inventory, payment, cancellation, refund or multi-seller lifecycle regression suite was found.
- **P2 — Two seed scripts do not parse.** `backend/src/utils/seedDemoProducts.js:378` and `backend/src/utils/seedJacketSubcategories.js:100` end unexpectedly. These affect the corresponding seed commands; they are not evidence that normal backend startup fails.

Validation performed:

1. `node docs/audits/2026-09-21-commerce-checks.cjs`: seven defect reproductions confirmed with fake dependencies. No external writes/calls. Its SSR test compiles without Next's styled-JSX transform, so React emits harmless `jsx`/`global` attribute warnings.
2. Frontend and admin: `npx --no-install tsc --noEmit --incremental false` both passed.
3. Existing multisite tests: **24 passed**. Pickup self-verification tests: **38 passed**.
4. Parsed **132 backend source JavaScript files**: 130 parsed, two seed scripts failed; direct `node --check` confirmed both failures.
5. Committed environment files inspected with values redacted; credentials were not printed in this report or tested against providers.

The reproduction script asserts that the defects exist. It is an audit artifact, not a passing correctness/regression suite. When implementing fixes, convert these into tests asserting the intended safe behavior with realistic database concurrency checks.

## Recommended implementation order

1. Contain exposed credentials and public private-file access; eliminate raw server-rendered HTML and unsafe administrator bootstrap.
2. Implement immutable checkout quotes/intents, verified payment ownership/amount/capture, idempotent finalization, atomic inventory and collision-safe identifiers.
3. Add capture/refund event handling and reconciliation so browser/provider/network failures are recoverable.
4. Model per-seller fulfilment state, correct COD fee allocation, isolated retry, pickup-only recovery and exact webhook identity.
5. Complete cancellation, line-based returns, once-only restock, exchange inventory and refund accounting; narrow seller DTOs.
6. Define seller settlements and add sandbox end-to-end tests for single/multi-seller COD and prepaid orders, interrupted payment, duplicate callbacks, simultaneous last-unit purchases, cancellation/dispatch races, partial deliveries and refunds.

Expected seller flow after correction: receive own fulfilment slice → confirm that slice → select courier → assign AWB → confirm pickup booking → print label/invoice → hand over parcel → courier scans update that slice → derive global delivery only after all required slices resolve → reconcile COD/online settlement. Return/exchange/refund state remains tied to the exact purchased lines.
