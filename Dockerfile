# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Dependencies (shared by both targets)
# ---------------------------------------------------------------------------
FROM oven/bun:1.4 AS deps
WORKDIR /app

# Build tools for sharp when no prebuilt binary matches the platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock tsconfig.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY scripts ./scripts

RUN bun install --frozen-lockfile

# ---------------------------------------------------------------------------
# Web: Bun + Hono, serves the API and the built SPA
# ---------------------------------------------------------------------------
FROM deps AS build
RUN bun run --cwd apps/web build

FROM oven/bun:1.4 AS web
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY --from=deps /app/apps ./apps
COPY --from=deps /app/scripts ./scripts
COPY package.json bun.lock tsconfig.json tsconfig.base.json ./
COPY --from=build /app/apps/web/dist ./apps/web/dist

EXPOSE 3000
# Apply pending SQL migrations, then serve API and SPA from one process.
CMD ["sh", "-c", "bun run scripts/migrate.ts && cd apps/web && exec bun run src/server/index.ts"]

# ---------------------------------------------------------------------------
# Worker: Node 22 + ffmpeg, poppler, Chromium, yt-dlp
# ---------------------------------------------------------------------------
FROM node:22-slim AS worker
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    ffmpeg \
    poppler-utils \
    chromium \
    python3 \
    fonts-dejavu-core \
    fonts-liberation \
  && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
       -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    CHROMIUM_PATH=/usr/bin/chromium \
    WORKER_POLL_MS=2000

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY --from=deps /app/apps ./apps
COPY --from=deps /app/package.json /app/tsconfig.json /app/tsconfig.base.json /app/bun.lock ./

WORKDIR /app/apps/worker
CMD ["./node_modules/.bin/tsx", "src/index.ts"]
