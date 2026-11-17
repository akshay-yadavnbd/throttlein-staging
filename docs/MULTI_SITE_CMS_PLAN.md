# Multi-Site CMS — Implementation Plan

> **STATUS: IMPLEMENTED.** All five phases below have shipped. This
> document is kept as the design rationale; for what to actually run on
> deploy, see **§8 Deploy runbook** at the bottom — the migration step
> is mandatory and the site breaks without it.
>
> Verification: `npm run test:multisite` in `backend/` (24 assertions
> covering site resolution and the permission guards).


**Goal.** One admin panel, two content surfaces. Admin/staff pick a site
from a switcher in the sidebar; Pages and Blogs created under **Throttlein**
publish to `throttlein.com`, and those created under **Seller** publish to
`seller.throttlein.com`. Access is granted per site via separate permission
keys.

**Status:** plan only — no code written yet.

---

## 0. Decisions taken

| Question | Decision |
|---|---|
| Permission model | **Per-site keys.** `pages` / `blogs` (main) and `seller-pages` / `seller-blogs`. Staff can hold either, both, or neither. |
| Switcher UX | **Dropdown at the top of the admin sidebar.** Selection persists in `localStorage`; hidden entirely when the user only has one site. |
| Seller URLs | **Mirror the main site.** `seller.throttlein.com/<slug>` and `seller.throttlein.com/blog/<chain>/<slug>`. |
| Backwards compatibility | `site` defaults to `'main'` on every model. Every phase below ships without changing the behaviour of the existing site. |

---

## 1. Where we're starting from

Facts established by reading the code, because they constrain the design:

- **No tenancy exists today.** No `site` / `tenant` / `domain` field on any
  Mongoose schema. `PAYMENT_SOURCE_TAG` in `backend/src/services/razorpay.js`
  is a Razorpay dashboard label only and scopes nothing.
- **Both hosts are already served by one Next app.** `frontend/proxy.ts` →
  `handleSellerHosts()` rewrites `seller.<domain>` onto `/seller/*` and
  `/dashboard/*`, and **301s every other path back to the main origin**
  (line 116-118). That last rule is what currently makes seller-side CMS URLs
  impossible, and it's the single most important thing this plan changes.
- **Slugs are globally unique.** `Page.slug`, `BlogPost.slug`,
  `BlogCategory.name`/`.slug`, `BlogTag.name`/`.slug` all carry
  `unique: true`. Two sites both wanting `/about` or a "News" category
  requires converting these to compound indexes.
- **Permissions are a free-form string array.** `User.permissions` is
  `[String]` with no enum (`backend/src/models/User.js`), and the canonical
  key list lives in `admin/lib/modules.ts`. Adding `seller-pages` needs no
  schema migration — just a registry entry and a `requirePermission` call.
- **JWT carries only `id`, `role`, `email`** (`signToken` in
  `backend/src/middleware/auth.js`); `protect` re-loads the User on every
  request, so permissions are always fresh. **No token changes needed.**
- **`AdminShell` is imported by ~47 pages** — there is no `(dashboard)` route
  group. Anything added to the shell reaches every screen for free; anything
  requiring per-page edits costs 47 diffs. Design accordingly.
- **Admin API calls all go through one axios instance** (`admin/lib/api.ts`)
  with a request interceptor. This is the cheap injection point for the
  active site.

---

## 2. Phase 1 — Data layer

### 2.1 The `site` field

Create `backend/src/constants/` (the directory does not exist yet) and add
`backend/src/constants/sites.js`:

```js
const SITES = ['main', 'seller'];
const DEFAULT_SITE = 'main';
const isSite = (v) => SITES.includes(v);
const normalizeSite = (v) => (isSite(v) ? v : DEFAULT_SITE);
module.exports = { SITES, DEFAULT_SITE, isSite, normalizeSite };
```

Add this field to each scoped model:

```js
site: { type: String, enum: SITES, default: 'main', required: true, index: true },
```

