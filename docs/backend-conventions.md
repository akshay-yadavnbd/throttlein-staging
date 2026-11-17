# Backend conventions

The working agreements for `backend/`. Modelled on the Hive-internal backend's
layout contract, scaled to this Express + Mongoose codebase. Each section below
is in force once its step in the plan has landed; the plan order is at the end.

## Configuration (step 1 — in force)

- `src/config/env.js` is the **only** module that reads `process.env`. Everything else does
  `const { env } = require('<…>/config/env')`.
- Every key the backend reads is declared in the schema there, with its type and default.
  Booleans are booleans (`env.SHIPROCKET_MOCK_MODE`), ports are numbers, `env.isProduction`
  replaces every `NODE_ENV === 'production'` comparison.
- Legacy spellings resolve to one value: `MONGO_URI` / `MONGODB_URI`; `HOST` / `EMAIL` / `PASS`
  / `FROM` / `EMAIL_PORT` / `SECURE` → `SMTP_*`; `FRONTEND_URL`, `CLIENT_URL`, `SITE_URL` →
  `FRONTEND_ORIGIN`; `SELLER_URL` → `SELLER_ORIGIN`; `ADMIN_URL` → `ADMIN_ORIGIN`.
- Validation runs at require time. In production a missing MongoDB URI or a weak / placeholder
  `JWT_SECRET` stops the process with the key named; elsewhere problems print as one warning
  block. Malformed optional values are reported the same way.
- Reads are live (each property re-coerces on access) so tests may set and swap variables per
  case, and `cartReminders` / `teamsNotifications` may read keys by name (`env[name]`). Unknown
  keys fall through to `process.env`.
- Adding a variable: add it to the schema AND `.env.example` — `test/envExample.test.js`
  fails when the two drift in either direction (a commented `# KEY=` line counts as
  documented). Keys outside the schema fall through untyped; `TEAMS_<EVENT>_WEBHOOK_URL` is
  the one deliberate family.
- `env.js` does not load `backend/.env` itself. Entry points do. The loader is
  `src/config/loadEnv.js`: `require('./config/loadEnv')` is the first line of `src/index.js` and
  of every seed in `src/database/seed/`. Scripts in `backend/scripts/` keep
  `require('../loadEnv')`, a one-line shim in `backend/`. The test suites therefore run
  against a clean environment (as they always did) and set what they need themselves; loading
  the developer's `.env` under the test runner once pointed the MCP suite at a local Redis that
  wasn't running and left ioredis retrying forever. Under the test runner the boot warnings
  are silent.
- Test doubles for `res`: a refusal is now a thrown `AppError` carrying `status`; a fake `res`
  no longer sees `res.status(n)` before the throw. Harnesses read `e.status` from the caught
  error (see `test/pickupSelfVerify.test.js` and the `assert.rejects` validators in
  `test/commerceSecurity.test.js`).

## Errors (step 2 — in force)

- Throw `AppError` (`src/errors/AppError.js`), usually via a factory:
  `throw AppError.notFound('Order not found.')`, `AppError.badRequest(msg, details)`,
  `AppError.forbidden()`. Codes and their default sentences live in `src/errors/codes.js`.
- `src/middleware/errorHandler.js` is the single exit for failures. It also understands the
  legacy `res.status(n); throw new Error(m)` idiom and errors carrying `status`, plus
  Mongoose and Multer errors, so nothing older breaks — but new code throws `AppError`.
- One error envelope everywhere:

  ```json
  { "success": false, "code": "NOT_FOUND", "message": "Order not found.", "details": {}, "requestId": "…" }
  ```

  `code` is what clients branch on; `message` is for the person (the dashboards may replace it
  from `lib/messages.ts`, keyed by code); `details` is structured and caller-safe; `requestId`
  matches the `X-Request-Id` response header (`src/middleware/requestId.js`) and the server log
  line, for support lookups.
- 5xx: logged in full on the server; in production the client sees the generic sentence only.
- Do not `res.status(4xx).json({ message })` for a failure; throw instead. Zero such sites
  remain (the guard in `test/codeShape.test.js` keeps it so); the one allowed exception is
  the MCP endpoint's JSON-RPC answers. Domain codes the frontends branch on (`MISSING_FIELDS`,
  `INVALID_CREDENTIALS`, `EMAIL_UNVERIFIED`, `IN_USE`, `MCP_NOT_CONFIGURED`) are thrown as
  `new AppError(code, message, details, { status })`; facts the client needs beyond the
  sentence (`unverified`, `email`, `retryAfter`, `products`) ride in `details`.

## Responses (step 2 — in force on every endpoint)

- Every success body goes through `src/utils/apiResponse.js`: `sendData(res, data, status?,
  meta?)` → `{ data, meta? }`, `sendCreated`, `sendList(res, items, paging)`, `sendNoContent`.
  Paging lives in `meta` (`page, pageSize, totalItems, totalPages`); deletes answer 204.
  Only the protocol exits listed under **Guard** below write `res.json` themselves.
- The migration ran screen by screen (handler, every reader in `admin/`, `frontend/` and
  `chatbot/`, and a test in the same change); the bullets below record each batch.
- **How a screen moves.** One change touches three things: the handler (in a module
  controller, `respond((req) => service(...))` for `{ data }`, `sendList` for a list,
  `sendCreated` / `sendNoContent` for create / delete), every screen that reads the endpoint
  (the admin app unwraps with `unwrap` / `unwrapMeta` from `admin/lib/api.ts`; the storefront
  and seller dashboard get the same helper when their first screen moves), and a unit test on
  the loader asserting the exact envelope (`test/adminEnvelope.test.js` is the pattern). The
  error envelope is unchanged, so `notifyError` and the `code` switches keep working.
