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
- `bun run test:e2e` — only the process-level E2E suites in `tests/e2e` (spawns the real CLI against a fake model endpoint; ~1 min)
- `bun run setup` — `bun install --ignore-scripts` (use if native postinstall steps fail)
- RCS (`packages/rcs`) has its own gates, run from the repo root: `bun run rcs:typecheck`, `rcs:lint`, `rcs:test`, `rcs:build`, `rcs:dev`

Before declaring a task done, these must pass: `bun run typecheck`, `bun run fmt:check`, `bun run lint`, `bun test`. For `packages/rcs` work, use the `rcs:*` gates instead — see `packages/rcs/CLAUDE.md`.

## Orientation

- The CLI entry point is `src/entrypoints/cli.tsx`, **not** `src/index.ts` (that is a leftover stub). The largest core files are `src/main.tsx` and `src/query.ts`.
- `src/` is the hand-written source of truth — edit it directly. `scripts/generate-source-code.ts` can reconstruct `src/` from `cli.js.map`, but do not run it unless asked.
- `dist/` is generated and gitignored — never hand-edit it.
- `packages/rcs` is the self-hosted remote-control server (Next.js UI + Bun gateway). It has its own commands, env, and CI — read `packages/rcs/CLAUDE.md` before touching it.
- `docs/` holds the reference material: `feature-flags.md`, `environment-variables.md`, `bridge.md`, and per-feature notes under `docs/features/`. The repo tracks a specific upstream release; bumping it goes through the `scripts/upgrade/cli.ts` pipeline (`carve → inventory → align → extract → probe → verify`) with artifacts under `docs/upgrade/<version>/`.

## Conventions

- Formatting (enforced by oxfmt): no semicolons, single quotes, 2-space indent, 120-char line width.
- Relative imports use the `.js` extension (e.g. `import { x } from './foo.js'`), which maps to the `.ts`/`.tsx` source.
- Feature flags must appear inline and literally as `feature('NAME')`. Wrapping or computing the flag string defeats tree-shaking and leaks internal-only code into external builds.
- The build has external and internal (`ant`) variants. External/internal `define`s live in `scripts/config.ts`; the `MACRO.*` values used by direct `bun run` come from `bunfig.toml`. Keep both in sync when changing macros.
- Use conventional-commit messages (enforced by commitlint via the `commit-msg` hook). Commit directly to `main`.

## Tests

- Unit tests are colocated: `src/**/__tests__/*.test.ts`. Cross-module integration and Ink render contracts sit directly under `tests/` (e.g. `provider-adapters.test.ts`, `static-render.test.tsx`).
- `tests/e2e/` is the process-level layer: each test spawns `src/entrypoints/cli.tsx` under Bun against a scripted stand-in for the Anthropic Messages API (`fake-anthropic.ts`), using the shared isolation harness (`harness.ts`).
- E2E isolation invariants (in `harness.ts` — preserve them): fresh `HOME`/`CLAUDE_CONFIG_DIR`/cwd per run; `NODE_ENV` stripped from the child env (under `bun test` it enables VCR fixture replay and suppresses transcript persistence); the temp root realpath'd (macOS `/var` symlink vs `$PWD` mismatch breaks session lookup). The interactive PTY suite is skipped on Windows (no `script`).
- `bun run test:e2e` runs only this layer; `bun test` runs everything.

## Known state

- `typecheck` and `lint` are expected to pass cleanly; if they fail, suspect your own changes first (the historical `src/` backlogs were cleared).
- Patch `tests/bg-sessions.test.ts`, when run in the full suite, can leave a non-zero process exit code even with all assertions passing; run it in isolation when investigating exit codes.
- Husky `pre-commit` runs `lint-staged` (oxfmt, then `oxlint --fix`) on staged files.
