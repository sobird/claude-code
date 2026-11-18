# RCS UI Primitives: Base UI 1.9 + CSS Modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch `packages/rcs` from `@base-ui-components/react@1.0.0-rc.0` to `@base-ui/react@1.9.0`, then migrate the remaining first-party Tailwind (`src/components/ui/*`) to co-located CSS Modules, leaving Tailwind only as streamdown's styling engine — with pixel-level parity.

**Architecture:** Task 0 is a standalone mechanical dependency rename (so later visual regressions are attributable to CSS, not the library). Tasks 1–4 port the 14 `ui/` primitives family-by-family into `*.module.css` files whose rules are wrapped in `@layer components` (business module CSS stays unlayered, preserving today's override precedence). Task 5 drops `cn`/`tailwind-merge` and runs the full parity matrix. Six conventional commits on `main`, one per task.

**Tech Stack:** Next.js 16 / React 19, Base UI 1.9.0, Tailwind v4 (kept for streamdown only), CSS Modules + `cx` (`clsx`), Bun workspace, `bun run rcs:*` gates, Playwright MCP for visual checks.

**Spec:** `docs/superpowers/specs/2026-11-19-rcs-ui-css-modules-design.md` — read it with this plan; its translation rules and file inventory are binding.

## Global Constraints

- Pin `@base-ui/react` exactly at `1.9.0` (`bun add --exact`); never a range. Subpath imports: `@base-ui/react/{menu,dialog,select,tooltip,scroll-area,separator,use-render}`.
- Every new `ui/*.module.css` wraps its rules in `@layer components { … }`; `@keyframes` stay outside the layer block. Business module CSS stays unlayered.
- Tokens only: `var(--color-*)`, `var(--font-*)`, `var(--radius)`. Alpha shades use `color-mix(in oklab, var(--color-X) NN%, transparent)`.
- Dark overrides: `:global(.dark) .class` — only where the Tailwind version had `dark:` utilities.
- `ui/` must contain **zero Tailwind class literals** when this plan completes. `chat/markdown.tsx` is the sole remaining first-party Tailwind file; never edit it or `streamdown`.
- Keep every `data-slot` attribute (module selectors depend on them).
- Write explicit border width/style/color wherever the Tailwind utility implied one; never rely on preflight (it may stay loaded for streamdown, but parity must not depend on it).
- Do not touch business components, `src/app/globals.css` token values, or `globals.css` at all unless Task 0 Step 2 says to.
- Conventional commits, commit directly to `main`; body lines ≤ 100 chars (commitlint).
- Gates after every task, from the repo root: `bun run rcs:typecheck && bun run rcs:lint && bun run rcs:test && bun run rcs:build && bun run fmt:check`.

### Verification harness (used by every task's check step)

Prereqs: Postgres 16 running and `packages/rcs/.env` populated (`DATABASE_URL`, `RCS_AUTH_SECRET`); local admin credentials known.

```bash
# repo root — the API URL is inlined at build time
NEXT_PUBLIC_RCS_API_URL=http://localhost:4000 bun run rcs:build
cd packages/rcs && bun run gateway          # :4000
cd packages/rcs && bunx next start -p 3000  # :3000
```

Drive the UI with Playwright MCP at 1280×900 and 390×844, light and dark (`localStorage.theme` + `document.documentElement` class, then reload). Save screenshots under `.playwright-mcp/ui-modules/<task>/`.

- The gateway's `/api/access-token` is rate-limited to 5 requests/minute: pace authed page loads ~10–15 s apart or expect a transient 429 error UI.
- Screenshots must be written under `/Users/sobird/claude-code/.playwright-mcp/` (the only allowed root).
- Computed-style spot checks: read values with `browser_evaluate`, e.g.
  `getComputedStyle(document.querySelector('[data-slot=button]')).boxShadow`.

## Review Focus

These input classes are not covered by the gates; check each deliberately in the task named.

- **Business override precedence** (Task 1 check, then every task): `styles.statusPill` / `styles.roleTrigger` (admin), `styles.roleBadge` (settings page), `styles.actionButton` (chat cards), `styles.menuContent` / `styles.drawer` (navbar) must still beat the primitive's own styles — this is what `@layer components` preserves.
- **Focus rings match** (Tasks 1, 3, 4): `:focus-visible` `box-shadow` on Button/Input/SelectTrigger/ScrollArea viewport equals the baseline JSON exactly, in light and dark, with the border color change together.
- **Dark tinted variants** (Task 1–3): destructive Button, destructive menu item, Input and SelectTrigger dark tints, and their business overrides must look identical to baseline on `/settings` and `/admin` (light + dark).
- **Select popup geometry** (Task 3): popup sits 4px below the trigger, `max-h` from `--available-height`, `List` scrolls, and the up/down arrows sit in flow (static) only in overflow.
- **Dialog + drawer parity** (Task 2): overlay color, centering, `sm:max-w-lg`, close-button icon size, and the mobile drawer's `styles.drawer` overrides (max-height, background) unchanged.

---

### Task 0: Baseline capture + package rename (Batch 0)

**Files:**

- Modify: `packages/rcs/package.json`, `bun.lock`
- Modify: `packages/rcs/src/components/ui/{badge,button,dialog,dropdown-menu,scroll-area,select,separator,tooltip}.tsx` (import specifiers only)

**Interfaces:**

- Consumes: current working tree (all green).
- Produces: `@base-ui/react@1.9.0` pinned; every `@base-ui-components/react/*` specifier gone. No API or component changes in this task.

- [ ] **Step 1: Record the pre-change commit**

```bash
git rev-parse HEAD > .playwright-mcp/baseline/commit.txt
```

Expected: the current HEAD hash is saved (used for A/B rebuilds).

- [ ] **Step 2: Capture the visual + computed-style baseline**

Boot the harness on this commit (see Verification harness). At 1280×900 and 390×844, light and dark, save screenshots of `/`, `/settings`, `/admin`, and one stored session to `.playwright-mcp/baseline/`. Then capture `computed.json` via `browser_evaluate` with, at minimum, for each of these selectors and both themes:

| Selector                                                                                              | Properties                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[data-slot=button]` (default)                                                                        | `background-color`, `color`, `height`, `border-radius`; then focus the first button via `Tab` (keyboard, so `:focus-visible` applies) and capture `box-shadow` + `border-color` |
| destructive button (API-key revoke confirm dialog on `/settings`, plus the admin disable-user dialog) | base `background-color`/`color`; then `browser_hover` it and re-read `background-color`/`color`                                                                                 |
| `[data-slot=input]`                                                                                   | `height`, `border-color`, `background-color`; focused `box-shadow`                                                                                                              |
| `[data-slot=dialog-overlay]`                                                                          | `background-color`                                                                                                                                                              |
| `[data-slot=dialog-content]`                                                                          | `border-radius`, `max-width`, `box-shadow`, `background-color`                                                                                                                  |
| `[data-slot=dropdown-menu-item][data-highlighted]`                                                    | `background-color`, `color` (incl. destructive dark)                                                                                                                            |
| `[data-slot=select-trigger]`                                                                          | `background-color`, `border-color`, `height`; focused `box-shadow`                                                                                                              |
| `[data-slot=select-content]`, `[data-slot=select-item][data-highlighted]`                             | `background-color`, `border-radius`, `max-height`                                                                                                                               |
| `[data-slot=card]`                                                                                    | `border-radius`, `box-shadow`, `background-color`                                                                                                                               |
| `[data-slot=scroll-area-viewport]`                                                                    | focused `box-shadow`                                                                                                                                                            |
| `[data-slot=scroll-area-scrollbar]`                                                                   | `width`, `border-left-color`                                                                                                                                                    |

Save as `.playwright-mcp/baseline/computed.json`. Expected: every property has a concrete value; note any selector absent on the sampled page (e.g. tooltip has no call sites).

- [ ] **Step 3: Verify Tailwind's layer order in the built CSS**

Run: `rg -o "@layer [a-z, ]+;" packages/rcs/.next/static/css/*.css | head -3`

Expected: a declaration containing `@layer theme, base, components, utilities;` (or the order split across imports that resolves the same). If `components` is absent from the order, add `@layer theme, base, components, utilities;` as the first line of `packages/rcs/src/app/globals.css` after the font import, and rebuild.

- [ ] **Step 4: Swap the package**

```bash
cd packages/rcs && bun add --exact @base-ui/react@1.9.0 && bun remove @base-ui-components/react
```

Expected: `package.json` has `"@base-ui/react": "1.9.0"` and no `@base-ui-components/react`; `bun.lock` updated.

- [ ] **Step 5: Rename the import specifiers**

In the eight files listed in Files, change `@base-ui-components/react/x` → `@base-ui/react/x` (including `use-render`). Verify:

Run: `rg -n "@base-ui-components" packages/rcs/src packages/rcs/package.json`
Expected: no output.

- [ ] **Step 6: Run the gates**

Run the full gate command from Global Constraints.
Expected: typecheck exit 0; lint `0 errors` (≈38 warnings, pre-existing); test `1270 pass / 0 fail`; build exit 0; `fmt:check` clean.

- [ ] **Step 7: Smoke the matrix**

Using the Verification harness, load `/`, `/settings`, `/admin`, one stored session, and the mobile drawer at both viewports/themes. Compare against `.playwright-mcp/baseline/`.
Expected: no layout/spacing/color/behavior drift (menus open, dialogs open/close, selects work).

- [ ] **Step 8: Commit**

```bash
git add packages/rcs/package.json bun.lock packages/rcs/src/components/ui
git commit -m "chore(rcs): switch to @base-ui/react 1.9"
```

---

### Task 1: Button, Badge, ThemeToggle → CSS Modules (drop cva)

**Files:**

- Create: `packages/rcs/src/components/ui/button.module.css`
- Create: `packages/rcs/src/components/ui/badge.module.css`
- Create: `packages/rcs/src/components/ui/theme-toggle.module.css`
- Modify: `packages/rcs/src/components/ui/button.tsx`
- Modify: `packages/rcs/src/components/ui/badge.tsx`
- Modify: `packages/rcs/src/components/ui/theme-toggle.tsx`
- Modify: `packages/rcs/package.json` (remove `class-variance-authority`)

**Interfaces:**

- Consumes: `cx` from `../../lib/utils`; tokens from `globals.css`.
- Produces: identical public API — `Button(props: useRender.ComponentProps<'button'> & { variant?: 'default'|'destructive'|'outline'|'secondary'|'ghost'|'link'|'brand'|'surface'; size?: 'default'|'sm'|'lg'|'icon'|'icon-sm'|'icon-lg' })`, `Badge(props: useRender.ComponentProps<'span'> & { variant?: 'default'|'secondary'|'destructive'|'outline' })`, `ThemeToggle()`. `buttonVariants`/`badgeVariants` exports are removed (no consumers). `className` still appends last.

- [ ] **Step 1: Write `button.module.css`**

Port the `cva` base string and both variant axes into flat classes (`root`, 8 variant classes, 6 size classes) inside `@layer components`. Values copied from the baseline JSON where the spec's translation rules leave a choice (rings → `box-shadow`, shadows → literals). Ring rule: one `--ring-color` custom property on `root` (default `color-mix(in oklab, var(--color-ring) 50%, transparent)`), consumed by a single `:focus-visible` rule that emits the exact captured `box-shadow` and `border-color: var(--color-ring)`; `[aria-invalid='true']` and the `destructive` variant override `--ring-color` (`destructive/20`, `:global(.dark)` `destructive/40`). Include `:global(.dark)` rules for the destructive/outline/ghost dark variants, `:has(> svg)` padding adjustments, `svg` sizing rules, `:disabled`, and a local `@keyframes` block only if the baseline shows an animation (it does not — do not add one).

- [ ] **Step 2: Rewrite `button.tsx` without cva**

Keep `'use client'` and the `useRender` call. Replace `buttonVariants` with lookup maps:

```tsx
const variantClass = { default: styles.variantDefault /* … 8 entries */ } as const
const sizeClass = { default: styles.sizeDefault /* … 6 entries */ } as const
className: cx(styles.root, variantClass[variant], sizeClass[size], className)
```

Default `variant`/`size` stay `'default'`.

- [ ] **Step 3: Write `badge.module.css` and rewrite `badge.tsx`**

Same pattern, 4 variants. Drop the dead `[a&]:hover` rules (no call site renders Badge as a link; `rg "<Badge" src` confirms). Keep `data-slot="badge"`.

- [ ] **Step 4: Write `theme-toggle.module.css` and rewrite `theme-toggle.tsx`**

Move the `h-8 w-8` trigger size and the selected-item `bg-accent` into module classes; pass `styles.trigger` to `Button`'s `className` and `styles.selected` to the active item. Also port the `sr-only` label span (local class), drop the icons' `h-4 w-4` (the button module's `svg:not([class*='size-'])` rule already sizes them to 1rem), and turn `ml-2` on the label span into a `styles.itemLabel { margin-left: 0.5rem }`.

- [ ] **Step 5: Remove `class-variance-authority`**

```bash
cd packages/rcs && bun remove class-variance-authority
```

Run: `rg -n "class-variance-authority" packages/rcs/src packages/rcs/package.json`
Expected: no output.

- [ ] **Step 6: Run the gates**

Expected: as Task 0 Step 6.

- [ ] **Step 7: Visual + interactive checks**

From the harness: on `/settings` and `/admin`, check the primary button, destructive buttons (hover + dark), secondary/outline chips, badge pills (admin status, role), and the theme toggle button and menu. Verify **business override precedence** (Review Focus): `styles.actionButton` (settings) and `styles.statusPill` (admin) still win — compare computed `height`/`background-color` with baseline. Verify the focused button's `box-shadow` equals `computed.json`.

- [ ] **Step 8: Commit**

```bash
git add packages/rcs/src/components/ui/button.* packages/rcs/src/components/ui/badge.* packages/rcs/src/components/ui/theme-toggle.* packages/rcs/package.json bun.lock
git commit -m "refactor(rcs): move Button, Badge, ThemeToggle to CSS Modules"
```

---

### Task 2: Dialog + DropdownMenu → CSS Modules

**Files:**

- Create: `packages/rcs/src/components/ui/dialog.module.css`
- Create: `packages/rcs/src/components/ui/dropdown-menu.module.css`
- Modify: `packages/rcs/src/components/ui/dialog.tsx`
- Modify: `packages/rcs/src/components/ui/dropdown-menu.tsx`

**Interfaces:**

- Consumes: `cx`; Task 1's module conventions.
- Produces: unchanged exports and props — `Dialog*` parts (`showCloseButton` kept), `DropdownMenu*` parts (`align`, `side`, `sideOffset`, `inset`, `variant` kept). All parts stay `'use client'`.

- [ ] **Step 1: Write `dialog.module.css`**

Port overlay (`bg-black/50` → `color-mix(in oklab, #000 50%, transparent)` or the exact baseline value), content (`fixed`, centered translate, `sm` breakpoint max-width, radius, border, padding, gap, shadow), header/footer, title/description, and the close-button block (absolute placement, opacity/hover, `sr-only` local class, svg sizing rules). Breakpoints `40rem`.

- [ ] **Step 2: Rewrite `dialog.tsx`**

Replace the `cn(...)` calls with `cx(styles.*, className)`. Keep `data-slot` values and `initialFocus` passthrough (Task 3 of the previous migration used `initialFocus={() => dialogRef.current}` — it must still typecheck).

- [ ] **Step 3: Write `dropdown-menu.module.css` and rewrite `dropdown-menu.tsx`**

Port both Positioners' `z-50` → `className={styles.positioner}` with `z-index: 50`; popup (bg, border, radius, shadow, padding, `max-height: var(--available-height)`, `transform-origin: var(--transform-origin)`), items (highlight, destructive including dark tints, `[data-inset]`, disabled), checkbox/radio indicator rows, label, separator, shortcut, sub-trigger (`[data-popup-open]`), sub-content. Keep the `Menu.*` structure unchanged.

- [ ] **Step 4: Run the gates**

Expected: as Task 0 Step 6.

- [ ] **Step 5: Visual + interactive checks**

Open every dialog (new session, API key, revoke, create user, shortcuts, mobile drawer) and every menu (theme, account, model, thinking, permission) at both viewports/themes. Verify overlay color, centering, close focus return, `sm:max-w-lg`, item highlight/destructive dark, `data-inset`, submenu trigger. Verify the mobile drawer's `styles.drawer` still overrides (`max-height: 80vh`, background) and the chat page's markdown chunk still renders (streamdown untouched). Compare overlay/content `background-color` and `box-shadow` with `computed.json`.

- [ ] **Step 6: Commit**

```bash
git add packages/rcs/src/components/ui/dialog.* packages/rcs/src/components/ui/dropdown-menu.*
git commit -m "refactor(rcs): move Dialog and Menu primitives to CSS Modules"
```

---

### Task 3: Select, Tooltip, ScrollArea, Separator → CSS Modules

**Files:**

- Create: `packages/rcs/src/components/ui/select.module.css`
- Create: `packages/rcs/src/components/ui/tooltip.module.css`
- Create: `packages/rcs/src/components/ui/scroll-area.module.css`
- Create: `packages/rcs/src/components/ui/separator.module.css`
- Modify: `packages/rcs/src/components/ui/select.tsx`
- Modify: `packages/rcs/src/components/ui/tooltip.tsx`
- Modify: `packages/rcs/src/components/ui/scroll-area.tsx`
- Modify: `packages/rcs/src/components/ui/separator.tsx`

**Interfaces:**

- Consumes: `cx`; module conventions; Base UI CSS vars `--available-height`, `--anchor-width`, `--transform-origin`.
- Produces: unchanged exports/props. Keep the select scroll arrows' inline `style={{ position: 'static' }}` — it is a documented Base UI defaultProps override.

- [ ] **Step 1: Write `select.module.css` and rewrite `select.tsx`**

Port trigger (base + `sm` size, `[data-placeholder]` color, focus ring incl. `[aria-invalid='true']` via the same `--ring-color` pattern as Task 1, dark tints, disabled), the Positioner's `z-50` → `styles.positioner`, icon sizing, content popup (flex column, `max-height: var(--available-height)`, bg/border/shadow/radius, `transform-origin`), `List` (min-height 0, width, `min-width: var(--anchor-width)`, overflow), item (highlight, svg rules), item indicators, group label, separator, and the two scroll arrows (`display:flex`, padding, static position). Keep the `ScrollUpArrow`/`ScrollDownArrow` inline-style pin.

- [ ] **Step 2: Port tooltip, scroll-area, separator**

- Tooltip: popup bg/color/radius/padding/text style/`text-wrap: balance`, arrow (`width/height: 0.625rem`, rotation, translate calc, `fill: var(--color-foreground)`), Positioner `z-index: 50`. Keep `TooltipProvider` structure.
- ScrollArea: viewport focus ring (`box-shadow` from baseline), `size-full`, radius inherit; scrollbar (`width: 0.625rem`, `border-left: 1px solid transparent`, `touch-action: none`, padding); thumb (`background-color: var(--color-border)`, radius, flex). Orientation classes for horizontal.
- Separator: `[data-orientation='horizontal']` → `height: 1px; width: 100%`; vertical → `height: 100%; width: 1px`; `background-color: var(--color-border)`; `flex-shrink: 0`.

- [ ] **Step 3: Run the gates**

Expected: as Task 0 Step 6.

- [ ] **Step 4: Visual + interactive checks**

- Language select (`/settings`), admin role selects, new-session environment select: trigger text from `items`, `[data-placeholder]` color on the empty environment state, popup 4px offset, keyboard arrows + Enter.
- Force the overflow case (shorten the viewport or use a long list) and confirm both arrows appear in flow and scroll works.
- Mobile drawer: scroll area scrolls, thumb tracks, ids ellipsize.
- `/settings` renders unchanged; `rg -n "Tooltip" packages/rcs/src/components --glob '!ui/**'` to confirm tooltip still has no call sites (if any exist, exercise one).
- Compare trigger/item computed colors and popup geometry with `computed.json`.

- [ ] **Step 5: Commit**

```bash
git add packages/rcs/src/components/ui/select.* packages/rcs/src/components/ui/tooltip.* packages/rcs/src/components/ui/scroll-area.* packages/rcs/src/components/ui/separator.*
git commit -m "refactor(rcs): move Select, Tooltip, ScrollArea, Separator to CSS Modules"
```

---

### Task 4: Input, Label, Card, Skeleton, ConnectionStatus → CSS Modules

**Files:**

- Create: `packages/rcs/src/components/ui/{input,label,card,skeleton,connection-status}.module.css`
- Modify: `packages/rcs/src/components/ui/{input,label,card,skeleton,connection-status}.tsx`

**Interfaces:**

- Consumes: `cx`; module conventions.
- Produces: unchanged exports/props. `connection-status.tsx` keeps its `ConnectionState` type export and `StatusDot` / `StatusIndicator` / `ConnectionStatusBar` names.

- [ ] **Step 1: Port `input.tsx`**

Height, width, padding, radius, border, background (dark tint), text size (`@media (min-width: 48rem)`, Tailwind `md`), placeholder, `file:` pseudo-element block, `selection:` colors, disabled, focus ring (exact `box-shadow` + border, same `--ring-color` pattern), `[aria-invalid='true']`.

- [ ] **Step 2: Port `label.tsx`**

Flex row, gap, text size, `line-height: 1`, font weight, `user-select: none`. Verified: no consumers use `group-data-[disabled=true]` or `peer-disabled` (`rg "peer-disabled|data-disabled" packages/rcs/src` matches only `label.tsx`), so drop those two rule families and note the drop in the commit body.

- [ ] **Step 3: Port `card.tsx`**

Card (bg/border/radius/shadow/padding/gap/flex-column), header (`auto-rows-min`, grid rows, gap, padding, `has([data-slot='card-action'])` two-column template — keep `data-slot`), title/description/action/content/footer (footer `flex items-center`, padding). Drop the dead `[.border-b]:pb-6` / `[.border-t]:pt-6` variants and `@container/card-header` (business components pass module classes; verify with `rg "border-b|border-t|@container" packages/rcs/src/components packages/rcs/src/app --glob '!*.module.css'`).

- [ ] **Step 4: Port `skeleton.tsx` and `connection-status.tsx`**

Skeleton: pulse keyframes (local, outside `@layer components`), rounded background `color-mix(in oklab, var(--color-surface-3) 70%, transparent)`. Connection status: `StatusDot` state→class map (module classes for `bg-text-muted` / `bg-status-*`, pulse on `connecting`), `StatusIndicator` text styling, `ConnectionStatusBar` row, gap, `max-width: 150px` truncation.

- [ ] **Step 5: Run the gates**

Expected: as Task 0 Step 6.

- [ ] **Step 6: Visual + interactive checks**

Login form inputs (focus ring, placeholder, disabled), settings forms and their error states (`aria-invalid`), API-key cards, admin table rows (card/table composition), loading skeletons on first load, navbar connection dot states if observable. Compare input focus `box-shadow` and card `box-shadow`/`border-radius` with `computed.json`.

- [ ] **Step 7: Commit**

```bash
git add packages/rcs/src/components/ui/input.* packages/rcs/src/components/ui/label.* packages/rcs/src/components/ui/card.* packages/rcs/src/components/ui/skeleton.* packages/rcs/src/components/ui/connection-status.*
git commit -m "refactor(rcs): move Input, Label, Card, Skeleton and status to CSS Modules"
```

---

### Task 5: Cleanup + full parity matrix

**Files:**

- Modify: `packages/rcs/src/lib/utils.ts`
- Modify: `packages/rcs/package.json`, `bun.lock`

**Interfaces:**

- Consumes: all modules from Tasks 1–4.
- Produces: `src/lib/utils.ts` exports `cx` and `uniqueKeys` only. No `tailwind-merge` dependency.

- [ ] **Step 1: Remove `cn`**

Delete the `cn` function and the `twMerge` import from `packages/rcs/src/lib/utils.ts`. Verify:

Run: `rg -n "\bcn\(" packages/rcs/src`
Expected: no output. Run: `rg -n "tailwind-merge" packages/rcs/src`
Expected: no output.

- [ ] **Step 2: Remove the dependency**

```bash
cd packages/rcs && bun remove tailwind-merge
```

Expected: `package.json` has no `tailwind-merge`; `bun.lock` updated.

- [ ] **Step 3: Verify no Tailwind class literals remain in `ui/`**

Run: `rg -n 'className="[^"]*(flex|grid|space-|px-|py-|text-|bg-|border|rounded|hidden|w-|h-|gap-|items-|justify-)' packages/rcs/src/components/ui`
Expected: no output. Run: `rg -ln "tailwind-merge|class-variance-authority" packages/rcs/src packages/rcs/package.json`
Expected: no output. Then confirm every module is layered (Risk 1 in the spec):

Run: `rg -L "@layer components" packages/rcs/src/components/ui/*.module.css`
Expected: no output (every `ui/*.module.css` contains an `@layer components` block).

- [ ] **Step 4: Run the gates**

Expected: as Task 0 Step 6.

- [ ] **Step 5: Full parity matrix**

Run the complete matrix from the Verification harness: `/`, `/settings`, `/admin`, one stored session, mobile drawer, new-session dialog, account/theme/model/thinking/permission menus, login and `/~offline` where applicable — both viewports, light and dark. Compare each against `.playwright-mcp/baseline/` screenshots, and re-read `computed.json` selectors on the same pages.
Expected: no drift; the only accepted differences are internals never rendered (e.g. dead shadcn variants dropped in Task 4).

- [ ] **Step 6: Commit**

```bash
git add packages/rcs/src/lib/utils.ts packages/rcs/package.json bun.lock
git commit -m "chore(rcs): drop cn and tailwind-merge"
```