| Model | Scoped? | Rationale |
|---|---|---|
| `Page` | **yes** | Core requirement. |
| `BlogPost` | **yes** | Core requirement. |
| `BlogCategory` | **yes** | Categories appear in blog URLs and archive pages — must not leak across sites. |
| `BlogTag` | **yes** | Same. |
| `BlogAuthor` | **no (shared)** | Same humans write for both properties. Flagged as a reversible decision — see §7. |
| `BlogComment` | **yes (denormalised)** | Set from `post.site` on create. Lets the admin moderation queue filter by site with an indexed query instead of a join. |
| `Redirect` | **yes** | `seller.throttlein.com/old` and `throttlein.com/old` are different redirects. |
| `FaqSection`, `HomeBanner`, `HomeSeoBlock`, `PromoBlock`, `SellerCta`, `SellerGuide` | **no (v1)** | Main-site homepage furniture. Out of scope; see §7. |

### 2.2 Index changes

Mongoose will **not** drop the old single-field unique indexes on its own.
Each needs an explicit drop in the migration.

| Model | Drop | Create |
|---|---|---|
| `Page` | `slug_1` | `{ site: 1, slug: 1 }` unique |
| `BlogPost` | `slug_1` | `{ site: 1, slug: 1 }` unique |
| `BlogCategory` | `slug_1`, `name_1` | `{ site: 1, slug: 1 }` unique, `{ site: 1, name: 1 }` unique |
| `BlogTag` | `slug_1`, `name_1` | `{ site: 1, slug: 1 }` unique, `{ site: 1, name: 1 }` unique |
| `Redirect` | `source_1` | `{ site: 1, source: 1 }` unique |

Remove `unique: true` from the field definitions and declare the compound
index once via `schema.index(..., { unique: true })` — matching the pattern
`Redirect.js` already uses (it has a comment explaining why, at line 32).

**Also update the slug-collision resolver** in `BlogPost.pre('save')` (the
`-2`, `-3` suffix loop) to scope its uniqueness probe by `site`, otherwise a
seller post will needlessly become `about-2` because a main-site `about`
exists.

### 2.3 Reserved slugs become per-site

`RESERVED_TOP_LEVEL_SLUGS` in `backend/src/models/Page.js:133` guards against
collisions with hard-coded Next routes. The seller host has a *different* set
of hard-coded routes. Replace the single `Set` with:

```js
const RESERVED_SLUGS = {
  main:   new Set([...existing list...]),
  seller: new Set(['login','register','verify','guide','dashboard','blog','c','api']),
};
```

and have the `pre('save')` guard read `RESERVED_SLUGS[this.site]`.

Note the seller set is much smaller: `/products`, `/cart`, `/about` etc. are
*not* reserved on the seller host, so the seller site can legitimately own
those slugs.

### 2.4 Migration script

`backend/scripts/migrateSiteField.js` — idempotent, safe to re-run:

1. `updateMany({ site: { $exists: false } }, { $set: { site: 'main' } })` on
   every scoped collection.
2. For `BlogComment`, backfill from the parent post
   (`$lookup` or a batched loop keyed by `post`).
3. Drop the legacy indexes listed in §2.2, tolerating `IndexNotFound`.
4. `await Model.syncIndexes()` for each model.
5. Print a per-collection before/after count.

Add `"migrate:site": "node scripts/migrateSiteField.js"` to
`backend/package.json`.

**Run order in production:** deploy backend with the new schemas → run the
migration → *then* deploy admin/frontend. Because `site` defaults to `'main'`
and every read defaults to `'main'`, the site behaves identically in the
window between steps.

---

## 3. Phase 2 — API and permissions

### 3.1 Permission keys

Four keys total; `seller-` prefix convention:

| Main site | Seller site |
|---|---|
| `pages` | `seller-pages` |
| `blogs` | `seller-blogs` |

Superadmin bypasses both, unchanged.

### 3.2 New middleware

In `backend/src/middleware/auth.js`, alongside `requirePermission`:

