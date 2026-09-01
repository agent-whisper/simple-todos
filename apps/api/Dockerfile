# syntax=docker/dockerfile:1

# --- deps -------------------------------------------------------------------
# better-sqlite3 is a native module. Install it in the same base image the
# runtime uses so the prebuilt binding matches; never copy host node_modules
# (which is why .dockerignore excludes them).
FROM node:22-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci

# --- build ------------------------------------------------------------------
FROM deps AS build
WORKDIR /repo
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api
RUN npm run build -w @simple-todos/shared \
 && npm run build -w @simple-todos/api

# --- prod deps --------------------------------------------------------------
# A second install with --omit=dev rather than pruning in place, so the native
# binding is built against the same base and nothing dev-only leaks in.
FROM node:22-slim AS prod-deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev

# --- runtime ----------------------------------------------------------------
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /repo

COPY --from=prod-deps /repo/node_modules ./node_modules
# better-sqlite3 does not hoist. The api workspace pins ^11 while drizzle-kit
# pulls v13 transitively, so npm nests the pinned copy under the workspace.
# Node resolves from the IMPORTING file's directory, and drizzle-orm is hoisted
# to the root — so it searches /repo/node_modules and /repo, never the
# workspace's own folder, and the container dies at boot with
# ERR_MODULE_NOT_FOUND. Placing the one real copy at the root fixes both
# importers. (Regenerating the lockfile to force a single hoisted version was
# tried and rejected: `npm install` produces a lock that `npm ci` refuses, an
# esbuild inconsistency that reproduces with or without the change.)
COPY --from=prod-deps /repo/apps/api/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY package.json ./
COPY packages/shared/package.json ./packages/shared/
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY apps/api/package.json ./apps/api/
COPY --from=build /repo/apps/api/dist ./apps/api/dist
# Migrations are committed SQL, applied on boot before the server listens.
COPY apps/api/drizzle ./apps/api/drizzle

ENV DATA_DIR=/data
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]
USER node

EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]
