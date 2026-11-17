# Security hardening and regression audit — 24 September 2026

Changes are implemented in the local checkout. They have not been deployed. This review fixes confirmed weaknesses and adds regression coverage; it is not a certification that every possible vulnerability or bug has been eliminated.

## Security fixes

| Area | Finding and resulting behavior |
| --- | --- |
| Authentication | Removed shared master-key login from the public login endpoint. Support access requires an authenticated superadmin and is revoked when the operator's account/session is revoked. Normal and optional authentication both enforce session versions. New passwords require 12 characters and respect bcrypt's 72-byte limit. |
| Injection | JSON, query parameters, and parsed multipart JSON reject MongoDB operators, dotted update paths, prototype keys, excessive nesting, and query pollution. Existing server-controlled database operators remain supported. CMS and seller rich text is sanitized during both server and browser rendering. Post-login destinations are limited to local paths. |
| Authorization | Admin media routes require staff/admin access, with deletion restricted to superadmins. Private upload references must belong to the submitting account or already exist on the account's own record. Product creation cannot supply internal identifiers, ratings, timestamps, or seller-controlled featured status. |
| Private files | KYC and return evidence are stored outside the public disk directory or under private S3 prefixes. Authorized responses issue expiring links. Public disk serving checks legacy KYC/evidence references. Signing fails closed; private S3 URL signatures are preserved by clients. |
| Uploads | Enforced extension/MIME allowlists, initial byte signatures, file/field limits, and per-account upload throttles. New SVG uploads are rejected. Invalid signatures are rejected before storage starts. These checks are not an antivirus scanner or full file decoder. |
| Abuse controls | Login/reset/contact/comment/upload limits continue during Redis outages using a bounded local fallback. Account rate-limit keys normalize email spelling. Forwarded IPs are trusted only through explicit proxy configuration. |
| Browser/API exposure | Production image optimization no longer permits private IP targets. Added framing, content-type, referrer and transport headers. Production server errors omit internal details. Mock shipping routes are disabled in production. Request logs omit query signatures and password-reset tokens. Cache invalidation requires a strong header secret and validated paths/tags. |
| Credentials and dependencies | Removed credential-looking values from the tracked environment example, expanded environment-file ignores, added a backend lockfile, repaired the storefront lockfile, and updated Next.js/Tiptap and vulnerable transitive dependencies. Removing an example does not invalidate a previously exposed credential. |
| Deployment | Added reusable dependency/build/regression checks before image publication, removed unpinned native-package installs from the storefront image, updated the admin runtime to Node 22, fixed the missing-wget health check, deploys images by commit tag, and passes cache-invalidation credentials at runtime. |

Automatic deletion of an object when an arbitrary product reference is removed has been disabled: referencing an image does not prove ownership. Authorized media deletion remains available. Storage reclamation requires reviewed orphan cleanup.

## Commerce and application fixes

- Checkout stock reservations and order persistence commit in one database transaction; exact variant and aggregate stock move together. Failed multi-item checkout rolls back all reservations.
- COD requests carry a reusable, customer-scoped idempotency key, including the CORS header needed by browsers. Payment verification uses the original snapshot and validates owner, captured amount, currency, and provider order.
- Captured payments with unavailable inventory produce an explicit dispatch hold instead of shipping unreserved goods. Holds are visible in admin/seller details.
- Cancellation, return verification, and replacement reservations persist their stock markers with inventory changes. Repeated and mixed seller/whole-order cancellation cannot restore the same units twice. Interrupted carrier cancellation can be retried; cancelled seller shipments cannot be dispatched or recreated.
- Refund claims share the order's remaining payment budget. Pending refunds are completed by verified events or the admin's provider-status action. Ambiguous network outcomes remain locked against duplicate transfers. Each retry has a distinct attempt ID, so old events cannot overwrite a newer attempt.
- Shipment, cancellation, return, and refund changes use a per-order database lock. Shipping/payment calls have a 20-second timeout. An abandoned lock expires after 30 minutes.
- Payment snapshots no longer expire automatically: startup removes the legacy `expiresAt` TTL index and clears its fields. Existing captures therefore retain the data needed for delayed verification. Stale finalization claims can be retried.
- Cart cleanup preserves unrelated additions. Registered the missing order-counter model. Background shipment updates load a fresh order instead of concurrently saving the checkout's document.
- Seller password changes store the replacement token. Fixed the homepage's conditional hook and recreated form components that could lose UI state/focus.