```js
/**
 * Site-scoped permission guard. Resolves the request's site (see
 * resolveSite), then requires `<base>` for main and `seller-<base>`
 * for the seller site. Superadmin bypasses.
 */
const requireSitePermission = (base) => (req, res, next) => {
  const site = req.site || DEFAULT_SITE;
  const key = site === 'main' ? base : `${site}-${base}`;
  return requirePermission(key)(req, res, next);
};
```

And a `resolveSite` middleware (new file
`backend/src/middleware/resolveSite.js`), run before the guard, resolving in
this order:

1. `req.query.site`
2. `req.body.site` (writes)
3. `X-Admin-Site` header (what the admin axios interceptor sends)
4. `X-Site` header (what the storefront sends)
5. `Origin` / `Referer` host matched against `SELLER_ORIGIN`
6. fallback `'main'`

Sets `req.site`. Rejects unknown values with 400 rather than silently
defaulting — a typo'd site should be loud, not quietly write to the main
site.

### 3.3 Route wiring

| File | Change |
|---|---|
| `backend/src/routes/pageRoutes.js` | `router.use(resolveSite)`; swap `requirePermission('pages')` → `requireSitePermission('pages')` on the 5 write/admin routes. |
| `backend/src/routes/adminBlogRoutes.js` | Change the umbrella `router.use(protect, requirePermission('blogs'))` (line 12) → `router.use(protect, resolveSite, requireSitePermission('blogs'))`. Covers all 22 endpoints at once — **including the 5 author routes**, which §2.1 leaves unscoped. Gate those with plain `requirePermission('blogs', 'seller-blogs')` individually so either site's blog editor can manage the shared author roster. |
| `backend/src/routes/blogRoutes.js` | `router.use(resolveSite)` (public — no permission). |
| `backend/src/routes/redirectRoutes.js` | Same treatment as pages, keyed on `pages`. |
| `backend/src/routes/staticPagesRoutes.js` | No change — filesystem manifest is main-site only in v1. |

### 3.4 Controller changes

Mechanical and uniform: **every query gets `site: req.site`, every create
gets `site: req.site`, every update refuses to change `site`.**

- `pageController.js` — `list`, `getBySlug`, `resolveByRoute`,
  `getStaticMetaByRoute`, `getById`, `create`, `update`, `remove`.
- `blogController.js` — **this is one file, not two.** There is no
  `adminBlogController.js`; `adminBlogRoutes.js:5` requires
  `../controllers/blogController`, so the public handlers and all ~22 admin
  handlers (`adminList`, `adminCreate`, `adminListCategories`,
  `adminListComments`, …) share this module. Budget accordingly — it's the
  single largest edit surface in Phase 2. `publicFilter()` gains `site`;
  every post/category/tag/comment handler passes it. Author handlers stay
  unscoped.
- `redirectController.js` — list + CRUD.

Two things that are easy to miss:

**Cache keys must include the site.** In `pageController.js` the keys are
currently `page:static-meta:<route>`, `page:slug:<slug>`,
`page:route:<parent>:<brand>:<slug>` (lines 76, 86, 166). Insert the site
segment: `page:<site>:slug:<slug>`. Without this, a seller page named
`about` will be served from the main site's cache entry.
`bustPageCaches()` wipes `page:*` so it needs no change.

**`pageToRoute()` must return the *internal* Next path.** ISR revalidation
keys on the app-router path, not the public URL, and the seller host's public
URLs are rewrites. The existing mapping (`pageController.js:205-212`) is:

```
home        → '/'
static-meta → page.staticRoute        e.g. '/about'
prose       → '/page/<slug>'          ← note: /page/, not /p/
dynamic     → page.staticRoute || '/<slug>'
```

(The comment on `Page.js:18` claiming prose renders at `/p/<slug>` is already
stale in the repo — worth fixing in passing.)

The seller site mirrors these public paths exactly, under one internal
namespace prefix:

