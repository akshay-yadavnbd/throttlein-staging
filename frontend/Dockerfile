# syntax=docker/dockerfile:1.7
#
# Multi-stage Dockerfile for the THROTTLEIN storefront (Next.js 16).
#
# Build:  docker build \
#           --build-arg NEXT_PUBLIC_API_URL=... \
#           --build-arg NEXT_PUBLIC_SITE_URL=https://throttlein.com \
#           -t throttlein-frontend .
# Run:    docker run -p 3000:3000 throttlein-frontend
#
# Uses Next.js's `output: 'standalone'` mode (set in next.config.js) so
# the final image only ships the trimmed server + minimal node_modules
# — ~150 MB instead of ~800 MB.

# ─────────────── Stage 1: deps ───────────────
# Using Debian-slim instead of alpine — Tailwind v4 pulls in lightningcss
# which has known native-binary issues on Alpine's musl libc. Debian
# (glibc) has rock-solid binary coverage across @next/swc, lightningcss,
# and the rest of the JS native-deps ecosystem. ~50 MB heavier than
# alpine, worth it to not fight platform binaries on every npm bump.
#
# NODE VERSION — keep all three stages in step, and do not drop below 22.
# `isomorphic-dompurify@4` (used by components/common/RichTextView) pulls
# jsdom@30, and both declare:
#     "node": "^22.22.2 || ^24.15.0 || >=26.0.0"
# On Node 20 `npm ci` only WARNS (EBADENGINE) and the build compiles
# fine — it then dies much later during static prerender with
#     TypeError: webidl.util.markAsUncloneable is not a function
# because that internal was added in Node 22. The failure surfaces as a
# prerender error on /products, nowhere near its real cause, so the
# version floor is recorded here rather than left to be rediscovered.
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# Native platform packages are included in the committed lockfile.
RUN npm ci --no-audit --no-fund

# ─────────────── Stage 2: build ──────────────
FROM node:22-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* are inlined into the client JS at build time, so they
# have to be present BEFORE `next build` runs. GitHub Actions passes
# them via --build-arg from repo secrets.
#
# NEXT_PUBLIC_SITE_URL is the absolute origin used in canonical tags,
# sitemap entries, OG image URLs, and JSON-LD `@id`s. Missing it means
# the build's localhost fallback gets baked into the static HTML and
# leaks to Googlebot — always pass it for production builds.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_UPLOADS_URL
ARG NEXT_PUBLIC_APP_NAME
# Origin of the AI assistant service (chatbot/); empty hides the widget.
ARG NEXT_PUBLIC_CHATBOT_URL
ARG NEXT_PUBLIC_SITE_URL
# Seller subdomain origin (e.g. https://seller.throttlein.com) — drives
# the host-based routing in proxy.ts and subdomain-aware links/sitemap.
ARG NEXT_PUBLIC_SELLER_URL
# Analytics — optional. Leave the build-arg empty in non-prod
# environments to keep dev/staging out of the prod analytics
# property.
ARG NEXT_PUBLIC_GTM_ID
ARG NEXT_PUBLIC_GA_ID
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_UPLOADS_URL=$NEXT_PUBLIC_UPLOADS_URL \
    NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME \
    NEXT_PUBLIC_CHATBOT_URL=$NEXT_PUBLIC_CHATBOT_URL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_SELLER_URL=$NEXT_PUBLIC_SELLER_URL \
    NEXT_PUBLIC_GTM_ID=$NEXT_PUBLIC_GTM_ID \
    NEXT_PUBLIC_GA_ID=$NEXT_PUBLIC_GA_ID \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ─────────── Previous build's static files ───────────
# The deploy workflow replaces this stage with the /app/.next/static of
# the image currently deployed (build-contexts: previous_static=…), so a
# tab opened before the deploy can still load the JS chunks it knows
# about. A plain local `docker build` has no previous image: this
# default is the new build itself, which makes the carry-over a no-op.
FROM builder AS previous_static

# ─────────────── Stage 3: runner ─────────────
# Same base as the builder. Mixing musl/alpine for runtime + glibc/slim
# for build would mean the @next/swc-linux-x64-gnu binary copied from
# the builder wouldn't load in an alpine runner.
FROM node:22-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Debian-style user creation (Alpine's `addgroup -S / adduser -S`
# doesn't exist here). Pin the UID/GID to 1001 to match the file
# ownership we set on COPY below.
RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs --no-create-home nextjs

# `output: 'standalone'` emits a self-contained server.js + the
# minimal node_modules needed to run it. `public/` and `.next/static`
# aren't bundled into standalone — they have to be copied separately.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Old build's files first, then this build's on top. Names are content
# hashes, so a clash is the same file; nothing current is lost.
COPY --from=previous_static --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