- **On the envelope today:** every endpoint the admin module owns (`src/modules/admin`):
  dashboard, sellers, customers, product moderation, the order feed (`/orders` list and
  `/orders/failed-pushes` answer `{ data: { items, … }, meta }` — the feed also carries
  `statusCounts` and `archivedCount` beside `items`), order detail / archive / restore, staff,
  security, the Shiprocket account reads and the Redis inspector. Lists answer
  `{ data: { items }, meta: { page, pageSize, totalItems, totalPages } }` through the
  controller's `listing()` wrapper (or `sendData` with `pageMeta`); the screens take totals
  from `meta.totalItems` / `meta.totalPages`. The CSV export is a file, not an envelope.
  Readers: `admin/app/{dashboard,staff,security,customers*,sellers*,orders*,products,cache,
  shiprocket/cod-remittance}`, `components/AdminShell.tsx` (bell feed) and
  `components/DeleteOrderDialog.tsx`. The admin module no longer has an `answer()` helper:
  anything new there is on the envelope by construction. Also on the envelope: the sellers
  module's admin router (KYC queue, review, edit, the admin document upload — its own
  handler, `adminUploadKycFile`, because the seller's upload keeps the legacy shape — and the
  pickup read) and the orders module's admin router (cancel, reschedule pickup, refund queue,
  process / reconcile / release — the refund verbs keep their 200 / 202 status and put the
  service body under `data`). Readers: `admin/app/{kyc-pending,refunds,orders/[orderNumber]}`,
  `components/{AdminShell,KycReviewCard}.tsx` and the dashboard queues.
