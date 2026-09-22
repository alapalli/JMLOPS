# ─────────────────────────────────────────────────────────────
# JML Ops · Worker · Dockerfile (production)
# Build from repo root: docker build -f apps/worker/Dockerfile -t jmlops-worker .
# ─────────────────────────────────────────────────────────────

FROM node:22-alpine AS base
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/worker/package.json ./apps/worker/
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
COPY packages/connectors/package.json ./packages/connectors/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @jml-ops/db generate
RUN pnpm --filter @jml-ops/db build
RUN cp -R node_modules/.pnpm/@prisma+client@*/node_modules/.prisma node_modules/.prisma
RUN pnpm --filter @jml-ops/shared build
RUN pnpm --filter @jml-ops/connectors build
RUN pnpm --filter @jml-ops/worker build

FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /repo

ENV NODE_ENV=production

COPY --from=build /repo/package.json /repo/pnpm-workspace.yaml /repo/pnpm-lock.yaml ./
COPY --from=build /repo/apps/worker/package.json ./apps/worker/
COPY --from=build /repo/apps/worker/dist ./apps/worker/dist
COPY --from=build /repo/packages/db/package.json ./packages/db/
COPY --from=build /repo/packages/db/dist ./packages/db/dist
COPY --from=build /repo/packages/db/prisma ./packages/db/prisma
COPY --from=build /repo/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /repo/packages/shared/package.json ./packages/shared/
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build /repo/packages/connectors/package.json ./packages/connectors/
COPY --from=build /repo/packages/connectors/dist ./packages/connectors/dist

RUN pnpm install --frozen-lockfile --prod

# pnpm resolves generated code beside @prisma/client in its virtual store.
# Populate that location from the client generated in the build stage.
RUN PRISMA_CLIENT_DIR="$(dirname "$(find node_modules/.pnpm -path '*/node_modules/@prisma/client/default.js' -print -quit)")/../../.prisma/client" \
    && test -n "$PRISMA_CLIENT_DIR" \
    && mkdir -p "$PRISMA_CLIENT_DIR" \
    && cp -R node_modules/.prisma/client/. "$PRISMA_CLIENT_DIR/"

CMD ["node", "apps/worker/dist/index.js"]
