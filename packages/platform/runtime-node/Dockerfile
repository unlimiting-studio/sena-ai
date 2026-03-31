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
COPY packages/platform/runtime-node/package.json packages/platform/runtime-node/package.json
COPY packages/platform/core/package.json packages/platform/core/package.json

# Install dependencies
RUN pnpm install --frozen-lockfile

# -- Stage 3: Build --
FROM deps AS build

# Copy source
COPY packages/platform/runtime-node/ packages/platform/runtime-node/
COPY packages/platform/core/ packages/platform/core/

# Build packages in order
RUN pnpm --filter @sena-ai/platform-core build && \
    pnpm --filter @sena-ai/platform-node build

# -- Stage 4: Production --
FROM node:22-alpine AS production

RUN corepack enable && corepack prepare pnpm@10.6.5 --activate

WORKDIR /app

# Copy monorepo root files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/platform/runtime-node/package.json packages/platform/runtime-node/package.json
COPY packages/platform/core/package.json packages/platform/core/package.json

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy build artifacts
COPY --from=build /app/packages/platform/core/dist packages/platform/core/dist
COPY --from=build /app/packages/platform/runtime-node/dist packages/platform/runtime-node/dist
COPY --from=build /app/packages/platform/runtime-node/drizzle packages/platform/runtime-node/drizzle

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
WORKDIR /app/packages/platform/runtime-node
CMD ["node", "dist/index.js"]
