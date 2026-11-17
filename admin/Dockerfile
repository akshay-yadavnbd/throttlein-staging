# syntax=docker/dockerfile:1.7
#
# Multi-stage Dockerfile for the THROTTLEIN admin panel (Next.js 16).
#
# Build:  docker build --build-arg NEXT_PUBLIC_API_URL=... -t throttlein-admin .
# Run:    docker run -p 3001:3000 throttlein-admin
#
# Uses Next.js's `output: 'standalone'` mode (set in next.config.js) so
# the final image only ships the trimmed server + minimal node_modules
# — ~150 MB instead of ~800 MB.

# ─────────────── Stage 1: deps ───────────────
# Resolved separately so the lockfile-only layer caches well across
# code edits (huge speedup on subsequent CI runs).
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# ─────────────── Stage 2: build ──────────────
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* are inlined into the client JS at build time, so they
# have to be present BEFORE `next build` runs. The GitHub Actions
# workflow passes them via --build-arg from repo secrets.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_UPLOADS_URL
ARG NEXT_PUBLIC_APP_NAME
# Origin of the AI assistant service (chatbot/); empty hides the widget.
ARG NEXT_PUBLIC_CHATBOT_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_UPLOADS_URL=$NEXT_PUBLIC_UPLOADS_URL \
    NEXT_PUBLIC_APP_NAME=$NEXT_PUBLIC_APP_NAME \
    NEXT_PUBLIC_CHATBOT_URL=$NEXT_PUBLIC_CHATBOT_URL \
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
# Slim image that only contains what `next start` needs in standalone
# mode. Runs as a non-root user for safety.
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

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