```js
const SELLER_PREFIX = '/seller/c';   // 'c' = content
function pageToRoute(page) {
  const path = /* existing logic, unchanged */;
  if (!path) return null;
  return page.site === 'seller' ? `${SELLER_PREFIX}${path}` : path;
}
```

So a seller prose page public at `seller.throttlein.com/page/about` is
internally `/seller/c/page/about`, and a seller dynamic page public at
`seller.throttlein.com/helmets` is `/seller/c/helmets`. One prefix, one
catch-all route (§5.2), and `revalidatePath` targets the same string the
proxy rewrites to.

(Both hosts hit the same Next process, so `FRONTEND_ORIGIN` stays single.)

### 3.5 Backend test checklist

- Two `Page` docs with slug `about`, one per site → both save.
- Staff with only `seller-pages` → 403 on `POST /api/pages` with
  `site=main`, 201 with `site=seller`.
- `GET /api/pages/about?site=seller` never returns the main-site row, and
  vice versa, **including on a warm Redis cache**.
- `resolveSite` rejects `?site=bogus` with 400.

---

## 4. Phase 3 — Admin panel

### 4.1 Module registry

`admin/lib/modules.ts` gains one optional flag rather than duplicated
entries:

```ts
/** When true, this module's data is per-site. The effective permission
 *  key becomes `<key>` on main and `seller-<key>` on the seller site. */
siteScoped?: boolean;
```

Set `siteScoped: true` on the `pages` and `blogs` entries. Add:

```ts
export function permKeyFor(m: AdminModule, site: SiteKey): string {
  if (!m.siteScoped || site === 'main') return m.key;
  return `${site}-${m.key}`;
}
export const ALL_PERMISSION_KEYS: string[] =
  STAFF_ASSIGNABLE_MODULES.flatMap((m) =>
    m.siteScoped ? [m.key, `seller-${m.key}`] : [m.key]
  );
```

### 4.2 New: `admin/lib/site.ts`

```ts
export type SiteKey = 'main' | 'seller';
export const SITES = [
  { key: 'main',   label: 'Throttlein',  host: 'throttlein.com' },
  { key: 'seller', label: 'Seller',      host: 'seller.throttlein.com' },
] as const;

export function sitesAvailableTo(user: AdminUser | null): SiteKey[];
export function getActiveSite(): SiteKey;          // localStorage 'admin_site'
export function setActiveSite(s: SiteKey): void;   // + window event
```

`sitesAvailableTo` returns both for superadmin; for staff, a site is
available if they hold **any** site-scoped permission for it.

### 4.3 `admin/components/SiteSwitcher.tsx`

- Renders above the nav in `AdminShell`'s `<aside>` (line ~328–335).
- Hidden when `sitesAvailableTo(user).length < 2` — a main-site-only editor
  sees exactly today's UI.
- Visually distinct per site (e.g. a coloured left border / dot) so nobody
  publishes to the wrong domain by accident.
- On change: `setActiveSite`, then **navigate to the module's root**
  (`/pages`, `/blogs`) rather than staying on the current URL. Detail routes
  are `/blogs/<id>` and those IDs don't exist on the other site.

### 4.4 `AdminShell.tsx`

Three touch-points, all localised:

1. `NAV` (line 213) moves from a module-level constant to a `useMemo` over
   the active site, so `permission: permKeyFor(m, site)`.
2. `canAccessNav` (line 229) is also module-level and takes `NAV` items by
   argument — its logic is unchanged, it just receives the site-derived key.
3. The URL guard effect (lines 264-268) currently **closes over the
   module-level `NAV`**. It has to take the memoised value and add it to the
   effect's dependency array. This is a third edit, not a free ride on (1).

Net effect: a staffer with only `seller-blogs` who types `/blogs` while the
switcher says "Throttlein" gets bounced to `/dashboard`, as intended.

Also add a persistent site indicator to the header bar — belt and braces
alongside the switcher.

### 4.5 `admin/lib/api.ts`

Extend the existing request interceptor:

