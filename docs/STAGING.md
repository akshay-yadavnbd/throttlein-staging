# Staging environment

Staging is a second copy of the whole stack (API, admin, storefront, AI
assistant) on the
**same server** as production, behind its own subdomains, ports, database,
Redis db index and S3 folder. It deploys from the `staging` branch through
the same `deploy.yml` workflow that deploys production.

| | Production | Staging |
| --- | --- | --- |
| Branch | `production` | `staging` |
| Storefront | `https://throttlein.com` → 127.0.0.1:3000 | `https://staging.throttlein.com` → 127.0.0.1:3100 |
| Seller site | `https://seller.throttlein.com` | `https://seller.staging.throttlein.com` |
| Admin | `https://admin.throttlein.com` → 3001 | `https://admin.staging.throttlein.com` → 3101 |
| API | `https://api.throttlein.com` → 5000 | `https://api.staging.throttlein.com` → 5100 |
| AI assistant (`chatbot/`) | `https://assistant.throttlein.com` → 5200 | `https://assistant.staging.throttlein.com` → 5201 |
| Compose project / containers | `throttlein` / `throttlein-api` … | `throttlein-staging` / `throttlein-staging-api` … |
| `BACKEND_DIR` | `/var/www/api.throttlein.com` | `/var/www/api.staging.throttlein.com` |
| MongoDB | production db | `throttlein_staging` (own user, same instance) |
| Redis | `REDIS_DB=0` | `REDIS_DB=1` (same instance) |
| S3 | bucket root | same bucket, `staging/` folder (`S3_KEY_PREFIX=staging`) |
| GHCR tags | `<sha>`, `latest` | `staging-<sha>`, `staging` |
| GitHub Environment | `production` (repo-level secrets) | `staging` (overrides below) |

Staging shares the production bucket but lives in its own folder:
`S3_KEY_PREFIX=staging` makes the API read, write, list and delete only under
`staging/…` (see `backend/src/utils/s3KeyPrefix.js`). Keys stored in the
database stay bare (`products/…`), so no data differs between environments.
The orphan cleanup script and the S3 inspection scripts are scoped to the
same folder, so a staging run can never see production objects.

`NODE_ENV` stays `production` on staging (compose forces it) so staging
exercises the same security paths as production: masked error messages,
HSTS, required webhook secrets. Compose also sets `APP_ENV` to the deploy
target; only the Shiprocket mock-mode guards look at it, so staging may run
`SHIPROCKET_MOCK_MODE=true` (no wallet charges, no real couriers) while
production still refuses to start in mock mode. See
`backend/src/config/appEnv.js`.

## Branch flow

```
feature ──PR──▶ main ──merge──▶ staging ──fast-forward──▶ production
                                   │                          │
                              auto-deploys               auto-deploys
                              staging stack              production stack
```

1. Feature work goes to `main` through pull requests (the checks in
   `security.yml` run on every PR).
2. Merge `main` into `staging` and push. The push deploys the changed apps to
   the staging stack.
3. Test on `*.staging.throttlein.com`.
4. Promote: `git checkout production && git merge --ff-only staging && git push`.
   The push deploys the same commits to production.
5. Hotfixes branch from `production`, are merged there first, then merged back
   into `staging` and `main` so the branches do not drift.

Pushes that touch only docs or spreadsheets deploy nothing (same path filters
as production). The **first** deploy of the `staging` branch must be a manual
run (Actions → **Build & deploy** → *Run workflow* → branch `staging`),
because the path filter diffs against the previous commit of the branch and a
new branch has none.

## One-time server setup

Everything below runs on the production server as the deploy user
(`SERVER_USER`), except the Nginx/certbot steps which need `sudo`.

### 1. DNS

Add A records pointing at the server's public IP:

```
staging.throttlein.com
seller.staging.throttlein.com
admin.staging.throttlein.com
api.staging.throttlein.com
```

### 2. MongoDB

Local MongoDB (the production API connects to a local replica set):

```bash
mongosh --eval '
  use throttlein_staging;
  db.createUser({
    user: "throttlein_staging",
    pwd: passwordPrompt(),
    roles: [{ role: "readWrite", db: "throttlein_staging" }]
  })'
```

Seed it with a copy of production (optional, gives realistic data):

```bash
mongodump --uri="<production MONGO_URI>" --archive=/tmp/prod.archive
mongorestore --uri="mongodb://throttlein_staging:<pwd>@127.0.0.1:27017/throttlein_staging?authSource=throttlein_staging&replicaSet=<rs>" \
  --archive=/tmp/prod.archive --nsFrom='<prod-db>.*' --nsTo='throttlein_staging.*'
rm /tmp/prod.archive
```

Staging starts empty (this is what was done): the API seeds the super admin,
categories, brands, pages and FAQs on first boot from the staging `.env`;
`npm run seed:*` scripts cover the rest. Copying production data into staging
puts real customers, sellers and orders where staging actions (seller
approval, order status emails) would reach them, so it is not the default.

