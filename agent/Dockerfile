FROM node:22 AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable

WORKDIR /app

FROM base AS build-base
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

FROM build-base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm build
RUN pnpm prune --prod

FROM base AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    jq \
    openssh-client \
    procps \
    ripgrep \
    unzip \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV PORT=22481
ENV NODE_OPTIONS="--trace-uncaught --unhandled-rejections=strict"

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/sena.yaml ./sena.yaml

RUN mkdir -p /tmp/sena-workspaces \
  && chown -R node:node /tmp/sena-workspaces

EXPOSE 22481

USER node

CMD ["node", "dist/index.js"]
