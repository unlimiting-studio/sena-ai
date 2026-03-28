# ============================================================
# sena-ai platform server Dockerfile
# Multi-stage build: base -> deps -> build -> production
# ============================================================

# -- Stage 1: Base --
FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.6.5 --activate
WORKDIR /app

# -- Stage 2: Dependencies --
FROM base AS deps

# Copy monorepo root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./

# Copy package.json files for all workspace packages
COPY apps/platform-server/package.json apps/platform-server/package.json
COPY packages/platform/package.json packages/platform/package.json

# Install dependencies
RUN pnpm install --frozen-lockfile

# -- Stage 3: Build --
FROM deps AS build

# Copy source
COPY apps/platform-server/ apps/platform-server/
COPY packages/platform/ packages/platform/

# Build packages in order
RUN pnpm --filter @sena-ai/platform build && \
    pnpm --filter @sena-ai/platform-server build

# -- Stage 4: Production --
FROM node:22-alpine AS production

RUN corepack enable && corepack prepare pnpm@10.6.5 --activate

WORKDIR /app

# Copy monorepo root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/platform-server/package.json apps/platform-server/package.json
COPY packages/platform/package.json packages/platform/package.json

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy build artifacts
COPY --from=build /app/packages/platform/dist packages/platform/dist
COPY --from=build /app/apps/platform-server/dist apps/platform-server/dist
COPY --from=build /app/apps/platform-server/drizzle apps/platform-server/drizzle

# Copy bootstrap script
COPY scripts/ scripts/

# Upload volume
RUN mkdir -p /app/data/uploads
VOLUME ["/app/data/uploads"]

# Environment variables
ENV NODE_ENV=production
ENV PORT=3200

EXPOSE 3200

# Run server
WORKDIR /app/apps/platform-server
CMD ["node", "dist/index.js"]