On MongoDB Atlas instead: create a `throttlein_staging` database user scoped
to that database on the same cluster and use its connection string.

### 3. S3

No new bucket. Staging uses the `throttlein` bucket under the `staging/`
folder with the same IAM credentials. One thing to check: if the bucket policy
grants public `s3:GetObject` on specific prefixes (for example
`arn:aws:s3:::throttlein/products/*`), add the same entries with `staging/`
in front (`arn:aws:s3:::throttlein/staging/products/*`, and so on), otherwise
staging product images return 403. A policy that already covers the whole
bucket (`arn:aws:s3:::throttlein/*`) needs nothing.

### 4. Backend directory and `.env`

```bash
sudo mkdir -p /var/www/api.staging.throttlein.com/{uploads,private-uploads}
sudo chown -R "$USER:$USER" /var/www/api.staging.throttlein.com
cp /var/www/api.throttlein.com/.env /var/www/api.staging.throttlein.com/.env
chmod 600 /var/www/api.staging.throttlein.com/.env
```

Then edit `/var/www/api.staging.throttlein.com/.env`. Every other value stays
the same as production; change exactly these:

| Variable | Staging value |
| --- | --- |
| `MONGO_URI` | staging database connection string (step 2) |
| `REDIS_DB` | `1` |
| `ADMIN_ORIGIN` | `https://admin.staging.throttlein.com` |
| `FRONTEND_ORIGIN` | `https://staging.throttlein.com` |
| `SELLER_ORIGIN` | `https://seller.staging.throttlein.com` |
| `JWT_SECRET` | new random value (`openssl rand -hex 32`) |
| `REVALIDATE_SECRET` | new random value; the same value goes into the GitHub `staging` environment (step 6) |
| `SUPER_ADMIN_PASSWORD` | a staging-only password, 12+ characters (the seed refuses shorter ones; production's existing admin is unaffected) |
| `S3_KEY_PREFIX` | `staging` (bucket and `AWS_*` stay as in production) |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` | Razorpay **test** keys |
| `RAZORPAY_WEBHOOK_SECRET` | separate secret, pasted into a staging webhook in the Razorpay dashboard pointing at `https://api.staging.throttlein.com/…` |
| `PAYMENT_SOURCE_TAG` | `throttlein-staging` |
| `SHIPROCKET_MOCK_MODE` | `true` |
| `BACKEND_PUBLIC_URL` | `https://api.staging.throttlein.com` (mock label/tracking links) |
| `SHIPROCKET_WEBHOOK_TOKEN` | separate random value |
| `TEAMS_SELLER_WEBHOOK_URL` | a staging Teams channel URL, or empty to disable |
| `FROM` | a distinct sender, e.g. `THROTTLEIN Staging <noreply@throttlein.com>` |

`PORT`, `NODE_ENV` and `APP_ENV` are ignored: compose sets them (`PORT=5100`,
`APP_ENV=staging`).
`TRUST_PROXY=127.0.0.1` and `REDIS_HOST=127.0.0.1` stay as in production.

### 5. Nginx and TLS

Staging mirrors production: no extra gate in front of it. The one
difference is an `X-Robots-Tag: noindex` header on every staging host so
search engines never index staging as a duplicate of the live site.

`/etc/nginx/sites-available/staging.throttlein.com` (before certbot):

```nginx
server {
    listen 80;
    server_name staging.throttlein.com seller.staging.throttlein.com;
    add_header X-Robots-Tag "noindex, nofollow, noarchive" always;
    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}

server {
    listen 80;
    server_name admin.staging.throttlein.com;
    add_header X-Robots-Tag "noindex, nofollow, noarchive" always;
    location / {
        proxy_pass http://127.0.0.1:3101;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}

server {
    listen 80;
    server_name api.staging.throttlein.com;
    add_header X-Robots-Tag "noindex, nofollow, noarchive" always;
    client_max_body_size 60m;
    location / {
        proxy_pass http://127.0.0.1:5100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
```

```bash
ln -sf /etc/nginx/sites-available/staging.throttlein.com /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d staging.throttlein.com -d seller.staging.throttlein.com \
  -d admin.staging.throttlein.com -d api.staging.throttlein.com --redirect
```

certbot rewrites the blocks for TLS and adds the HTTP→HTTPS redirect. DNS
for the four names must point at the server directly (Cloudflare: DNS only)
before certbot runs.

### 6. GitHub `staging` environment

Settings → Environments → `staging`. Values are also settable with `gh`:

```bash
R=Noseberry-Private-Limited/throttlein
gh variable set API_PORT        --env staging --repo $R --body 5100
gh variable set ADMIN_PORT      --env staging --repo $R --body 3101
gh variable set STOREFRONT_PORT --env staging --repo $R --body 3100
gh variable set BACKEND_DIR     --env staging --repo $R --body /var/www/api.staging.throttlein.com
gh secret set NEXT_PUBLIC_API_URL     --env staging --repo $R --body https://api.staging.throttlein.com/api
gh secret set NEXT_PUBLIC_UPLOADS_URL --env staging --repo $R --body https://api.staging.throttlein.com/uploads
gh secret set NEXT_PUBLIC_SITE_URL    --env staging --repo $R --body https://staging.throttlein.com
gh secret set NEXT_PUBLIC_SELLER_URL  --env staging --repo $R --body https://seller.staging.throttlein.com
gh secret set REVALIDATE_SECRET       --env staging --repo $R   # paste the value from the staging .env
```

Leave `NEXT_PUBLIC_GTM_ID` and `NEXT_PUBLIC_GA_ID` unset on staging so the
builds skip analytics. `SERVER_HOST`, `SERVER_USER`, `SERVER_SSH_KEY` and
`GHCR_TOKEN` are reused from the repo level (same server, same deploy user).

Environment secrets and variables override repo-level ones of the same name.
Production keeps reading the repo-level values, so nothing changes for it.

### 7. First deploy and verification

Actions → **Build & deploy** → *Run workflow* → branch `staging` (all three
apps ticked). Then:

```bash
curl -s https://api.staging.throttlein.com/api/health      # revision = deployed sha
docker ps --filter name=throttlein-staging                 # three healthy containers
```

- Log into `admin.staging.throttlein.com` with the staging super admin.
- Upload a product image and confirm it lands under `staging/products/` in the bucket, and that the storefront renders it.
- Place a Razorpay test-mode order and confirm the mocked Shiprocket shipment.
- Confirm production (`docker ps --filter name=throttlein-`) still shows its
  own three containers untouched.

### 8. AI assistant (`chatbot/`)

The assistant is its own container (`throttlein-staging-assistant`, host
network, 127.0.0.1:5201). It has no database: it calls Groq and the staging
API as the signed-in user. Until `chatbot.env` exists the deploy skips it
with a warning and the dashboards hide the widget (no
`NEXT_PUBLIC_CHATBOT_URL`).

DNS: an A record for `assistant.staging.throttlein.com` (Cloudflare: DNS only).

Config, `/var/www/api.staging.throttlein.com/chatbot.env` (mode 600, owned
by the deploy user). `PORT` and `NODE_ENV` are set by compose:

```bash
BACKEND_API_URL=http://127.0.0.1:5100/api
GROQ_API_KEY=<groq key>
GROQ_MODEL=qwen/qwen3.8-27b
CHATBOT_SECRET=<openssl rand -hex 32>
ALLOWED_ORIGINS=https://seller.staging.throttlein.com,https://staging.throttlein.com,https://admin.staging.throttlein.com
```

Nginx, appended to `/etc/nginx/sites-available/staging.throttlein.com`:

```nginx
server {
    listen 80;
    server_name assistant.staging.throttlein.com;
    add_header X-Robots-Tag "noindex, nofollow, noarchive" always;
    location / {
        proxy_pass http://127.0.0.1:5201;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # A chat turn can wait on up to two Groq rate-limit retries.
        proxy_read_timeout 120s;
    }
}
```

```bash
nginx -t && systemctl reload nginx
certbot --nginx -d assistant.staging.throttlein.com --redirect
```

GitHub `staging` environment:

```bash
gh variable set CHATBOT_PORT --env staging --repo $R --body 5201
gh secret set NEXT_PUBLIC_CHATBOT_URL --env staging --repo $R --body https://assistant.staging.throttlein.com
```

Then Actions → **Build & deploy** → *Run workflow* → branch `staging` with
admin, storefront and AI assistant ticked (the web images inline
`NEXT_PUBLIC_CHATBOT_URL` at build time). Check:

```bash
curl -s https://assistant.staging.throttlein.com/health
```

and that the assistant button appears on the seller dashboard and, for the
super admin, in the admin panel.

## Day-to-day operations

Rollback staging to a previous build:

```bash
cd /tmp && OWNER=<github-owner-lowercase> CONTAINER_PREFIX=throttlein-staging \
  BACKEND_DIR=/var/www/api.staging.throttlein.com API_PORT=5100 ADMIN_PORT=3101 STOREFRONT_PORT=3100 \
  BACKEND_UID=$(id -u) BACKEND_GID=$(id -g) API_TAG=staging-<previous-sha> \
  docker compose -p throttlein-staging -f docker-compose.yml up -d --no-deps api
```

Logs: `docker logs -f throttlein-staging-api` (or `-admin`, `-storefront`,
`-assistant`).

After editing the staging `.env`, redeploy the API (Actions → Build & deploy →
Run workflow → branch `staging`, only **backend** ticked). `docker restart`
keeps the environment the container was created with and does not re-read
the file.

Refresh the staging database from production: repeat the dump/restore in
step 2 with `--drop`.
