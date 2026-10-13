---
name: verify
description: Run this project's required pre-completion checks (typecheck, format check, lint, tests) and fix failures caused by the current changes. Use before declaring a task done.
---

Run these checks in order and report the outcome of each:

1. `bun run typecheck`
2. `bun run fmt:check`
3. `bun run lint`
4. `bun test`

Then fix any failures caused by the current changes and re-run the affected check.

Notes:

- `bun run lint` has a large pre-existing backlog. If it fails, determine whether the failures are in files you changed (`git diff --name-only`) before treating them as yours — do not try to fix unrelated pre-existing errors.
- Formatting is handled by oxfmt; run `bun run fmt` to fix `fmt:check` failures rather than editing whitespace by hand.