- **Every `/api/admin/*` endpoint is now on the envelope**, including the ones still served by
  legacy controllers: settlements and courier charges (`payoutController` admin handlers),
  notification recipients, brand-request review (`categoryBrandRequestController` admin
  handlers; delete answers 204), onboarding reminders, checkout failures and customer carts
  (both `sendList` with paging meta), and MCP management (`routes/adminMcpRoutes.js`). The
  seller-facing handlers in those same files (`/seller/payouts`, the seller's own brand
  requests, the storefront's checkout-failure report) keep the legacy shape until the seller
  dashboard and storefront migrate.
- **CMS admin endpoints are on the envelope too:** the whole `/api/admin/blog` router (lists
  with paging meta), and in the CMS module every write, every admin read (`/pages/id/:id`,
  `/faqs/admin*`, `/promo-blocks/admin*`, `/testimonials/admin*`, `/redirects/admin`,
  `/seller-guides/id/:id`, `/admin/static-pages`) and every image upload (`{ data: { url } }`).
  In `cms.controller.js` and `blog.controller.js` the admin handlers use `respond` /
  `respondCreated` / `listing`; the public reads keep `answer` because the storefront reads
  them — `GET /pages`, `/pages/:slug`, `/pages/resolve`, `/pages/static-meta`, the
  banner / promo / guide / FAQ / testimonial / redirect public lists, the home-SEO,
  seller-CTA and guide-section singletons, and the public blog. The admin reads some of those
  public lists too (`/pages?all=1`, `/home-banners`, `/seller-guides`, the singletons) and
  keeps reading them on the legacy shape until the storefront moves.
- **Uploads during the transition.** `MediaPicker` posts to both migrated uploads and legacy
  ones (brands, categories, media), so it reads the URL through `uploadedUrl()` in
  `admin/lib/api.ts`, which accepts `{ data: { url } }` or `{ url }`. Drop the legacy branch
  once those uploads move.
- **Seller dashboard, first batch** (read through `unwrap` / `unwrapMeta` in
  `frontend/lib/api.ts`, which mirrors the admin's): KYC, pickup sync and pickup
  self-verification (sellers module seller router), payouts summary, the seller's own
  brand/category requests, offers, offline sales (list meta; `data` also carries
  `totalRevenue`, `totalUnits`, `sellerGstin`, `sellerState`), and the seller media library
  (list meta; `data` carries `folders`). Deletes answer 204. Test: `test/sellerEnvelope.test.js`.
- **The chatbot** (`chatbot/src/backend.js`) reads both shapes: `fromEnvelope()` flattens
  `{ data, meta }` into the plain object its tools read, folding `meta` back in as `total`,
  `page` and `pages`; legacy bodies pass through. So the assistant needs no per-tool change
  when an endpoint it reads moves — except where a list key changes (the admin order feed's
  rows are `items`, read as `items ?? orders`).
- **Seller orders and returns** (the orders module's seller router) are on the envelope: the
  list answers `{ data: { items }, meta }` (it still sets `X-Total-Count`), detail and every
  fulfilment / return verb answer `{ data }`. Where a body carries `ok` it is a carrier
  outcome the dashboard checks (couriers, tracking, manifest, retry-push), so it stays inside
  `data`; only the redundant `success: true` was dropped. Readers: the seller order detail,
  orders list, dashboard home, return-request detail, and the two shared hooks
  (`useSellerQueue` for the NDR and returns queues, `useSellerAttention` for the badge).
- **Customer storefront endpoints are on the envelope:** cart (including delivery options),
  wishlist, notify-me, addresses, the customer's own reviews (write, mine, eligibility,
  delete, photo upload), customer orders (list with meta, detail, cancel, return request and
  its cancel, return-evidence upload), checkout (COD create — 201, or 200 with
  `duplicate: true` — and Razorpay init / verify) and the browser's checkout-failure report
  (202). Readers: `CartPage`, the account pages (home, orders, order detail, wishlist,
  addresses), `Navbar` (cart badge), `lib/wishlist.ts`, and the wishlist reads on the
  category and product pages. Test: `test/customerEnvelope.test.js`.
- Kept legacy on purpose in those files: the Razorpay webhook (Razorpay reads only the
  status code).
- **Auth** is on the envelope (`modules/auth/auth.controller.js`): register (201, or 200 when
  a fresh link was re-sent), verify, set-password, resend, customer register, login, me,
  profile, change-password, forgot and reset. The refusal codes stay on the error envelope.
  Readers: the storefront's seller and customer sign-in, sign-up, verify, reset and profile
  pages and the dashboard home; the admin's login, staff login, reset and staff set-password
  pages; the assistant through `fromEnvelope`.
- **Guard.** `test/codeShape.test.js` now ratchets legacy success shapes: any file under `src/`
  that writes `res.json(…)` itself must be either a named protocol exit (`RAW_JSON_EXITS`: the
  envelope helpers, the error handler, MCP JSON-RPC, `/health`, the Razorpay and carrier
  webhooks, the Shiprocket mock) or pinned in `baseline.legacyResponseShapes`. A new file
  fails; a migrated file must leave the list. The list is empty: nothing is pinned.
- **The shared catalogue is on the envelope:** categories (tree, admin list, create, update,
  icon upload; delete answers 204), brands (list, create, update, logo upload; delete 204),
  the public product list (`data: { items, query?, correctedQuery? }`, paging in `meta`),
  search suggestions, product detail (`data: { product }`), the shipping-rate quote (its
  domain `ok` flag stays inside `data`) and the public reviews list (`data: { reviews, total,
  distribution, average }`). The category-tree cache key moved to `categories:tree:v2:…` so
  a pre-envelope cached payload is never served. Test: `test/catalogEnvelope.test.js`.
- **Tolerant readers for shared public endpoints.** The storefront and admin read the
  catalogue through `dataOf(body)` / `.then(envelopeOrLegacy)` (both `lib/api.ts`), which take
  `data` from the envelope, fold paging meta back into the old `page, limit, total, pages`
  keys, and pass a legacy body through unchanged. Server-rendered pages, menus, sitemaps and
  `llms.txt` therefore keep working whichever of backend and storefront deploys first. Use
  them only for endpoints several apps share; an endpoint one app reads uses strict `unwrap`.
  Drop the legacy branch once every shared endpoint has shipped.
- **The seller catalogue is on the envelope:** own list (`data: { items }`), create (201
  `data: { product }`), update, delete (204), bulk status (`data: { updated, skipped }`), the
  description editor's inline upload (`data: { url }`), seller media (`data: { items, total }`,
  bulk remove `data: { removed, blocked, requested }`), the spreadsheet import (`data: {
  summary, results }`) and the URL product import (`data: { draft, images, sourceUrl }`). The
  template and export downloads are files, not envelopes. Only the seller dashboard and the
  assistant read these, so the dashboard uses strict `unwrap`. Test:
  `test/catalogEnvelope.test.js`.
- **The admin media library is on the envelope** (`/api/admin/media`): list (`data: { items }`,
  paging in `meta`), folders (`data: { folders }`), upload (`data: { items }`), bulk delete
  (`data: { deleted, requested }`) and delete (204). Every endpoint MediaPicker uploads to now
  answers `{ data: { url } }`, so admin `uploadedUrl()` reads only that shape. Test:
  `test/adminEnvelope.test.js`.
- **Contact, assistant conversations and public sellers are on the envelope.** Contact answers
  202 `data: { received: true }` (mail is best-effort; the contact page reads only the status).
  Assistant conversations answer `data: { items }` / `data: { conversation }`, create 201,
  delete 204; only the chatbot service reads them, through `fromEnvelope`, and its own
  protocol with the browser is unchanged. `GET /api/sellers` and `/api/sellers/:id` answer
  `data: { items }` and `data: { seller, products }`; no app reads them today.
- **Public CMS and blog reads are on the envelope** (the last batch): pages (list, by slug,
  resolve, static meta), home banners, promo blocks, home SEO, seller CTA, seller guides and
  guide section, FAQs, testimonials, redirects, and the public blog (list with paging in
  `meta`, featured, post, categories, tags, authors, comments). The storefront renders these
  server-side, so every reader is tolerant: axios calls use `.then(envelopeOrLegacy)`, raw
  `fetch` reads wrap `dataOf(await res.json())`, and the three `safeFetchJson` helpers
  (sitemaps, seller sitemap, llms.txt) unwrap for all their callers. `proxy.ts` reads
  redirects with an inline unwrap so the proxy runtime does not import axios. Test:
  `test/catalogEnvelope.test.js`.
- **Next clean-up (after one deploy of the backend):** the legacy branch in `dataOf` and the
  proxy's inline unwrap can go, leaving strict `unwrap` everywhere.

## Validation (step 3 — in force on auth, seller orders, products)

- Every input is validated at the route with `validate({ params?, query?, body? })` from
  `src/middleware/validate.js`; controllers never re-check shape. Schemas live next to their
  routes: `src/modules/<domain>/<domain>.schema.js` once a domain is a module, otherwise
  `src/validation/<domain>.schema.js`; shared pieces (`email`, `password`, `phone`, `objectId`,
  `orderRef`, `paging`, `boolish`, `optionalInt`, `optionalNumber`, `optionalText`) in
  `src/validation/common.js`.
- The middleware REPLACES `req.body` / `req.query` / `req.params` with the parsed values
  (trimmed, lower-cased, coerced, defaulted). Query and multipart fields arrive as strings, so
  schemas use the `optional*` / `boolish` helpers rather than bare `z.number()`.
- A failure is one `AppError`: code `VALIDATION_FAILED`, status 400, `message` = the field
  sentences joined, `details.issues` = `[{ in, path, message }]`. A route may pin the code and
  sentence a client already keys off: `validate({ body }, { code: 'MISSING_FIELDS', message })`
  (login does this; the storefront branches on that code).
- Query schemas are `.passthrough()` so unknown filters keep flowing; body schemas are strict
  unless the controller whitelists keys itself (profile, product create/update).
- Behaviour that a frontend reads as a 200 is not moved into the validator. Example: the
  shipping-rate widget expects `{ ok:false, reason:'bad-pincode' }`, so the schema only trims
  `pincode` and the controller still answers.
- Guards (`requireRole`, `requirePermission`, `blockImpersonated`, `resolveSite`) call
  `next(AppError.<factory>())`; they no longer set `res.status()` themselves. Tests read
  `error.status`, not `res.statusCode`.
- `express-validator` is gone. Every route file carries `validate(...)`: module routes use
  their `<domain>.schema.js`; the legacy route files use `src/validation/generic.js`
  (`params({ id: 'objectId' | 'idOrSlug' | 'slug' | 'orderRef' | 'text' })`, bounded
  `listQuery`, `objectBody`) plus `legacy.schema.js` for the public and customer bodies
  (cart, wishlist, addresses, reviews, contact, blog comments, pickup OTP). The guard
  `every route with a parameter or a body carries validate(...)` in `test/codeShape.test.js`
  keeps it so; a GET with no parameters is exempt, and six files are allow-listed with a
  reason (mounts, webhooks, the dev mock, HTML unsubscribe pages, the wildcard file proxy).
- Parameter kinds are strict only where the controller resolves an id directly (`findById`,
  `findOne({ _id })`); sellers and customers accept an id or a slug and use `idOrSlug`.
- zod 4. It has no `required_error` / `invalid_type_error` / `errorMap`. Write
  `z.string(typeError('Missing message', 'Wrong-type message'))` with `typeError` from
  `validation/common.js` (leave one out to keep zod's default for that case), and
  `z.enum([...], { error: 'message' })`. `z.record` takes a key schema:
  `z.record(z.string(), z.unknown())`.
- Two zod 3 behaviours are kept on purpose, because the apps show `message` as-is:
  - A missing value says `Required`. This is the global `z.config` in `common.js`.
  - A field with a type error reports only that issue; zod 4 would also run its length
    checks. `validate()` filters these.
- zod's own default wording for messages a schema doesn't customise follows zod 4 (for
  example "Too big: expected string to have <=200 characters").
- Tests: `test/validate.test.js` (unit project).

## Logging (step 4 — in force)

- `src/utils/logger.js` exports `logger` (pino). Call it as
  `logger.info({ orderId }, 'order confirmed')` / `logger.error({ err }, 'payout failed')`:
  merging object first, one short sentence second, `%s` placeholders for inline values.
- Every line inside a request carries `requestId` automatically: `requestId` middleware runs the
  request inside an `AsyncLocalStorage` context and `logger` is a proxy that resolves to the
  request's child logger (root logger in workers and at boot).
- `requestLogger` middleware (replaces morgan, also on `/mcp`) writes one `request completed`
  line per response with method, `safeRequestPath` (no query string, reset/verify tokens
  redacted), status, `durationMs`, `userId` and `impersonatedBy` when present. Level follows the
  status: info / warn (4xx) / error (5xx); `/api/health` at debug.
- `errorHandler` logs 5xx as `request failed` with `{ err, status, code, method, path }`. 4xx are
  not logged there (the access line already says so).
- `{ err }` is serialised by `safeError`: type, message, code, status, stack frames, one level of
  `cause`. The redact list drops `password`, `token`, `authorization`, `secret` at any depth. Log
  ids, never documents or addresses.
- Output: JSON in production, `pino-pretty` in development, silent under tests. `LOG_LEVEL`
  (fatal…trace | silent) overrides; default `info`.
- No `console.*` in code that runs inside the server process (159 calls in 43 files rewritten).
  CLI tools keep `console` because a person reads them in a terminal: everything under
  `src/database/seed/`, `utils/testSmtp`, `utils/redisInspector` and `scripts/*` (which now
  holds the two repair CLIs). `config/env.js` prints its boot warnings with `console` because
  it loads before the logger.
- Tests that need to observe a log line mock `rootLogger.<level>` (see
  `test/teamsNotifications.test.js`), never `console`.

## Entry point and app assembly (step 5 — in force)

- `src/index.js` is the process: loads `.env`, connects MongoDB, runs the boot tasks
  (`ShipmentEvent.init`, checkout-intent retention, the nine boot seeds), creates the HTTP
  server, starts the interval workers, and owns shutdown. `npm start` / `npm run dev` / the
  Docker entrypoint all run it. `backend/server.js` is a one-line shim kept for old commands.
- `src/app.js` exports `createApp()`: middleware order, CORS, body parsers, the MCP connector
  and the `/api` router. It never listens, so tests build it directly (`test/app.test.js`
  drives it over real HTTP on a random port with no database).
- `src/routes/api.js` exports `createApiRouter({ mcp })` and is the only place that mounts
  routers under `/api`. The order is load-bearing: `customerRoutes` carries a top-level
  `protect`, so every public router sits above it. A new router is added there, nowhere else.
- Workers return a stop function from their `start*` call; `index.js` collects them. Shutdown
  on SIGTERM / SIGINT: stop workers → close idle sockets → `server.close` → quit Redis → close
  MongoDB → exit, with a 10 s hard-exit timer. `unhandledRejection` is logged and survived;
  `uncaughtException` stays fatal.
- Boot-time warnings that describe configuration (MCP disabled, Razorpay webhook secret
  missing) are logged once at startup, not per request.

## Module layout (step 6 — in force for orders, products, sellers, admin, auth, blog, cms, catalog, customers, offers, offline-sales, seller-media, payouts, notifications, media, contact, assistant)

One directory per domain under `src/modules/<domain>/`, split by concern, never by table:

```
modules/orders/
  index.js                     public surface: handlers + the few functions other code needs
  orders.routes.js             seller / customer / admin routers (validate() on every route)
  orders.schema.js             zod request schemas
  *.controller.js              HTTP ⇄ service: load, delegate, answer. No rules, no models.
  *.service.js                 use cases and transaction boundaries
                               checkout-pricing, checkout, fulfilment, dispatch, awb,
                               ndr-manifest, return-legs, returns, refunds, cancellation
  order-state.js               pure rules: derived status, slice lookups, status sets
  orders.presenter.js          response shapes (seller DTO, refund rows, tracking, couriers)
  order-notifications.js       emails and team notices (fire-and-forget safe)
  carrier.js                   pure Shiprocket helpers (ids, address clamp, envelopes)
  locking.js                   per-order fulfilment lock wrappers for handlers
  *.repository.js              EVERY query: orders, checkout (cart + intents),
                               inventory (stock + parcel profiles), parties (User reads)
```

- **Controllers hold no rules and import no models.** They parse nothing the route's
  `validate()` did not already type, load the aggregate through a repository *read*, hand it
  to one service function, and shape the answer through the presenter. Every write goes
  through a service. `grep -l models/ src/modules/orders/*.js` lists only repositories.
- **Repositories own statements.** Anything that names a collection — `find`, `updateOne`,
  `findOneAndUpdate`, aggregation `$expr` — lives in a `*.repository.js`. Services receive
  documents and may call `doc.save()`; they never build a query. `runInTransaction(fn)` and
  `withFulfillmentLock` live in `orders.repository.js`.
- **Cross-domain data.** Stock moves (`inventory.repository.js`) and User reads
  (`parties.repository.js`) sit inside the orders module until a products / sellers module
  exists; moving them is then a file rename, not a rewrite.
- **Mounting.** The module exports three routers; the audience's route file mounts one after
  its own `protect` / role guard (`sellerOrderRoutes` → `routes.seller`, `customerRoutes` →
  `routes.customer`, `adminRoutes` → `routes.admin`). `routes/api.js` did not change. The
  Razorpay webhook stays in `routes/webhookRoutes.js`.
- **Compatibility.** `src/controllers/orderController.js` re-exports the module so
  `services/shipmentSync`, `services/shipmentWorker`, scripts and tests keep their import.
  New code imports `modules/orders` directly.
- **Size.** No file in the module is over 400 lines (enforced by step 8). A file that grows
  past it is split by concern, as `shipping` became dispatch / awb / ndr-manifest /
  return-legs and `checkout` became checkout-pricing / checkout / razorpay-webhook.
- **Tests.** `test/helpers/controller.js` loads the module graph in a VM with path-keyed stubs
  (keys spelled as the legacy controller spelled them, e.g. `'../models/Order'`); the
  notifications module is a no-op unless a test passes its own. `test/commerceSecurity.test.js`
  (integration project, in-memory MongoDB) exercises checkout, stock, cancellation, refunds,
  shipment sync and the lock end to end.
- **Products** followed the same shape (`src/modules/products/`): storefront / seller-catalog /
  seller-media / import-export controllers; storefront, search, catalog-tree, catalog,
  product-images, media, export and import services; pure `product-input` (form parsers),
  `listing-image` and `csv-format`; `products.repository` (Product) and `catalog.repository`
  (Category, Brand, User reads). `routes/productRoutes.js` and
  `controllers/productController.js` re-export the module. `test/products.test.js` covers the
  pure pieces; the storefront behaviour was verified against the live database.
- **Sellers / KYC** (`src/modules/sellers/`) replaced the 1 317-line `kycController`:
  `seller-kyc` and `admin-kyc` controllers; `kyc` (submit), `kyc-review` (staff approve /
  reject / edit), `pickup-sync` (Shiprocket pickup location) and `pickup-self-verify`
  (emailed code) services; pure `kyc-rules` (GSTIN / PAN / IFSC rules, `sanitizeKyc`) and
  `kyc-emails` (templates); `sellers.repository` (User). The module exports `routes.seller`
  and `routes.admin`, mounted by `sellerOrderRoutes` and `adminRoutes` with
  `router.use(...)` after their guards — the admin router carries `requirePermission('kyc')`
  itself. `controllers/kycController.js` re-exports the module (adminController takes
  `accountActivatedHtml` from it). KYC field messages stay in `kyc-rules.js`, not zod: the
  dashboard shows them verbatim and admin edits reuse them. `User` is not on the guard's
  `OWNED` list yet because auth, admin and customers share the model.
- **Admin** (`src/modules/admin/`) replaced the 1 724-line `adminController` and the inline
  handlers in `routes/adminRoutes.js`: one `admin.controller` (every handler is
  `answer((req) => service(...))`), services `dashboard`, `sellers`, `seller-removal`,
  `customers`, `security` (master key + impersonation), `order-feed` (feed, CSV, failed pushes,
  archive), `moderation`, `staff`, `platform-tools` (Shiprocket account reads, Redis
  inspector); pure `audit-context` and `admin-emails`; repositories `users`, `products`,
  `order-feed`, `cleanup` (offers, media, carts…), `security` (PlatformSecurity + audit log).
  `routes/adminRoutes.js` is now a mount list: `router.use(adminModule.routes)` plus the
  sellers and orders admin routers and the controllers not yet in a module (payouts,
  notifications, brand requests, reminders). The admin repositories import `Order` and
  `Product` directly for feeds and aggregates — pinned in `modelImportsOutsideModule`
  like `modules/orders/inventory.repository.js`; the alternative, widening the orders
  and products indexes with admin-only queries, would couple the modules the wrong way.
- **Auth** (`src/modules/auth/`) replaced `authController` and `validation/auth.schema.js`
  (now `auth.schema.js` inside the module): services `seller-signup` (email-first register,
  verify link, set password, resend), `account` (customer register, login with its stable
  codes, profile, change password) and `password-reset`; pure `profile-input` (whitelist +
  clamps) and `auth-emails` (templates plus the `brandHeaderHtml` every transactional email
  shares — the admin module's staff invite imports it from `modules/auth`);
  `auth.repository` (User). `routes/authRoutes.js` and `controllers/authController.js`
  re-export the module (the onboarding reminder still takes `buildVerifyUrl` through the
  barrel). The two cross-role 409s that used `res.status(409); throw new Error` are
  `AppError.conflict` now.
- **Blog** (`src/modules/blog/`) replaced the 842-line `blogController` and both blog route
  files: services `public-blog`, `posts` (admin editing, site-checked taxonomy links),
  `taxonomy` (categories, tags, the shared author roster) and `comments`; pure
  `category-chain`; repositories `posts`, `taxonomy`, `comments`. The module exports
  `routes.public` (/api/blog) and `routes.admin` (/api/admin/blog), mounted by `routes/api.js`.
- **CMS** (`src/modules/cms/`) replaced `pageController` plus the seven small content
  controllers (banners, promo blocks, home SEO block, seller CTA, seller guides, FAQ,
  testimonials, redirects) and their ten route files: services `pages` (Redis-cached reads,
  revalidating writes), `static-pages` (manifest), `home`, `seller-guides` and `site-content`
  (FAQ, testimonials, redirects); pure `page-input`; repositories `pages` (+ Category / Brand
  slug reads), `home`, `content`, `users`. `cms.routes.js` exports one router per `/api`
  mount and `routes/api.js` mounts them by name; the old route files are gone.
  `controllers/blogController.js` and `controllers/pageController.js` re-export the modules.
- **Catalogue** (`src/modules/catalog/`) replaced the category, brand, brand/category request
  and review controllers and their three route files (deleted, no re-export barrels): models
  `category`, `brand`, `category-brand-request`, `review` moved in; services `categories`
  (the Redis-cached public tree, cycle-safe writes that clear the tree cache and rebuild the
  storefront pages), `brands`, `brand-requests` (KYC gate, pending-only edits, the admin
  decision) and `reviews` (purchase-verified upserts, the public list); pure `category-tree`;
  one repository per area. `catalog.routes.js` exports `categories`, `brands`, `reviews`
  (mounted in `routes/api.js`), `sellerRequests` (inside `/api/seller`) and `adminRequests`
  (inside `/api/admin`); the products module mounts `productReviews` on
  `/api/products/:slug/reviews`. Seeds, scripts, cms and products import the models from
  here. `test/app.test.js` checks every private catalogue route is mounted and guarded.
- **Customers** (`src/modules/customers/`) replaced the cart, wishlist, address, notify-me,
  checkout-failure and admin-cart controllers, `services/cartReminders`,
  `services/checkoutFailures`, `services/cartAvailability` and `routes/emailPreferenceRoutes`:
  models `cart`, `wishlist`, `notify-request`, `checkout-failure` moved in; services `cart`
  (availability verdicts, delivery quotes), `wishlist` (+ back-in-stock), `addresses`,
  `checkout-failures`, `admin-carts`, `cart-reminders` (the worker); pure `cart-availability`
  and `cart-reminder-email` (copy + signed unsubscribe links); one repository per area.
  `customers.routes.js` exports `shopper` (mounted by `routes/customerRoutes.js`, now a short
  composer: protect → shopper → the orders customer router → the failure capture) and `admin`
  (inside `/api/admin`); `email-preferences.routes.js` serves the HTML unsubscribe pages on
  `/api/email`. The index exports what other modules use: `cartAvailability` (orders
  pricing), `recordCheckoutFailure` (Razorpay webhook), `CHECKOUT_FAILURE_STEPS` (MCP),
  `captureCheckoutFailure` and `startCartReminderWorker` (`src/index.js`).
- **Offers** (`src/modules/offers/`) replaced `sellerOfferController`, its route file and
  `utils/resolveOffers`: model `seller-offer`; services `offers` (the seller's CRUD, scoped to
  them) and `offer-resolver` (live pricing for product responses and checkout); pure
  `offer-pricing` (savings, best offer, decoration) and `offer-input`. The index exports
  `resolveOfferForProduct` / `resolveOffersForProducts` (products module) and
  `loadLiveOffersForSellers` / `bestOfferForProduct` (orders checkout pricing).
- **Offline sales** (`src/modules/offline-sales/`) replaced the 680-line
  `offlineSaleController` and its route file: model `offline-sale`; one service (record, edit,
  undo, invoice, history, product picker); pure `offline-sale-tax` (inclusive GST split),
  `offline-sale-input` (buyer, date range) and `stock` (variant arithmetic shared by record,
  edit and undo). `test/offlineSales.test.js` is its first test coverage.
- **Seller media** (`src/modules/seller-media/`) replaced `sellerMediaController` and its
  route file: the seller's library, in-use-safe deletes (`IN_USE` on a single delete, skipped
  and listed on a bulk one) and 7-day presigned links.
- **Payouts** (`src/modules/payouts/`) replaced `payoutController` and took in
  `services/payouts.js` as the pure `payout-math`: weeks, settlements, courier-charge
  corrections. Routers `seller` (inside `/api/seller`) and `admin` (inside `/api/admin`,
  `settlements` permission); the index exports `payoutMath` for the orders module and the
  courier-charge backfill script.
- **Notifications** (`src/modules/notifications/`) replaced `notificationController`,
  `utils/notifyTeam` and `services/teamsNotifications`: `notify-team.service` (the one
  "tell the team" sender, never throws), `recipients.service` (superadmin management,
  audited), pure `team-email` and `teams-transport`. Auth, sellers and orders call
  `notifyTeam` from the index.
- **Onboarding reminders** moved into the admin module (`onboarding-reminders.service.js`,
  `onboarding-reminder-emails.js`), beside the sellers list that shows the same stages; the
  route is `POST /api/admin/sellers/:id/remind` under `sellers`, as before.
  `routes/adminRoutes.js` and `routes/sellerOrderRoutes.js` are now pure mount lists.
  Tests: `test/sellerTools.test.js` (settlement refusals, the in-use guard, reminder rules).
- **Media, contact, assistant** — the last small controllers. `src/modules/media/` is the
  admin media library (model `media`; `middleware/trackMediaUpload` still records uploads into
  it); `src/modules/contact/` the public contact form (schema moved out of
  `validation/legacy.schema.js`); `src/modules/assistant/` the assistant's saved chats
  (model `conversation`). The URL product import joined the products module:
  `url-import.service` (rights / key checks, provider errors never leak), the moved
  extraction pipeline `url-extract` and its SSRF-safe `public-page-fetch`.
- **No `src/controllers/` any more.** The seven re-export barrels are gone; routes, scripts
  and tests import `modules/<name>` (its index).
- **`src/infrastructure/<area>/`** holds third-party clients, as in Hive: `payments/razorpay`,
  `shipping/shiprocket`, `storefront/revalidate` (Next.js on-demand revalidation). They read
  config and call out; they own no domain rules and no models.
- **Order domain services moved in.** Shipment tracking (`shipment-status` mapping,
  `shipment-sync.service`, `shipment-worker.service`, queries in `shipments.repository`) and
  GST invoices (`tax-invoice.service` + `tax-invoice.repository`) live in the orders module;
  `webhookRoutes` and `src/index.js` reach them through the orders index. The per-seller
  delivery quote joined the customers module (`delivery-quote.service`, its two reads in
  `cart.repository`); orders checkout takes it from the customers index.
- **Shared on purpose.** `src/models/` keeps User, Counter and PrivateUpload: each is read by
  many modules, so no single module owns it.
- **Top-level layout (final).** `src/` is `app.js`, `index.js`, `config/` (env, mail, notify
  recipients, `sites.js` — the site list and permission keys, like Hive's `team-modules`),
  `database/` (`mongo.js` connect, `redis.js` client, seeds), `errors/`, `infrastructure/`, `middleware/`,
  `models/` (the three shared models), `modules/`, `routes/` (mount lists), `utils/` (incl.
  `rateLimitStore.js`, the Redis counter with a local fallback behind
  `middleware/rateLimit`, and `redisCache` / `redisInspector`) and `validation/`. The old
  `controllers/`, `services/`, `db/` and `constants/` folders are gone.
- **Validate guard covers every router.** It used to match only variables named `*router`,
  so module routers named for their mount (`shopper`, `categories`, `pages`) were never
  checked; it now checks any `<name>.<verb>('/path'` call in a route file.
- **Site scoping.** Blog, pages, FAQ, testimonials and redirects read the site from
  `req.site` (set by `resolveSite`) through `normalizeSite` in the controller and pass it to
  the service; the body never names the site, and a record cannot be moved between
  properties by editing it.
- **Tests across modules.** `loadModule(name, stubs)` in `test/helpers/controller.js` loads
  `orders`, `products`, `sellers`, `admin`, `auth`, `blog` or `cms` from its index (stub keys
  still resolve against `src/controllers/`, the legacy spelling); `loadController` is the
  orders shorthand. A module runs in its own VM realm, so
  assert on `Object.prototype.toString` rather than `instanceof Date`.
- **Models live with their module.** A model a module owns is `modules/<name>/<x>.model.js`
  (orders: order, checkout-intent, shipment-event; products: product; admin:
  platform-security, admin-audit-log; blog: the five blog models; cms: the ten content
  models; catalog, customers, offers, offline-sales, seller-media, payouts, notifications,
  media, assistant; mcp: mcp-settings, mcp-oauth, mcp-audit-log). `src/models/` keeps only
  the shared ones: User (read by nearly every module), Counter (sequence numbers) and
  PrivateUpload (the private-file store behind `middleware/upload`). As with
  Hive's `*.schema-db` files, a module's model files are a sanctioned cross-module surface:
  another module's repository (or a legacy controller) may `require('../orders/order.model')`
  directly, and the privacy guard allows exactly that path shape and nothing deeper. Inside a
  module only repositories and other models import models. The `OWNED` ratchet now matches
  on the model file (`order.model`), and `test/helpers/controller.js` maps legacy stub keys
  such as `'../models/Order'` onto the new paths, so older tests keep their spelling.
- **MCP connector** (`src/modules/mcp/`, moved from `src/mcp/`) keeps its own shape — it is a
  protocol adapter (OAuth provider, tool runtime, audit trail, admin management), not a
  request/response domain — but follows the data rule: `mcp.repository.js` holds every
  statement for the settings document, OAuth clients / codes / tokens, the audit log and the
  staff reads; `tools.repository.js` holds the marketplace reads behind the `tin_*` tools.
  `oauth`, `manage`, `audit`, `settings` and `tools` import no models. `src/app.js` imports
  the module index (`createMcp`, `getConfig`); the tests reach its internals directly.
- **Seeds and repairs.** Boot-time and `npm run seed:*` seeds live in `src/database/seed/`
  (`src/index.js` runs the boot list from there). The two repair CLIs moved out of `src/` to
  `scripts/repair-blog-timestamps.js` and `scripts/recompute-order-status.js`, beside the
  other one-off maintenance scripts. The console allow-list treats `database/seed/` as CLI.
- **Still outside a module:** categories, brands, reviews, cart / wishlist / addresses
  (customerRoutes), media, seller offers, offline sales, contact, notifications, payouts,
  brand-category requests and the assistant conversations. Each is a single controller
  under 400 lines (or pinned) and moves when it is next touched.

## Tests (step 7 — in force)

- One runner, one command: `npm test` runs vitest over both projects declared in
  `vitest.config.mjs`. `npm run test:unit` is everything that needs no database (stubs,
  VM-loaded modules, in-process HTTP); `npm run test:integration` is the four suites that boot
  `mongodb-memory-server` (commerce flows, order archive, cart reminders, MCP). `npm run
  test:watch` for development. The whole run takes about twenty seconds once the MongoDB
  binary is cached.
- Test files stay CommonJS (`require`) and use the vitest globals — `test`, `describe`,
  `beforeAll` / `afterAll` / `beforeEach`, `vi` — with `node:assert/strict` for assertions.
  Mock a method with `vi.spyOn(obj, 'name').mockImplementation(fn)`; `restoreMocks: true`
  puts it back after each test, and `unstubGlobals: true` does the same for `vi.stubGlobal`.
  Count calls with `spy.mock.calls.length`.
- Every file runs in its own forked worker (`pool: 'forks'`), so a suite that sets
  `process.env`, deletes from `require.cache` or hooks `Module._load` cannot leak into another.
  Tests inside a file run in order, so a `describe` may carry state from one test to the next
  (see `test/pickupSelfVerify.test.js`); a file never calls `process.exit`.
- `src/config/env.js` treats `VITEST`, `NODE_TEST_CONTEXT` or `NODE_ENV=test` as "under test":
  boot warnings and the logger are silent.
- Timeouts: 30 s per test, 180 s per hook (the first integration run downloads MongoDB).
- A new suite is `test/<name>.test.js`; it joins the unit project automatically. Add it to the
  `INTEGRATION` list in `vitest.config.mjs` only if it needs the in-memory database.

## Code-shape guards (step 8 — in force)

`test/codeShape.test.js` (unit project) holds the rules above as tests, so a rule ships with
the check that fails the build. Scan helpers live in `test/support/codeScan.js`; comments are
stripped before matching so a documented example never reads as a live call site.

Hard rules — a violation anywhere in `src/` fails:

- `process.env` is read only in `config/env.js`.
- Server-process code logs through `utils/logger`, never `console` (the CLI allow-list is in
  the test).
- No `res.status(n); throw new Error(…)` or `next(new Error(…))` sites.
- Inside `src/modules/`: only `*.repository.js` import models; repositories import only
  models, mongoose, errors and node built-ins; controllers import no models or mongoose and
  throw no bare `Error`; a module's internals are private — code outside the module imports
  `modules/<name>` (its index) and nothing deeper.

Ratchets — legacy debt pinned in `test/support/codeShape.baseline.json`, which may only shrink:

- `fileSize`: no file may cross **400 lines**. The list is now empty — every file is under the
  ceiling (2026-10-29), so in practice this is a hard rule. Pinning a file again is allowed
  only with a written reason in the same change: `{ "lines": N, "reason": "<date>: why" }`.
  The last nine were split by concern without changing behaviour: the Shiprocket client
  (`infrastructure/shipping/shiprocket/` client + pickups / shipments / operations), the
  upload middleware (`middleware/upload/` keys, storage, files, guards), the order model
  (`seller-shipment.fields.js`, `return-request.fields.js`) and User (`user-kyc.schema-part.js`)
  — both compiled schemas checked identical — the MCP catalogue (`tool-helpers.js`), the
  seed page copy (`seed/pages-content/`), the demo / bike-logo seeds, and the dev-only
  Shiprocket mock (`routes/mock-shiprocket/`). Eleven more were split ahead of the Prettier
  pass, because formatting unfolds dense one-liners and would have pushed them back over:
  MCP OAuth (`oauth-tokens`, `oauth-pages`, `oauth-clients`, `oauth-login`), MCP admin
  (`manage-errors`, `manage-settings`), the MCP catalogue (`tools-ops`, `tools-orders`,
  `tools-partners`), orders (`tax-invoice.pdf`, `return-requests`,
  `return-resolution.service`, `shipment-labels`, `order-emails`), `cms/page-slugs`, the
  bikes / demo-product seed data and the mock manifest page. A formatted copy of the tree
  passes lint, every test and this guard.
- `modelImportsOutsideModule`: for each model a module owns (`Order`, `CheckoutIntent`,
  `Product`), the files outside the module that still import it. A new importer fails; the fix is to go
  through `modules/orders`. When a file stops importing the model, remove it from the list.

Both directions fail on purpose: a baseline that overstates the debt is as wrong as one that
understates it, which is what keeps the file honest. Adding a module: add its models to
`OWNED` in the test and pin the current outside importers.

## Lint and format (in force)

`eslint.config.mjs` (flat config, ESLint 10) is the editor-time twin of the shape guards: the
recommended rules plus three house rules — no `console` outside the CLI allow-list, no
`process.env` outside `config/env.js`, no `res.status(4xx+).json(…)` for failures. Test files
run with the vitest globals; `src/modules/mcp/index.js` may answer JSON-RPC errors raw.
`eslint-config-prettier` is loaded last so no formatting rule fights the formatter.

- `npm run lint` must pass clean (it does today — the sweep removed the stale
  `eslint-disable` comments, unused imports and dead helpers it found). `npm run lint:fix`
  for the auto-fixable part.
- `.prettierrc` (single quotes, trailing commas, width 120, `endOfLine: auto` because the
  tree is CRLF, and `endOfLine: auto` leaves each file's line endings as they are).
  `npm run format` / `npm run format:check`. The whole tree was formatted once in its own
  commit (362 files, formatting only); `format:check` must stay clean.
- Pre-commit: `backend/.githooks/pre-commit` runs `lint`, `format:check`, `typecheck` and the
  unit project. Opt in per clone with `git config core.hooksPath backend/.githooks`
  (GitHub Desktop honours it).

## Type checking (step 9, stage 1 — in force)

`npm run typecheck` runs `tsc` over `src/` with `allowJs` + `checkJs` and `noEmit`. Nothing is
compiled or emitted: the runtime, Dockerfile and pm2 still run the `.js` files as they are.
`strict` is off for now. It must stay at **zero errors**. A run takes about 30 s and 1 GB.
Incremental mode is off on purpose: its cache ran out of memory (4 GB) twice after
multi-file changes, which would block commits through the hook.

- `src/types/express.d.ts` lists what middleware adds to `req`: `user`, `impersonation`,
  `site`, `id`, `rawBody`, `checkoutStep` and `_uploadPrefix`. Add a property there when new
  middleware sets one. `file` / `files` come from `@types/multer`.
- `src/types/globals.d.ts` covers two things:
  - `Error` may carry `status`, `code` and `data`, the convention `errorHandler` and the
    logger read.
  - `PostalAddress`: annotate `const a = x.shippingAddress || {}` style reads with
    `/** @type {PostalAddress} */`.
- Model methods and statics go in the Schema options (`{ methods: { … }, statics: { … } }`).
  The functions stay hoisted declarations below. Mongoose stores the same object as
  `schema.methods` / `schema.statics`, and TypeScript can only see them this way;
  `schema.statics.x = …` after construction is invisible to it. This also applies to
  constants such as `Order.NOT_ARCHIVED`, `BlogPost.STATUSES` and `NotificationSettings.EVENTS`.
- In a hook, reach the model with `this.$model()`, which is the same object as
  `this.constructor`, rather than `this.constructor`.
- Mongoose's inferred types cannot follow `populate()`. A repository function that returns
  populated rows says so with `@returns {Promise<any>} populated: …`; see
  `findByIdWithCustomer` and `loadCartForCheckout`.
- Filters built up step by step take `/** @type {Record<string, any>} */`. Mongoose 9 checks
  filter literals against the schema, so a widened `string` fails an enum field.
- Assigning a plain array (or a string to an enum field) on a typed document goes through
  `doc.set('path', value)`. That is what the property setter calls anyway.
- Destructured options with a `= {}` default need a JSDoc `@param` that marks each option
  optional; otherwise TypeScript drops the options that have no default. Document every
  parameter before it (for example `req`) so the tags line up.
- Untyped external JSON (Shiprocket, the model API) is annotated `@type {any}` where it is
  read. A cast is for a value the checker cannot know; it is never a way to silence a real
  mismatch.

## Build (step 9, stage 2 — in force)

- `npm run build` compiles `src/` into `dist/` with `tsconfig.build.json`. `.js` and `.ts`
  files sit side by side while modules convert. The container (Dockerfile build stage) runs
  `node --enable-source-maps dist/index.js`, so stack traces still name `src/` files and
  lines. `dist/` is git- and docker-ignored, and the image always compiles its own.
- The build keeps each file's strictness (`alwaysStrict: false`, `moduleDetection: auto`).
  `tsc` would otherwise add `"use strict"` to every CommonJS file, and strict mode changes
  semantics (for example, writing to a frozen object throws). A `.ts` file with
  `import`/`export` is strict.
- `dist/` has the same depth as `src/`, so `__dirname`-relative paths (uploads, assets,
  private files, `.env`) resolve the same. Keep it that way: nothing in `src/` may require a
  file outside `src/` (that is why `loadEnv` moved into `src/config/`).
- Checked when it landed: every compiled file differs from its source only in whitespace and
  layout, the full suite (304 tests) passes against `dist/`, and `dist/` requires no dev
  dependency.
- `npm run dev` and the CLI seeds still run `src/` directly. That changes when the first
  `.ts` file lands (`tsx` for dev, seeds and the test loader).

## Plan (remaining steps)

9. TypeScript, stage 2, the next part: convert files to `.ts` module by module, starting with
   the pure helpers, and add `tsx` for dev, the CLI seeds and the vitest/VM test loader. Turn
   `strict` on per directory as files convert.
