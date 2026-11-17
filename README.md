# THROTTLEIN — Vendor Management System

A multi-vendor marketplace for **bike accessories**, modeled after Amazon / Flipkart.
The platform has three independent apps that talk to each other:

```
vendor-management/
├── backend/    # Node.js + Express + MongoDB (REST API on :5000)
├── admin/      # Next.js super-admin panel  (HeroUI + Tailwind on :3001)
└── frontend/   # Next.js storefront + vendor portal (HeroUI + Tailwind on :3000)
```

- **Super admin** (`info@noseberry.com`) — seeded automatically when the backend starts.
- **Vendors** — self-register on the frontend, then add their bike-accessory products.
- **Customers** — browse, search, filter, and view product details on the storefront.

## Brand

| Name      | Hex        | Role                                     |
| --------- | ---------- | ---------------------------------------- |
| Lime      | `#BDFF00`  | Primary accent — buttons, focus, hover   |
| Black     | `#141414`  | Dark surfaces, navbar, sidebar, text     |
| Cream     | `#EFF1EA`  | Light page background                    |
| White     | `#FFFFFF`  | Cards / inputs                           |

The HeroUI theme in both `admin/tailwind.config.mts` and `frontend/tailwind.config.mts`
maps **`color="primary"`** → `#BDFF00` with `#141414` text — so every HeroUI button,
chip, focus ring, etc. picks up the brand automatically.

> The `.mts` extension is deliberate. Tailwind v4 loads this config through
> Node, which can't infer a `.ts` file's module type unless `package.json`
> declares `"type"`, so it warns on every build. `.mts` is unambiguously
> ESM. Adding `"type": "module"` instead would break `next.config.js`,
> `postcss.config.js` and `lib/legacyRedirects.js`, which are CommonJS.

### Drop in your logo

Save your THROTTLEIN logo PNG to **both**:

```
admin/public/logo.png
frontend/public/logo.png
```

The `<Wordmark />` component renders that file in the navbar / sidebar and falls
back to a styled text wordmark if the image is missing.

---

## 1. Prerequisites

- Node.js 22.22.2+ (Node 22 LTS)
- npm
- MongoDB replica set or Atlas cluster (required for checkout and inventory transactions)

## 2. Configure environment

| Folder      | File         | Purpose                                          |
| ----------- | ------------ | ------------------------------------------------ |
| `backend/`  | `.env`       | MongoDB URI, JWT, super-admin seed, CORS origins |
| `admin/`    | `.env.local` | `NEXT_PUBLIC_API_URL` → backend                  |
| `frontend/` | `.env.local` | `NEXT_PUBLIC_API_URL` → backend                  |

Copy `backend/.env.example` to `backend/.env` and configure your own secrets. Use a random JWT secret of at least 32 characters and a unique bootstrap admin password of at least 12 characters. Never commit credentials. Configure the payment and shipment webhook secrets before enabling production traffic.

## 3. Install + run

Three terminals:

```bash
# Terminal 1 — Backend (port 5000)
cd backend && npm ci && npm run dev

# Terminal 2 — Admin panel (port 3001)
cd admin && npm ci && npm run dev

# Terminal 3 — Frontend (port 3000)
cd frontend && npm ci && npm run dev
```

Login as super admin at <http://localhost:3001> with
`info@noseberry.com / ChangeMe@123`.

Browse the storefront at <http://localhost:3000> and click **Sell on THROTTLEIN**
to create a vendor account.

---

## 4. How the three apps interconnect

```
┌──────────────────┐  HTTP /api/*  ┌──────────────────┐
│  admin (3001)    │ ────────────▶ │                  │
└──────────────────┘               │   backend (5000) │
                                   │   Express +      │
┌──────────────────┐               │   MongoDB        │
│ frontend (3000)  │ ────────────▶ │                  │
└──────────────────┘  HTTP /api/*  └──────────────────┘
```

CORS in `backend/.env` whitelists both origins.
JWT tokens are stored client-side: `admin_token` for the admin app,
`vendor_token` for the frontend.

---

## 5. API surface