## Verification

| Check | Result |
| --- | --- |
| Existing multisite tests | 24 passed |
| Existing pickup-verification tests | 38 passed |
| Security regressions | 14 passed |
| Database/HTTP integration regressions | 19 passed |
| Storefront production build and type validation | Passed, Next.js Webpack build |
| Admin production build and type validation | Passed, Next.js Webpack build |
| Dependency advisory scan | 0 known advisories reported for each of backend, storefront and admin, including development dependencies |
| Backend JavaScript parsing | 175 files passed |
| Workflow/Compose YAML and whitespace checks | Passed |
| ESLint | Still fails: storefront 86 errors / 178 warnings; admin 62 errors / 51 warnings. Using the same updated linter against the original checkout produced 90 / 179 and 64 / 53 respectively. The pre-existing lint backlog was not disabled or represented as passing. |

Integration tests use a disposable local MongoDB replica set, fake payment/carrier responses, and local HTTP multipart requests. They cover last-unit races, rollback after an injected persistence failure, duplicate checkout/cancellation, private-file ownership, failed refund retries, stale events and payment binding. No live payment, carrier or production database was exercised.

Reproduce after installing all three locked dependency sets:

```sh
npm ci --prefix backend
npm ci --prefix frontend
npm ci --prefix admin
npm test --prefix backend
npm run test:integration --prefix backend
npm run build --prefix frontend -- --webpack
npm run build --prefix admin -- --webpack
npm audit --prefix backend
npm audit --prefix frontend
npm audit --prefix admin
```

The integration suite downloads a MongoDB test binary on first run and needs permission to listen on loopback. The old `2026-09-21-commerce-fixes-verify.cjs` command now delegates to the maintained suites. Builds need network access for the configured Google fonts. Turbopack could not complete in this execution environment; the verified builds used Webpack.

## Required deployment work and limits

1. Rotate any credentials previously committed, shared, or exposed, especially the payment secret represented in the old example. Review repository history and deployment logs without copying secrets into tickets. No live credentials were rotated during this task.
2. Use Node 22.22.2+ and a MongoDB replica set/Atlas cluster. Take a backup, verify the required unique indexes, and allow the backend startup account to remove the legacy checkout TTL index. Previously deleted snapshots cannot be recovered by this code.
3. Configure a strong `JWT_SECRET`, exact CORS origins, `PUBLIC_API_URL`, narrowly scoped `TRUST_PROXY`, and shared Redis when running multiple API processes. Redis fallback is per process. Password changes may invalidate existing support sessions as intended.
4. Keep S3 Block Public Access enabled, restrict bucket credentials, and ensure Nginx/CDN does not bypass the API's private-file guard. Purge any cached private documents exposed by the previous public upload route. Persist and back up the private disk directory when using disk storage.
5. Configure Razorpay capture/refund events and the shipment webhook with their secrets. Run provider sandbox checkout, cancellation, return, refund and retry scenarios before enabling traffic. An ambiguous refund with no visible provider result requires reconciliation; it is deliberately not blindly retried.
6. Set the same random `REVALIDATE_SECRET` (at least 32 characters) in the backend and GitHub deployment secret. Missing configuration leaves invalidation unavailable instead of accepting unauthenticated requests.
7. Deploy the backend separately: the existing production workflow only publishes/restarts the two web applications. Observe dispatch holds, pending carrier cancellations, abandoned locks and refunds requiring reconciliation after release.

This audit did not verify deployed TLS, cloud IAM, database backups, host patching, historical data repair, or every browser interaction. Existing lint findings still need triage. Background notifications/initial shipment submission still use in-process jobs; a process crash may require the existing retry/reconciliation path. A durable job queue and malware scanning are further production hardening work.

Relevant primary guidance: [OWASP NoSQL security](https://cheatsheetseries.owasp.org/cheatsheets/NoSQL_Security_Cheat_Sheet.html), [OWASP file upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html), and [Next.js image security options](https://nextjs.org/docs/app/api-reference/components/image).