```ts
config.headers['X-Admin-Site'] = getActiveSite();
```

**This is the whole reason for choosing a header over a query param.** There
are 27 `page.tsx` files under `admin/app/pages/**` and `admin/app/blogs/**`
(19 + 8); roughly 12 of them are the genuinely site-scoped CRUD screens, the
rest being homepage-furniture editors that §2.1 leaves out of scope. With the
interceptor, none of them need a data-fetching change — they keep calling
`api.get('/admin/blog')` and get the right site's data.

The one hazard is a stale header writing to the wrong site. Two mitigations:

- Every create/edit form renders a **read-only "Publishing to: Seller"
  badge**, sourced from the same `getActiveSite()`.
- Every detail screen (`/blogs/[id]`, `/pages/prose/[id]`, …) compares the
  fetched record's `site` against the active site and, on mismatch, switches
  the switcher to the record's site rather than showing mixed state. The
  backend independently enforces the permission, so the worst case is a
  confusing view, never an unauthorised write.

### 4.6 Staff permission grid — `admin/app/staff/page.tsx`

For `siteScoped` modules, the row renders **two checkboxes** (Throttlein /
Seller) instead of one; non-scoped modules keep a single checkbox spanning
both columns. `deriveRoleFromPermissions()` and the "admin" preset switch
from `STAFF_ASSIGNABLE_MODULES.map(m => m.key)` to `ALL_PERMISSION_KEYS`.

The staff *list* chips should read "Pages · Seller" so it's scannable at a
glance who owns what.

**No backend change is needed here**, but not for the reason you'd guess.
`User.permissions` (`User.js:121`) is `[String]` with no enum, *but* it is
declared `lowercase: true`, and `createStaff`/`updateStaff` additionally run
the array through `validatePermissions()` (`adminController.js:944`, called
at :993 and :1056) which trims, lowercases, dedupes and drops empties. The
new keys pass through untouched because `seller-pages` and `seller-blogs` are
already lowercase and hyphenated. Keep future permission keys in that shape —
anything with uppercase would be silently rewritten.

### 4.7 Existing staff are unaffected

Someone holding `pages` today keeps exactly the access they have. They gain
nothing on the seller site until a superadmin ticks `seller-pages`. That's
the correct default for a permission change.

---

## 5. Phase 4 — Storefront

### 5.1 `frontend/proxy.ts` — the key change

In `handleSellerHosts()`, the seller-host branch currently ends by 301ing
every unrecognised path to the main origin (lines 116–118). Replace that
fallback with content rewrites:

```
seller host:
  /                       → rewrite /seller                    (existing)
  /login|register|verify|guide  → rewrite /seller/*            (existing)
  /dashboard/*            → pass through                       (existing)
  /seller/*               → 301 to clean URL                   (existing)
  /blog, /blog/*          → rewrite /seller/blog/*             ← NEW
  /sitemap.xml            → rewrite /seller/sitemap.xml        ← NEW
  /robots.txt             → rewrite /seller/robots.txt         ← NEW
  everything else         → rewrite /seller/c/<path>           ← NEW (replaces the bounce)
```

The `/seller/c/<path>` rewrite is a verbatim prefix — the public path is
preserved inside it, which is what makes it line up exactly with
`pageToRoute()` in §3.4 and keeps ISR revalidation working. `/blog` is
matched *before* the catch-all so blog URLs never reach it.

The bounce-to-main doesn't disappear, it **moves into the catch-all route**,
which can actually check whether a seller page exists. `proxy.ts` can't — it
would need a DB call on every request.

The main-host branch is unchanged.

**Local dev:** `NEXT_PUBLIC_SELLER_URL` unset means `handleSellerHosts`
returns `null` immediately (proxy.ts:88), so nothing above fires and
`/seller/c/<path>` and `/seller/blog` remain directly reachable for testing.

### 5.2 New routes

