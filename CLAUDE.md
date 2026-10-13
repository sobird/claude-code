# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `bun run dev` — run the CLI from TypeScript source with dev defines
- `bun run debug` — same, with a debugger (`--inspect-brk`); `bun run debug:dist` for the built bundle
- `bun run build` — bundle to `dist/cli.js` (one minified file); `bun run build:ant` builds the internal variant
- `bun run typecheck` — `tsc --noEmit` (strict mode)
- `bun run lint` / `bun run lint:fix` — oxlint (type-aware via oxlint-tsgolint)
- `bun run fmt` / `bun run fmt:check` — oxfmt
- `bun test` — tests; single file: `bun test <path>`; single test: `bun test -t "<name>"`
- `bun run setup` — `bun install --ignore-scripts` (use if native postinstall steps fail)

Before declaring a task done, these must pass: `bun run typecheck`, `bun run fmt:check`, `bun run lint`, `bun test`. (See "Known state" — `lint` has a pre-existing backlog.)

## Orientation

- The CLI entry point is `src/entrypoints/cli.tsx`, **not** `src/index.ts` (that is a leftover stub). The largest core files are `src/main.tsx` and `src/query.ts`.
- `src/` is the hand-written source of truth — edit it directly. `scripts/generate-source-code.ts` can reconstruct `src/` from `cli.js.map`, but do not run it unless asked.
- `dist/` is generated and gitignored — never hand-edit it.

## Conventions

- Formatting (enforced by oxfmt): no semicolons, single quotes, 2-space indent, 120-char line width.
- Relative imports use the `.js` extension (e.g. `import { x } from './foo.js'`), which maps to the `.ts`/`.tsx` source.
- Feature flags must appear inline and literally as `feature('NAME')`. Wrapping or computing the flag string defeats tree-shaking and leaks internal-only code into external builds.
- The build has external and internal (`ant`) variants. External/internal `define`s live in `scripts/config.ts`; the `MACRO.*` values used by direct `bun run` come from `bunfig.toml`. Keep both in sync when changing macros.
- Use conventional-commit messages (enforced by commitlint via the `commit-msg` hook). Commit directly to `main`.

## Known state

- `bun run lint` reports thousands of pre-existing errors across the repo. When it fails, check whether the failures are in files you changed (`git diff --name-only`) before treating them as yours; don't fix unrelated pre-existing errors.
- Tests are sparse — `bun test` covers little of the CLI.
- Husky `pre-commit` runs `lint-staged` (oxfmt, then `oxlint --fix`) on staged files.
