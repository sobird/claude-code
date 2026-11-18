# RCS UI Primitives: Base UI 1.9 + CSS Modules Design

Date: 2026-11-19
Scope: `packages/rcs` — `src/components/ui/*` and the Base UI dependency rename
across `src/`.

This supersedes one decision in `2026-11-19-rcs-base-ui-design.md`: that design
kept `ui/` on Tailwind. The owner has since asked for the remaining first-party
Tailwind to be migrated to CSS Modules, leaving Tailwind only as streamdown's
styling engine.

## Intent

Two changes, one project:

1. **Package rename.** `@base-ui-components/react@1.0.0-rc.0` → `@base-ui/react`
   (stable line). This is the same library under its released org name.
2. **Finish the CSS Modules migration.** `src/components/ui/*` is the last
   first-party Tailwind surface. Migrate it to co-located `*.module.css`, so
   the only Tailwind consumer left is the `streamdown` markdown renderer.

Motivation: one styling mechanism for everything we own. Tailwind remains a
build-time tool for streamdown's shipped classes, not a tool we write business
or primitive styles in.

## Agreed direction (owner)

- Tailwind may stay **only** for streamdown (`chat/markdown.tsx` and
  `globals.css`'s `@source` scan). Everything we hand-write uses CSS Modules.
- Pixel-level parity: the migration must not change the design.
- Same working discipline as the previous migration: one batch per commit,
  each batch green on the `rcs:*` gates and verified visually.

## My calls (not owner-specified; challengeable)

- **Pin `@base-ui/react` exactly at `1.9.0`**, matching the repo's existing
  exact-pin style.
- **Remove `cn` / `tailwind-merge`**: after migration `cn` has zero consumers
  (verified: only `ui/*` calls it; `lib/utils.ts` defines it). `cx` remains.
- **Remove `class-variance-authority`**: `buttonVariants`/`badgeVariants` have
  no external consumers (verified). Variants become module-class maps.
- Batches and verification mirror the previous migration (see Constraints).

## Dependency rename — verified facts

Checked against the published `@base-ui/react@1.9.0` tarball:

- Package exists; subpaths are unchanged: `menu`, `dialog`, `select`,
  `tooltip`, `scroll-area`, `separator`, `use-render`. Import specifiers only
  change the package name: `@base-ui-components/react/x` → `@base-ui/react/x`.
- Every part we use kept its name: `Menu.{Root,Trigger,Portal,Positioner,Popup,Item,CheckboxItem,CheckboxItemIndicator,RadioGroup,RadioItem,RadioItemIndicator,Group,GroupLabel,Separator,SubmenuRoot,SubmenuTrigger}`,
  `Dialog.{Root,Trigger,Portal,Backdrop,Popup,Close,Title,Description}`,
  `Select.{Root,Trigger,Value,Icon,Portal,Positioner,Popup,List,Item,ItemText,ItemIndicator,Group,GroupLabel,Separator,ScrollUpArrow,ScrollDownArrow}`,
  `Tooltip.{Provider,Root,Trigger,Portal,Positioner,Popup,Arrow}`,
  `ScrollArea.{Root,Viewport,Scrollbar,Thumb,Corner}`, `Separator`.
- Props we depend on are unchanged: `Dialog.Popup initialFocus` / `finalFocus`,
  `Select.Value` children render function `(value) => ReactNode`,
  `Tooltip.Provider delay`, `useRender`.
- State attributes our CSS/selectors use exist: `data-highlighted`,
  `data-disabled`, `data-popup-open`, `data-selected`, `data-placeholder`,
  plus our own `data-slot` / `data-inset` / `data-variant`.
- Positioner CSS variables still emitted: `--available-height`,
  `--anchor-width`, `--transform-origin`.
- Changelog rc.0 → 1.9.0 contains no breaking change affecting the parts above
  (the listed breaking changes concern Combobox/Drawer preview status and
  `sanitizeValue` — not used here).
- Optional peers (`@date-fns/tz`, `date-fns`) stay uninstalled.

Conclusion: the rename is mechanical (package name + version), with no planned
API migration; behavioral deltas, if any, are caught by the visual matrix.

## Styling conventions for `ui/` after migration

- Co-located `Component.module.css` next to each `ui/Component.tsx`;
  camelCase class names; a root class (e.g. `root`, or the component name)
  composed in.
- Compose with `cx` from `src/lib/utils.ts` (`clsx` only, no Tailwind
  conflict resolution). A `className` prop, where it exists today, is appended
  last.
- Tokens: `var(--color-*)`, `var(--font-*)`, `var(--radius)`. Dark mode is a
  token swap; `:global(.dark) .class` is used only where the Tailwind version
  relied on `dark:` utilities with alpha tints (e.g. `dark:bg-input/30`,
  `dark:bg-destructive/60`).
- Keep `data-slot` attributes — module selectors use them
  (`[data-slot='select-value']`, `has([data-slot='card-action'])`).
- Do not mix a Tailwind utility and a module class for the same property.
- Base UI inline styles stay inline where they exist today (e.g. the select
  scroll arrows' `position: static`).

## Cascade and layering (settled after builder check)

Today a business class like `.card` (unlayered) beats the primitive's Tailwind
utilities (layered). If `ui/` module classes were unlayered too, the winner
would depend on Next's CSS injection order — a real regression risk on
`/`, `/settings`, `/admin`, and in chat, where business classes intentionally
override primitives (`.card` vs `Card`, `.dialog` vs `DialogContent`,
`.roleTrigger` vs `w-fit`, `.actionButton` vs `h-9`, …).

**Rule:** every `ui/*.module.css` file wraps its rules in `@layer components`
(Tailwind v4 declares the layer order `theme, base, components, utilities`).
`@keyframes` stay outside the layer block. Business module CSS stays
**unlayered**, so precedence is exactly today's: business module class >
Tailwind utility (incl. `dark:` utilities) > `ui/` component styles > preflight.
`@layer` order beats specificity, so `:global(.dark) .class` (specificity
0,2,0) still loses to an unlayered business class — same as Tailwind's layered
`dark:` utilities today.

Consequence: a `className` passed into a primitive keeps overriding the
primitive's own styles without any `!important` or ordering tricks.

## Batch order and baseline

- **Batch 0** is the package rename alone (`@base-ui/react@1.9.0`, import
  specifiers), as its own commit with the visual matrix, so a later visual
  regression is attributable to CSS, not to the library upgrade. Files
  rewritten in later batches are still renamed first; rework is a mechanical
  import line.
- **Baseline capture (before Batch 0):** on the current commit, boot the
  harness and save under `.playwright-mcp/baseline/`: the standard screenshot
  matrix, plus a JSON of computed styles (`box-shadow` on focus-visible
  rings, `background-color`/`border-color` in light and dark, dialog overlay
  color, item highlight colors, shadows) read via `browser_evaluate`. Ring and
  shadow literals in the modules are copied from these captured values, not
  from memory. If a rebuild of the pre-change commit is needed for an A/B,
  serve it sequentially on the same ports (never two servers at once).

## Utility → CSS translation rules (binding)

1. **Colors**: theme utilities (`bg-popover`, `text-muted-foreground`,
   `border-input`, `bg-primary`, `ring-ring`, …) → `var(--color-*)` from the
   existing `@theme` block. Alpha suffixes `/NN` →
   `color-mix(in oklab, var(--color-X) NN%, transparent)` (Tailwind v4
   semantics).
2. **Dark variants**: `dark:foo` → `:global(.dark) .class { … }`.
3. **State variants**: `data-[x]:` → `[data-x]`; `aria-invalid:` →
   `[aria-invalid='true']`; `disabled:` → `:disabled`; `focus-visible:` →
   `:focus-visible`; `hover:` → `:hover`.
4. **Structural variants**: `has-[>svg]:` → `:has(> svg)`; `*:data-[slot=x]:`
   → `> [data-slot='x']`; `[&_svg:not([class*='size-'])]:size-4` →
   `.root svg:not([class*='size-']) { width: 1rem; height: 1rem }`.
5. **Arbitrary values**: `max-h-(--available-height)` →
   `max-height: var(--available-height)`; `min-w-[var(--anchor-width)]` →
   `min-width: var(--anchor-width)`; `origin-(--transform-origin)` →
   `transform-origin: var(--transform-origin)`;
   `max-w-[calc(100%-2rem)]` → literal calc.
6. **Rings**: Tailwind v4 rings are composed box-shadows. Reproduce the final
   computed `box-shadow` (width/offset/color) exactly; copy the values from
   the pre-migration rendered style, not from memory.
7. **Shadows**: `shadow-xs/sm/md/lg` → the exact Tailwind v4 literals, copied
   from the pre-migration built CSS.
8. **Animations**: `animate-pulse`/`animate-spin` → local `@keyframes` in the
   consuming module (repo convention).
9. **`sr-only`** → a local class in each module that needs it.
10. **Dead shadcn variants**: verify consumers before porting. Known suspects:
    `[.border-b]:pb-6` / `[.border-t]:pt-6` on Card header/footer and
    `@container/card-header` — business components pass module classes, so
    these match nothing; drop with a note. Keep the live
    `has-data-[slot=card-action]` behavior.
11. Outer-element-scoped variants (`[a&]:hover` on Badge) → `a.class:hover` or
    `:is(a).class:hover`, so a Badge rendered as a link keeps its hover.
12. Tailwind preflight stays loaded (streamdown), so UA resets still apply;
    still write explicit border widths/colors/styles where the utility
    implied them, so parity does not depend on preflight indirectly.

## File inventory (14 files → 14 modules)

| File                    | Notable constructs to port                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `button.tsx`            | cva variants (8 variants × 5 sizes), `has-[>svg]:px-*`, focus/aria rings, `dark:` variants, disabled states                                            |
| `badge.tsx`             | cva variants, `[a&]:hover`, link-vs-span                                                                                                               |
| `theme-toggle.tsx`      | Tailwind literals passed to `Button` (`h-8 w-8`), selected `bg-accent`                                                                                 |
| `card.tsx`              | `has-data-[slot=card-action]` grid, dead `[.border-*]` variants, `@container`                                                                          |
| `input.tsx`             | `file:` pseudo-elements, `selection:` colors, `md:text-sm`, `aria-invalid:`, dark tint                                                                 |
| `label.tsx`             | simple block                                                                                                                                           |
| `dialog.tsx`            | overlay `bg-black/50`, fixed centering + `translate`, `sm:max-w-lg`, close button absolute, svg size rules                                             |
| `dropdown-menu.tsx`     | item highlight/destructive variants, `data-[inset]`, `data-[popup-open]`, svg rules, content `max-h-(--available-height)`                              |
| `select.tsx`            | trigger sizes + `data-[placeholder]`, popup `flex-col` + `max-h-(--available-height)`, `List` scroll container, items/indicators, static scroll arrows |
| `tooltip.tsx`           | popup classes, arrow `size-2.5` / `rotate-45` / `fill` / translate calc                                                                                |
| `scroll-area.tsx`       | viewport focus ring, scrollbar `w-2.5` border, thumb                                                                                                   |
| `separator.tsx`         | `data-[orientation=*]` sizing                                                                                                                          |
| `skeleton.tsx`          | `animate-pulse` → local keyframes, translucent surface                                                                                                 |
| `connection-status.tsx` | state→class map (`bg-text-muted`, `bg-status-*`, pulse), text styles                                                                                   |

## `globals.css` — unchanged

Still required by streamdown: `@import 'tailwindcss'`, `@source
'../../node_modules/streamdown/dist'`, `@custom-variant dark`, `@theme static`
tokens, `.dark` token swap, `@layer base` (page background, default border
color, `[data-streamdown]` code rule), scrollbar styling, reduced-motion.
`ui/` modules keep referencing the same `--color-*` variables; no token values
change.

## Removals after migration

- `tailwind-merge` dependency and the `cn` export in `src/lib/utils.ts`
  (verify zero remaining callers).
- `class-variance-authority` dependency after Button/Badge rewrite.
- `clsx` stays (`cx` is built on it).

## Constraints

- Only `src/components/ui/*` (plus the dependency rename) changes. Business
  components, `chat/markdown.tsx`, and all token values stay untouched.
- One batch per commit; every batch must pass `rcs:typecheck`, `rcs:lint`,
  `rcs:test`, `rcs:build`, `fmt:check`.
- Visual verification per batch: Playwright MCP at 1280×900 and 390×844,
  light and dark; routes `/`, `/settings`, `/admin`, one stored session; plus
  interactive primitive states (menu hover/selected/disabled, dialog open +
  focus ring, select overflow arrows, destructive dark item, input focus), and
  A/B computed-style spot checks (box-shadow, background colors) against the
  pre-migration build.

## Risks

1. **Cascade**: solved by `@layer components` around `ui/` modules — business
   classes keep overriding primitives regardless of injection order (see
   "Cascade and layering"). A module accidentally left unlayered would
   reintroduce order-dependent drift, so the plan should check each module.
2. **Base UI 1.9.0 behavioral drift** from rc.0 beyond types — mitigated by
   the interactive matrix.
3. **Ring/shadow parity** is the easiest thing to get subtly wrong — copy
   computed values from the current build and A/B them.
4. **`render` targets**: Button/Badge can render as `a`/`button`; variant CSS
   must not assume the default tag.
5. **streamdown regression**: markdown.tsx and globals.css stay as-is; verify
   a markdown-heavy session after each popup batch.

## Out of scope

- Restyling streamdown internals or removing Tailwind entirely.
- Any business-component styling changes.
- Design/token changes.