| File | Purpose |
|---|---|
| `frontend/app/seller/c/[...path]/page.tsx` | **The one CMS catch-all.** `params.path` reconstructs the public path, so a single route handles all four page types: `page/<slug>` → prose, `<slug>` → dynamic, and any path matching a `staticRoute`. Mirrors the resolution order already in `app/[slug]/page.tsx` and `app/page/[slug]/page.tsx`, with `site=seller`. **If nothing matches, `permanentRedirect()` to the main origin** — preserving today's proxy behaviour for genuine storefront URLs typed against the seller host. |
| `frontend/app/seller/blog/page.tsx` | Seller blog index. Thin wrapper: fetch with `site=seller`, render the existing `components/pages/BlogIndexPage.tsx`. |
| `frontend/app/seller/blog/[...slug]/page.tsx` | Seller post detail — same category-chain validation as the main-site catch-all. |
| `frontend/app/seller/blog/category/[slug]/page.tsx` | Seller category archive. |
| `frontend/app/seller/sitemap.xml/route.ts` | Seller sitemap. |
| `frontend/app/seller/robots.txt/route.ts` | Seller robots, pointing at the seller sitemap. |

The renderer components (`BlogIndexPage`, `BlogDetailPage`, `ProsePage`,
`DynamicPage`) are **reused as-is**, taking a new optional `site` prop that
defaults to `'main'`. No duplication of presentation code.

### 5.3 Fetch layer

- `frontend/lib/site.ts` — `siteFromHost(host)`, `originForSite(site)`.
- `frontend/lib/pageResolver.ts` — `resolvePage()` takes a `site` argument
  and appends `&site=`.
- `frontend/lib/staticMeta.ts` — same.
- `frontend/lib/api.ts` (axios, client components) — the `site` must come
  from the browser's own hostname, not an env var, since one bundle serves
  both hosts. Add an interceptor setting `X-Site` from
  `siteFromHost(window.location.host)`.
- Server components: pass `site` explicitly in the `fetch` URL. They know
  which site they are because the route file itself is site-specific.

### 5.4 Canonicals, OG and links

- `frontend/lib/siteUrl.ts` exports a single build-time `SITE_URL`. Add
  `siteUrlFor(site)` that returns `NEXT_PUBLIC_SELLER_URL` for `'seller'`.
  Every `generateMetadata` in a `/seller/**` route uses it, otherwise
  seller pages will canonicalise to `throttlein.com` and Google will
  de-index them.
- `frontend/lib/blogUrl.ts` → `buildPostUrl(post, { absolute, site })`.
  Within a host, keep relative URLs; cross-host links must be absolute.
- **Cross-posting is not supported** — a post belongs to exactly one site.
  If a piece is needed on both, it's two records (and a canonical pointing
  at whichever is primary).

### 5.5 SEO checklist

- Seller pages canonical to `https://seller.throttlein.com/...`.
- `seller.throttlein.com/robots.txt` references
  `seller.throttlein.com/sitemap.xml` only.
- `frontend/app/sitemap.ts` (main) filters `site=main` — currently it pulls
  `${API_URL}/blog?limit=500` unfiltered (line ~140), which after Phase 1
  would otherwise list seller posts under main-site URLs. **This is a real
  regression risk if Phase 4 ships without it.**
- JSON-LD `@id`s built from `siteUrlFor(site)`.

---

## 6. Rollout

| Phase | Ships | Reversible? |
|---|---|---|
| 1. Data + migration | `site` field, compound indexes, backfill | Yes — field is additive, old indexes recreatable |
| 2. API | `resolveSite`, `requireSitePermission`, scoped queries, site-aware cache keys | Yes — all defaults resolve to `main` |
| 3. Admin | Switcher, per-site nav gating, staff grid | Yes |
| 4. Storefront | proxy rewrites, `/seller/p/**`, `/seller/blog/**`, sitemaps | Yes, but the proxy change is the highest-risk single edit |
| 5. Polish | Cross-site link audit, canonical audit, 404 behaviour | — |

