# syntax=docker/dockerfile:1.7
#
# THROTTLEIN Assistant (chatbot/). Built by .github/workflows/deploy.yml
# and run on the server through docker-compose.yml as the `assistant`
# service.
#
# Build:  docker build -t throttlein-assistant .
# Run:    docker run --network host --env-file /path/to/chatbot.env throttlein-assistant
#
# Runtime configuration is NOT baked in — compose passes the server's
# chatbot.env with env_file. The service has no database and no volumes.
# It listens on 127.0.0.1 only, so it runs on the host network like the
# API (Nginx proxies assistant.<domain> to it, and it reaches the API on
# loopback).

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: nothing in this tree needs a postinstall, and it
# keeps a compromised transitive dependency from running code at build.
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=5200

COPY --from=deps /app/node_modules ./node_modules
COPY . .

USER node
EXPOSE 5200
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5200)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
