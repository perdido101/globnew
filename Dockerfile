# Full live app: API + ingestion workers + built web UI on one port. Needs DATABASE_URL (Postgres 14+).
FROM node:22-slim
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .
# Build the web app (served by the server) and bake in the GeoNames gazetteer.
RUN pnpm --filter @gw/web build && pnpm --filter @gw/server geo:download

ENV NODE_ENV=production PORT=8787
EXPOSE 8787
CMD ["pnpm", "--filter", "@gw/server", "start"]