Phases 1–3 are shippable with **zero visible change** to either live site:
the admin can create seller content, it just isn't reachable until Phase 4
lands. That's a useful safety property — content can be staged first.

### Verification per phase

1. Migration dry-run against a restored production dump; assert document
   counts match pre/post and no duplicate-key errors on `syncIndexes`.
2. The API checklist in §3.5.
3. Manual matrix: superadmin, staff with `pages` only, staff with
   `seller-blogs` only, staff with both — check sidebar contents, switcher
   visibility, and direct-URL access for each.
4. `curl -H 'Host: seller.throttlein.com'` against every new route plus a
   known-404 path (must 301 to the main origin, not render an empty page).

---

## 7. Open questions

1. **Blog authors — shared or per-site?** Planned as shared, which is why
   §3.3 carves the 5 author routes out of the site-scoped umbrella guard. If
   the seller site wants a distinct byline roster instead, it's the same
   one-line schema change plus a scoped query *and* the umbrella guard gets
   simpler — say so before Phase 1 and it costs nothing either way.
2. **Homepage furniture** (`HomeBanner`, `PromoBlock`, `HomeSeoBlock`,
   `FaqSection`, `SellerCta`) is unscoped in v1 — the seller landing page stays the
   hard-coded `app/seller/page.tsx`. Scoping these is a natural Phase 6 if
   you want the seller homepage editable too.
3. **A third site later?** The design is `site: enum` rather than boolean
   precisely so adding `'partners'` is a constant change plus a proxy branch,
   not a refactor. Worth confirming that's the intent.
4. **Media library** (`media` permission) is unscoped and has no backend
   `requirePermission` call sites today — uploads land in one shared bucket.
   Fine for v1; noting it because it's an existing gap the audit surfaced,
   not something this change introduces.

---

## 8. Deploy runbook

**The migration is not optional and not automatic.** Mongoose applies
`default: 'main'` on *write*, never on read — so a query for
`{ site: 'main' }` does **not** match documents saved before this
change, where the field is simply absent. Deploy the new code without
running the migration and every existing page, post, category, tag and
redirect vanishes from both the storefront and the admin panel. They
aren't lost, just unmatched, and the migration brings them straight
back — but it will look like data loss.

Order:

```bash
# 1. Deploy the BACKEND carrying the new schemas.
#    Safe on its own: `site` defaults to 'main' and every read defaults
#    to 'main', so nothing changes behaviour yet.

# 2. Inspect first — reports, writes nothing:
cd backend && npm run migrate:site -- --dry

# 3. Apply. Backfills `site`, drops the legacy single-field unique
#    indexes, rebuilds them as compound {site, slug}:
npm run migrate:site

# 4. Deploy admin + frontend.
```

The script is idempotent and re-runnable. It refuses to touch indexes if
it finds duplicate `(site, slug)` pairs, naming the offending document
ids so they can be resolved first.

### Environment

| Var | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SELLER_URL` | frontend build | Seller origin. Unset ⇒ multi-host routing is disabled entirely and `/seller/**` paths stay directly reachable — which is what makes local dev work unchanged. |
| `SELLER_ORIGIN` | backend | CORS allow-list + the `Origin` sniff fallback in `resolveSite`. |

### Post-deploy smoke test

```bash
# Two pages with the same slug, one per property — both must resolve.
curl -s "$API/pages/about?site=main"   | head -c 200
curl -s "$API/pages/about?site=seller" | head -c 200

# Seller host serves its own content, not a bounce to main.
curl -sI -H 'Host: seller.throttlein.com' https://<deploy>/about
curl -sI -H 'Host: seller.throttlein.com' https://<deploy>/blog

# An unknown path on the seller host still 301s to the main origin.
curl -sI -H 'Host: seller.throttlein.com' https://<deploy>/helmets

# Drafts are no longer world-readable.
curl -s "$API/pages?all=1&site=seller"   # expect 401
```

Then, in the admin panel: sign in as superadmin, confirm the switcher
appears above the nav, create a page on each property, and check each
appears on its own domain and not the other.
