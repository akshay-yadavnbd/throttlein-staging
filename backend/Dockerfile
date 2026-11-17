# syntax=docker/dockerfile:1.7
#
# THROTTLEIN API (Express + Mongoose). Built by .github/workflows/deploy.yml
# and run on the server through docker-compose.yml as the `api` service.
#
# Build:  docker build -t throttlein-api .
# Run:    docker run --network host --env-file /path/to/.env \
#           -v /path/to/uploads:/app/uploads \
#           -v /path/to/private-uploads:/app/private-uploads throttlein-api
#
# Runtime configuration (.env) is NOT baked in — compose mounts the
# server's .env with env_file. Uploads live on host volumes so they
# survive image upgrades.
#
# Debian-slim, not alpine: same reasoning as the web Dockerfiles —
# native deps (bcrypt fallbacks, sharp if ever added) have reliable
# glibc builds. Node 22 LTS matches the engines floor in package.json.

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: nothing in this tree needs a postinstall, and it
# keeps a compromised transitive dependency from running code at build.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# Compiles src/ (.js and .ts side by side) into dist/, which the runner
# starts. Needs the dev dependencies (typescript, @types/*); only dist/
# leaves this stage.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=5000

COPY --from=deps /app/node_modules ./node_modules
COPY . .
# src/ stays for the CLI seeds and scripts; the server runs dist/.
COPY --from=build /app/dist ./dist

# Tracked seed assets (uploads/helmet-type-*.png) are referenced by
# seeded DB records. At runtime /app/uploads is a host volume that hides
# the image's copy, so keep a pristine copy the entrypoint can restore
# from on first boot.
RUN cp -r uploads seed-uploads && chmod +x docker-entrypoint.sh

# compose sets `user:` to the host account that owns the upload dirs so
# files written through the volume keep the same ownership PM2 produced.
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
