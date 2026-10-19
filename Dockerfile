# Binance Predict Bot — API server + Python engine + dashboard in one container.

# ── Build: install all deps, build the dashboard and the API server ─────────
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN PORT=1 BASE_PATH=/ NODE_ENV=production pnpm --filter @workspace/trading-bot run build \
 && pnpm --filter @workspace/api-server run build

# ── Production node_modules for the API server only ──────────────────────────
FROM node:22-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY artifacts/api-server/package.json artifacts/api-server/
RUN pnpm install --frozen-lockfile --prod --filter @workspace/api-server

# ── Runtime: Python (bot engine) + Node (API/dashboard) ──────────────────────
FROM python:3.12-slim
WORKDIR /app
COPY --from=node:22-slim /usr/local/bin/node /usr/local/bin/node
RUN pip install --no-cache-dir numpy==2.1.3

COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/artifacts/api-server/node_modules artifacts/api-server/node_modules
COPY --from=build /app/artifacts/api-server/dist artifacts/api-server/dist
COPY artifacts/api-server/src/bot/*.py artifacts/api-server/src/bot/
COPY --from=build /app/artifacts/trading-bot/dist/public artifacts/trading-bot/dist/public

ENV NODE_ENV=production \
    PORT=8888 \
    BOT_DATA_DIR=/app/data \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
RUN mkdir -p /app/data
VOLUME /app/data
EXPOSE 8888

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:8888/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
