# CLAUDE.md — packages/rcs

Guidance for working inside `packages/rcs` (`@sobird/rcs`), the self-hosted
remote-control server: Next.js 16 App Router UI, Bun/Hono gateway, Drizzle with
Postgres, next-auth, serwist PWA.

## Commands

Run from the repository root (recommended — these never touch the CLI):

- `bun run rcs:dev` — Next dev on :3000 + gateway on :4000
- `bun run rcs:typecheck` — `tsc --noEmit` with `packages/rcs/tsconfig.json`
- `bun run rcs:lint` — oxlint over `src/` and `server/` (root config, per-file tsconfig)
- `bun run rcs:test` — `bun test` (PGlite; no Postgres required)
- `bun run rcs:build` — `next build` (standalone output)

From `packages/rcs`, the same scripts exist as `bun run dev|typecheck|test|build`,
plus `bun run smoke` (boots the gateway in-process). TypeScript and oxlint come
from the root install (hoisted); the package does not pin them.

## Dev setup

`bun run rcs:dev` needs Postgres 16 plus `DATABASE_URL`, `RCS_AUTH_SECRET` (any
hex string), and on first boot `ADMIN_USERNAME` / `ADMIN_PASSWORD`. Put them in
`packages/rcs/.env` — Bun loads it by cwd, and the repo-root `.env` belongs to
the CLI. `RCS_WEB_CORS_ORIGINS` is auto-seeded in dev. See `.env.example` for the
rest and `README.md` for the full environment table.

## Styling

- `src/components/ui/*` and the `streamdown` markdown renderer keep Tailwind.
- Business components (`shell/`, `chat/`, `settings/`, `admin/`) use co-located
  `Component.module.css`. Compose conditionals with `cx` from `src/lib/utils.ts`.
- Component files are PascalCase (`ChatView.tsx` + `ChatView.module.css`); plain
  `.ts` hooks and utilities stay kebab-case.
- Reference tokens as `var(--color-*)` / `var(--font-*)` from
  `src/app/globals.css`. Dark mode is a token swap, so modules normally need no
  `:global(.dark)`.
- Never mix a Tailwind utility and a module class for the same property: module
  CSS is unlayered and wins over `@layer utilities`.
- `chat/Markdown.tsx` is the one business file that stays on Tailwind.

## Boundaries

- This package has no build-time dependency on the CLI's `src/`; keep it that
  way. `@/*` maps to `packages/rcs/src/*` (tsconfig `paths`, plus the package
  root for `server/` and `scripts/`). Use `@/...` for any import that leaves
  the current directory; keep same-directory siblings as `./foo`.
- Root `typecheck` / `lint` / `test` exclude this package. Use the `rcs:*` gates;
  do not widen the root gates to "fix" them.
- Formatting is shared (root oxfmt): no semicolons, single quotes, 2-space indent,
  120 columns.
- Docker still builds from the repository root because this package is a Bun
  workspace member; `Dockerfile.dockerignore` patterns are root-relative.
- CI: the `rcs` job in `.github/workflows/ci.yml` (gates only). Releases use
  release-please manifest mode: `feat(rcs):`/`fix(rcs):` commits bump
  `packages/rcs` to its own `rcs-vX.Y.Z` tag/CHANGELOG and do not affect the
  CLI's version. A release pushes `ghcr.io/<owner>/rcs:<version>` and
  `:latest` (linux/amd64); rcs is not published to npm. The dsh plugin
  (`packages/dsh-rcs-plugin`) additionally releases to npm on its own
  `dsh-rcs-plugin-vX.Y.Z` tag.
- `next dev` writes a managed `AGENTS.md` here; it is gitignored.
