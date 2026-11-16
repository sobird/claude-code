# syntax=docker/dockerfile:1
#
# One image serves both RCS processes:
#   - app:     Next.js standalone server (node, port 3000) — default CMD
#   - gateway: bundled Bun gateway (bun dist/gateway.js, port 4000) — compose override
#
# The build context is the repository root, not this directory: `@sobird/rcs` is a
# Bun workspace member, so `bun install --frozen-lockfile` needs the root
# `package.json`/`bun.lock` and every workspace manifest. See docker-compose.yml.

FROM oven/bun:1 AS builder

WORKDIR /repo

# Workspace-wide install (root lockfile). `.dockerignore` strips node_modules,
# .git, docs, prior build output, etc.
COPY . .
# `--ignore-scripts`: `modifiers-napi` declares `gypfile: true` (macOS-only FFI)
# and Bun would run node-gyp on every install, which needs Python+toolchain the
# builder image does not carry. No workspace package has a real install script
# and native dependencies ship prebuilt platform binaries, so this is safe.
RUN bun install --frozen-lockfile --ignore-scripts

WORKDIR /repo/packages/rcs

# Baked into client bundles at build time. Leave empty for same-origin
# (Caddy) deployments; set it only for split-host setups.
ARG NEXT_PUBLIC_RCS_API_URL=
ENV NEXT_PUBLIC_RCS_API_URL=${NEXT_PUBLIC_RCS_API_URL}

RUN bun run build
RUN bun run build:gateway
RUN bun run build:migrate

# `applyMigrations` resolves `join(dirname(import.meta.url), 'migrations')`, so the
# bundled gateway looks in `dist/migrations`. Keep the SQL + meta/ next to the bundle.
RUN mkdir -p dist/migrations && cp -R src/db/migrations/. dist/migrations/

FROM node:22-bookworm-slim AS runtime

# curl powers container healthchecks; libatomic1 is required by Bun's glibc build.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates libatomic1 \
    && rm -rf /var/lib/apt/lists/*

# Copy Bun from the builder so the gateway runs without a second base image.
COPY --from=builder /usr/local/bin/bun /usr/local/bin/bun

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

WORKDIR /app

# Next standalone output is traced from the repo root, so server.js lands at
# /app/packages/rcs/server.js. It chdirs to its own directory at start.
COPY --from=builder /repo/packages/rcs/.next/standalone/ ./
COPY --from=builder /repo/packages/rcs/.next/static/ ./packages/rcs/.next/static/
COPY --from=builder /repo/packages/rcs/public/ ./packages/rcs/public/

# Bundled gateway + migrations (`bun /app/dist/gateway.js` auto-migrates on boot).
# The builder already copied `src/db/migrations` into `dist/migrations`, so the
# whole `dist/` tree carries the SQL.
COPY --from=builder /repo/packages/rcs/dist/ ./dist/

EXPOSE 3000

# Default process is the Next UI; docker-compose.yml overrides the gateway service
# with `bun /app/dist/gateway.js`.
CMD ["node", "/app/packages/rcs/server.js"]