| Method | Path                              | Auth          | Description                            |
| ------ | --------------------------------- | ------------- | -------------------------------------- |
| GET    | `/api/health`                     | —             | Health check                           |
| POST   | `/api/auth/register`              | —             | Vendor self-registration               |
| POST   | `/api/auth/login`                 | —             | Vendor + super admin login             |
| GET    | `/api/auth/me`                    | Bearer        | Current user                           |
| PUT    | `/api/auth/profile`               | Bearer        | Update own profile                     |
| POST   | `/api/auth/change-password`       | Bearer        | Change password                        |
| GET    | `/api/products`                   | —             | Public product listing (search/filter) |
| GET    | `/api/products/:id`               | —             | Public product detail                  |
| GET    | `/api/products/mine`              | vendor        | List my products                       |
| POST   | `/api/products`                   | vendor        | Create product (multipart, images)     |
| PUT    | `/api/products/:id`               | vendor/admin  | Update product                         |
| DELETE | `/api/products/:id`               | vendor/admin  | Delete product                         |
| GET    | `/api/vendors`                    | —             | Public vendor list                     |
| GET    | `/api/vendors/:id`                | —             | Vendor profile + their products        |
| GET    | `/api/admin/stats`                | superadmin    | Dashboard counts                       |
| GET    | `/api/admin/vendors`              | superadmin    | List/search vendors                    |
| PATCH  | `/api/admin/vendors/:id/status`   | superadmin    | Approve / suspend / pending            |
| DELETE | `/api/admin/vendors/:id`          | superadmin    | Remove vendor (+ their products)       |
| GET    | `/api/admin/products`             | superadmin    | All products with vendor info          |
| PATCH  | `/api/admin/products/:id/status`  | superadmin    | Activate/reject/feature product        |

---

## 6. Stack

- **Backend:** Node.js, Express 5, Mongoose 9, JWT, Multer, express-validator, Morgan.
- **Admin & Frontend:** Next.js 16 (App Router), TypeScript, **HeroUI** (`@heroui/react`),
  Tailwind CSS, Axios, react-hot-toast.

### HeroUI v2 → v3 migration (in progress)

