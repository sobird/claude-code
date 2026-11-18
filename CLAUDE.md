# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `bun run dev` — run the CLI from TypeScript source with dev defines
- `bun run debug` — same, with a debugger (`--inspect-brk`); `bun run debug:dist` for the built bundle
- `bun run build` — bundle to `dist/cli.js` (one minified file); `bun run build:ant` builds the internal variant
- `bun run typecheck` — `tsc --noEmit` (strict mode); CLI only — `packages/rcs` is excluded, use `bun run rcs:typecheck`
- `bun run lint` / `bun run lint:fix` — oxlint (type-aware via oxlint-tsgolint); excludes `packages/rcs` (`lint:all` lints everything)
- `bun run fmt` / `bun run fmt:check` — oxfmt (whole repo, including `packages/rcs`)
- `bun test` — tests; excludes `packages/rcs` (`test:all` runs everything); single file: `bun test <path>`; single test: `bun test -t "<name>"`
- `bun run setup` — `bun install --ignore-scripts` (use if native postinstall steps fail)
- RCS (`packages/rcs`) has its own gates, run from the repo root: `bun run rcs:typecheck`, `rcs:lint`, `rcs:test`, `rcs:build`, `rcs:dev`

Before declaring a task done, these must pass: `bun run typecheck`, `bun run fmt:check`, `bun run lint`, `bun test`. (See "Known state" — `typecheck` and `lint` have pre-existing `src/` backlogs.) For `packages/rcs` work, use the `rcs:*` gates instead — see `packages/rcs/CLAUDE.md`.

## Orientation

- The CLI entry point is `src/entrypoints/cli.tsx`, **not** `src/index.ts` (that is a leftover stub). The largest core files are `src/main.tsx` and `src/query.ts`.
- `src/` is the hand-written source of truth — edit it directly. `scripts/generate-source-code.ts` can reconstruct `src/` from `cli.js.map`, but do not run it unless asked.
- `dist/` is generated and gitignored — never hand-edit it.
- `packages/rcs` is the self-hosted remote-control server (Next.js UI + Bun gateway). It has its own commands, env, and CI — read `packages/rcs/CLAUDE.md` before touching it.

## Conventions

- Formatting (enforced by oxfmt): no semicolons, single quotes, 2-space indent, 120-char line width.
- Relative imports use the `.js` extension (e.g. `import { x } from './foo.js'`), which maps to the `.ts`/`.tsx` source.
- Feature flags must appear inline and literally as `feature('NAME')`. Wrapping or computing the flag string defeats tree-shaking and leaks internal-only code into external builds.
- The build has external and internal (`ant`) variants. External/internal `define`s live in `scripts/config.ts`; the `MACRO.*` values used by direct `bun run` come from `bunfig.toml`. Keep both in sync when changing macros.
- Use conventional-commit messages (enforced by commitlint via the `commit-msg` hook). Commit directly to `main`.

## Known state

- `bun run typecheck` reports a pre-existing backlog of errors in `src/`. `packages/rcs` is excluded and typechecks clean on its own. When it fails, check whether the errors are in files you changed (`git diff --name-only`) before treating them as yours; don't fix unrelated pre-existing errors.
- `bun run lint` likewise carries a pre-existing `src/` backlog (warnings plus a handful of type-aware errors). Same rule: only fix files you changed.
- Tests are sparse — `bun test` covers little of the CLI. `packages/rcs` has a real suite via `bun run rcs:test` (PGlite, no database needed).
- Husky `pre-commit` runs `lint-staged` (oxfmt, then `oxlint --fix`) on staged files.