Both apps run **HeroUI v2 and v3 side by side** while the dashboards are
redesigned one tab at a time, per HeroUI's
[incremental migration guide](https://heroui.com/docs/react/migration/incremental-migration):

| Import | Version |
|---|---|
| `@heroui/react` | v2.8.10 — every un-migrated page |
| `@heroui-v3/react` | v3.2.3, aliased in `package.json` |

Do not import both versions in the same file — TypeScript will conflict.
Migrate per file.

**Why `overrides` exists in both `package.json` files.** v3 needs
`@react-aria/i18n@^3.13.1`, `@react-aria/ssr@^3.10.1` and
`@react-aria/utils@^3.34.1` as peers. Ten of v2's sub-packages
(`@heroui/autocomplete`, `calendar`, `date-picker`, `slider`, `pagination`,
`system`, …) pin `@react-aria/i18n` to an **exact** `3.12.16`, so npm's
hoisted layout can't satisfy both and `npm i` fails with `ERESOLVE`.

The override bumps those three to the versions v3 requires. This is safe
rather than a workaround: every other package in the tree — all ~27
`@react-aria/*` packages — already requests them with **caret** ranges
(`^3.12.16`), which `3.13.1` satisfies. The only ranges being overridden
are HeroUI v2's own exact pins, which reflect its release process rather
than an incompatibility.

`--legacy-peer-deps` was rejected: it would run v3 against `3.12.16`,
below its declared peer floor.

Remove the `overrides` block once v2 is gone.

**Theme.** The nude palette lives in `admin/app/themes/nude.css` and
`frontend/app/themes/nude.css`, which must stay byte-identical — they're
duplicated because `deploy.yml` builds each app with `context: ./<app>`,
so a shared file outside the app directory isn't in the Docker context.
Run `npm run check:theme` (either app) to verify they haven't drifted.

Applied at `<html>` in admin (every page is an admin surface) but scoped to
`app/dashboard/layout.tsx` in frontend, which also serves the public
storefront.

## 7. Common tasks

```bash
# Re-seed the super admin without starting the server
cd backend && npm run seed

# Build for production
cd backend  && NODE_ENV=production npm start
cd admin    && npm run build && npm start
cd frontend && npm run build && npm start
```

---

Throttle in. Ride safe.

Security changes, verification results, and deployment requirements: [September 24 security audit](docs/audits/2026-09-24-security-hardening.md).


## GitHub deployment (production and staging)

Push to `production` (or run **Build & deploy** manually on that branch). The workflow
runs security/regression checks, builds a Docker image per changed app (API, admin,
storefront), pushes them to GHCR, and restarts only the changed containers on the
server through `docker-compose.yml`. The API runs as the `throttlein-api` container;
PM2 is no longer used.

The same workflow deploys the `staging` branch to a second stack on the same
server (`throttlein-staging-*` containers, `*.staging.throttlein.com`, ports
5100/3101/3100, its own database, Redis db and S3 bucket). The branch name is
the GitHub Environment name, and that environment's secrets and variables
override the repo-level ones. Setup, branch flow and operations:
[docs/STAGING.md](docs/STAGING.md).

**Only what changed is deployed.** A `changes` job diffs the push against the
previous commit on `production` and gates every later job:

| Paths touched | Checks run | Deployed |
| --- | --- | --- |
| `backend/**` | backend audit + tests | `throttlein-api` container |
| `admin/**` | admin audit + build | `throttlein-admin` container |
| `frontend/**` | storefront audit + build | `throttlein-storefront` container |
| `scripts/check-theme-sync.js` | both web apps | both web containers |
| `docker-compose.yml`, `.github/workflows/*.yml` | everything | everything |

Each service has its own image tag (`API_TAG`, `ADMIN_TAG`, `STOREFRONT_TAG`) and
only changed services are pulled and restarted (`docker compose up -d --no-deps
<service>`), so an unchanged container keeps running untouched. The API is
restarted first and must report `/api/health` with `revision` equal to the workflow
commit before the web containers restart. A push that touches none of these paths
(docs, spreadsheets) runs nothing.

Manual runs (**Run workflow**) ignore the diff and deploy every app by default.
Untick **backend / admin / frontend** to narrow it. Use a manual run to redeploy
after a failed push, or whenever the server state must be rebuilt from scratch.
Pull requests always run the full check set.

### API container

The image (`backend/Dockerfile`) holds code and production dependencies only.
Everything server-specific is mounted from `BACKEND_DIR` on the host:

| Host path | In container | Purpose |
| --- | --- | --- |
| `$BACKEND_DIR/.env` | `env_file` | all runtime config and secrets |
| `$BACKEND_DIR/uploads/` | `/app/uploads` | public disk uploads + seed PNGs |
| `$BACKEND_DIR/private-uploads/` | `/app/private-uploads` | KYC / return evidence |

The container uses the host network, so `127.0.0.1:5000` is served exactly where
PM2 served it and the existing `.env` keeps working (`REDIS_HOST=127.0.0.1`,
`TRUST_PROXY=127.0.0.1`, local MongoDB, Nginx upstream). It runs as the deploy
user's uid/gid so files written to the volumes keep their previous ownership.
`NODE_ENV`, `PORT` and `DEPLOY_COMMIT` are set by compose and override `.env`.

The first image deploy stops and removes the legacy PM2 process named by
`BACKEND_PM2_APP` so the container can bind port 5000. Nothing else on the server
changes. Node/PM2 on the host are no longer required after that.

### Server requirements and variables

`SERVER_USER` must own `BACKEND_DIR` and be in the `docker` group. The server
needs Docker Engine with the compose plugin. No new Actions variables are
required; override these under **Settings → Secrets and variables → Actions →
Variables** only for a different layout:

| Variable | Production default | Purpose |
| --- | --- | --- |
| `BACKEND_DIR` | `/var/www/api.throttlein.com` | host dir with `.env`, `uploads/`, `private-uploads/` (staging default `/var/www/api.staging.throttlein.com`) |
| `API_PORT` / `ADMIN_PORT` / `STOREFRONT_PORT` | `5000` / `3001` / `3000` | host ports; required on every non-production environment |
| `BACKEND_PM2_APP` | `throttlein-api` | legacy PM2 process to retire on first deploy (empty outside production) |
| `BACKEND_HEALTH_URL` | `http://127.0.0.1:<API_PORT>/api/health` | revision check after API restart |

Secrets are unchanged: `SERVER_HOST`, `SERVER_USER`, `SERVER_SSH_KEY`, optional
`SERVER_SSH_PORT`, `GHCR_TOKEN`, `REVALIDATE_SECRET` and the `NEXT_PUBLIC_*` values.

### Rollback

Every image is also tagged with its commit SHA. To roll the API back:

```bash
cd /tmp && OWNER=<github-owner-lowercase> BACKEND_DIR=/var/www/api.throttlein.com \
  BACKEND_UID=$(id -u) BACKEND_GID=$(id -g) API_TAG=<previous-sha> \
  docker compose -p throttlein -f docker-compose.yml up -d --no-deps api
```

(copy `docker-compose.yml` from the repo first — it is not kept on the server).
Or re-run the workflow manually on the previous known-good commit. For staging
use `-p throttlein-staging`, the `staging-<sha>` tag and the staging variables
listed in [docs/STAGING.md](docs/STAGING.md).

After changing a workflow, push the new commit and start a new deployment run.
Re-running an older failed run uses its original commit and workflow.
