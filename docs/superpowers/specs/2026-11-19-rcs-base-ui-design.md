# RCS Base UI Migration Design

Date: 2026-11-19
Scope: `packages/rcs` (`src/components/ui/*` and their business call sites)

## Intent

Unify the UI primitive stack on Base UI (`@base-ui-components/react`) and
remove Radix UI. This is a stack-consolidation move, not a bug fix: Radix
works today, but keeping two primitive families (or a shadcn-style
compatibility layer on top of a non-Radix core) is a permanent maintenance
cost.

Agreed direction with the owner:

- The `ui/` layer stays, but becomes a **thin styling preset** over Base UI.
  Its exported API is Base UI-native (`render` instead of `asChild`, Base UI
  part names); it is not a shadcn compatibility shim.
- Business components (`shell/`, `chat/`, `settings/`, `admin/`, `src/app`)
  change only where the primitive API changes. Their co-located CSS Modules
  and class overrides stay.
- `src/components/ui/*` and the `streamdown` markdown renderer keep Tailwind;
  `cn` (tailwind-merge) stays confined to `ui/`. No change to that split.
- Pixel-level parity with the current UI. Same discipline as the CSS Modules
  migration: no visual redesign, one component family per commit.

## Current inventory

Direct Radix imports in `src/` exist in exactly nine files:

| `ui/` file          | Radix package                   | Business usage (files)                                                                                  |
| ------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `dialog.tsx`        | `@radix-ui/react-dialog`        | 6 (`api-keys`, `shortcuts-dialog`, `exit-plan-mode-card`, `navbar`, `new-session-dialog`, `user-table`) |
| `dropdown-menu.tsx` | `@radix-ui/react-dropdown-menu` | 5 (`thinking-menu`, `permission-mode-menu`, `model-menu`, `navbar`, `theme-toggle`)                     |
| `select.tsx`        | `@radix-ui/react-select`        | 3 (`language-selector`, `new-session-dialog`, `user-table`)                                             |
| `label.tsx`         | `@radix-ui/react-label`         | 5 (`password-form`, `language-selector`, `api-keys`, `new-session-dialog`, `user-table`)                |
| `separator.tsx`     | `@radix-ui/react-separator`     | 4 (`thinking-menu`, `permission-mode-menu`, `model-menu`, `navbar`)                                     |
| `scroll-area.tsx`   | `@radix-ui/react-scroll-area`   | 1 (`navbar` drawer)                                                                                     |
| `button.tsx`        | `@radix-ui/react-slot`          | 15 (one `asChild` site: navbar)                                                                         |
| `badge.tsx`         | `@radix-ui/react-slot`          | 9 (no `asChild` sites)                                                                                  |
| `tooltip.tsx`       | `@radix-ui/react-tooltip`       | 0 (wrapper exists, unused today)                                                                        |

Declared but unused Radix dependencies: `@radix-ui/react-collapsible`,
`@radix-ui/react-hover-card`, `@radix-ui/react-popover`,
`@radix-ui/react-use-controllable-state`, and the `radix-ui` umbrella package.

Also inert today: the `animate-in` / `fade-in-0` / `zoom-in-95` /
`slide-in-from-*` classes in `ui/` come from shadcn but no animation CSS
library (`tw-animate-css` or similar) is installed, so they generate nothing.
The dialogs, menus, selects, and tooltips currently have **no** enter/exit
animations.

## Target package and version

`@base-ui-components/react@1.0.0-rc.0` — the current `latest` dist-tag (the
project has not cut a stable 1.0 yet). React 19 is supported (`^17 || ^18 ||
^19`). This is a deliberate call: adopt the RC, pin the exact version, and
treat upgrades as routine dependency bumps.

API facts verified against the package's type declarations:

- Every part accepts `render` (element or function) and `className` (string
  or state callback). There is no Slot / `asChild`.
- `useRender` is a public export (`@base-ui-components/react/use-render`).
- Composition is explicit: portals do not include positioning containers.
  Positioned popups are `Portal > Positioner > Popup`; Positioner takes
  `side`, `align`, `sideOffset`.
- Open state styling uses `data-open` / `data-popup-open` and
  `data-starting-style` / `data-ending-style`, not Radix's `data-state`.
  Highlighted menu/select items get `data-highlighted`, not `:focus`.
- Positioner CSS vars: `--anchor-width`, `--available-height`,
  `--transform-origin` (replacing Radix's `--radix-*-content-*` vars).
- `Menu.GroupLabel` requires a `Menu.Group` ancestor (throws otherwise).
- `Field.Label` is only meaningful inside `Field.Root`.
- `Select.Value` resolves a display label from the Root's `items` prop only
  when it has no children; a children function overrides that resolution and
  receives the raw value. There is no `placeholder` prop; an empty selection
  is signalled by `data-placeholder` on the Value/Trigger.

## Component mapping

### `button.tsx`, `badge.tsx`

- Drop `@radix-ui/react-slot` and the `asChild` prop.
- Add `render?: ReactElement | ((props, state) => ReactElement)` implemented
  with Base UI's `useRender`, so `render={<Link .../>}` composes exactly like
  the rest of the ecosystem.
- Keep `cva` variants and `cn`-based class merging; keep `data-slot`.
- Both files gain `'use client'` (they use a hook now). A server component
  (`(main)/settings/page.tsx`) renders `Badge`; that stays valid — the badge
  simply becomes a client boundary.

### `dialog.tsx`

- `Dialog` → `Dialog.Root`; `DialogTrigger` → `Dialog.Trigger`;
  `DialogPortal` → `Dialog.Portal`; `DialogClose` → `Dialog.Close`;
  `DialogTitle`/`DialogDescription` → `Dialog.Title`/`Dialog.Description`.
- `DialogOverlay` → `Dialog.Backdrop` (same `fixed inset-0 z-50 bg-black/50`).
- `DialogContent` keeps its current shape: Portal + Backdrop + Popup, with the
  same centering classes (`fixed top-1/2 left-1/2 -translate-* grid …`) and the
  same built-in close button (`Dialog.Close`, `showCloseButton` prop kept).
- Drop the dead `data-[state=…]:animate-*` classes; add nothing in their
  place. No animation is added in this migration.

### `dropdown-menu.tsx`

- `DropdownMenu` → `Menu.Root`; `Trigger` → `Menu.Trigger` (supports
  `disabled`); `Item` → `Menu.Item`; `CheckboxItem` → `Menu.CheckboxItem`
  (props `checked` / `onCheckedChange`); `RadioGroup`/`RadioItem` →
  `Menu.RadioGroup`/`Menu.RadioItem`; `Separator` → `Menu.Separator`;
  `Sub` → `Menu.SubmenuRoot`; `SubTrigger` → `Menu.SubmenuTrigger`.
- `DropdownMenuContent` keeps its API (`className`, `sideOffset = 4`,
  `align`) but renders `Portal > Positioner > Popup`; `sideOffset`/`align` go
  to Positioner, visual classes to Popup.
- `DropdownMenuSubContent` becomes `Portal > Positioner > Popup` as well
  (Base UI has no dedicated sub-content part).
- `DropdownMenuLabel` stays a plain styled `div`. `Menu.GroupLabel` requires
  a `Group` parent, and all four current label sites are ungrouped; wrapping
  them in new groups would change DOM structure for no visual gain.
- `DropdownMenuShortcut` stays a plain styled `span` (no Base UI equivalent;
  Radix didn't provide one either).
- `DropdownMenuCheckboxItem`/`RadioItem` indicators use
  `Menu.CheckboxItemIndicator`/`Menu.RadioItemIndicator`.
- Item highlight classes move from `focus:*` to `data-[highlighted]:*`
  (`focus:bg-accent` → `data-[highlighted]:bg-accent`, etc.) so the visual
  result matches Radix's focus styling.
- Radix `onSelect` has no Base UI equivalent; the five item handlers become
  `onClick` (Base UI items fire a normal click). Base UI closes the menu on
  click by default; the custom-model entry in `model-menu.tsx` (which today
  calls `event.preventDefault()` to keep the menu open while an inline `<input>`
  is focused) uses `closeOnClick={false}` on that `Menu.Item`. Keyboard
  navigation and typing inside the inline input are verified in the matrix; a
  contingency (moving the custom name into a `Dialog`) is a product change and
  is out of scope here.

### `select.tsx`

- `Select` → `Select.Root`; `Trigger` → `Select.Trigger`; `Icon` →
  `Select.Icon`; `Item` → `Select.Item`; `ItemText` → `Select.ItemText`;
  `ItemIndicator` → `Select.ItemIndicator`; `Group`/`Label` →
  `Select.Group`/`Select.GroupLabel`; `Separator` → `Select.Separator`;
  `ScrollUp/DownButton` → `Select.ScrollUpArrow`/`ScrollDownArrow`.
- `SelectContent` renders `Portal > Positioner > Popup`, with items wrapped in
  a new `SelectList`. Visual mapping: Popup keeps the current content classes
  minus `p-1`; `p-1` and scroll padding move to the List. The Positioner sets
  `alignItemWithTrigger={false}` — Base UI defaults it to `true`, which would
  shift the popup to overlay the selected item; Radix places the popup below
  the trigger, so `false` is the parity setting.
- Radix vars map to Base UI vars: trigger width → `w-[var(--anchor-width)]`,
  max height → `max-h-(--available-height)`, transform origin →
  `origin-(--transform-origin)`.
- `SelectValue` keeps one compatibility convenience: it accepts `items` (the
  value→label map) and `placeholder`. When either is used it renders Base UI
  `Select.Value` with a children function
  `(value) => value == null ? placeholder : items?.[value] ?? value`.
  Without them it renders plain `Select.Value` (Root `items` resolution).
  This is the only behavioural helper kept in `ui/`, and it exists because
  all three call sites display localized labels that differ from the raw
  value.
- Target `data-[placeholder]` styling already matches Base UI's attribute; no
  class change needed.
- Item highlight classes move to `data-[highlighted]:*`, same as menus.

### `label.tsx`

- Replace the Radix root with a plain styled `<label>`. `Field.Label`
  requires a `Field.Root` context that the app does not use, and the current
  component is only a Tailwind preset; the DOM and behaviour are identical.

### `separator.tsx`

- Use Base UI `Separator` (`orientation` prop; Radix's `decorative` has no
  Base UI equivalent and is dropped — it is not used at any call site beyond
  the wrapper default).

### `scroll-area.tsx`

- Map to Base UI `ScrollArea.Root > Viewport`, plus
  `ScrollArea.Scrollbar > Thumb` and `ScrollArea.Corner`. Keep the same
  classes. The Radix-specific `[&>div[style]]:!block` workaround for Radix
  issue #926 is removed; the ellipsis case in the navbar drawer is re-checked
  visually.

### `tooltip.tsx`

- Map to `Tooltip.Provider` (prop rename `delayDuration` → `delay`) +
  `Root > Trigger > Portal > Positioner > Popup > Arrow`. Keep the exported
  shape. No business call sites today, but the wrapper is ported so nothing
  Radix remains.

## Call-site changes (business components)

Only where the primitive API changes:

1. `asChild` sites → `render` (9 total: 1 `Button`, 5 `DropdownMenuTrigger`, 3 `DropdownMenuItem`):
   - `navbar.tsx`: `Button asChild` around `<Link>` → `render={<Link …/>}`.
   - `theme-toggle.tsx`, `thinking-menu.tsx`, `permission-mode-menu.tsx`,
     `model-menu.tsx`, `navbar.tsx`: `DropdownMenuTrigger asChild` around a
     `Button` → `render={<Button …/>}`.
   - `navbar.tsx`: three `DropdownMenuItem asChild` around links →
     `render={<Link …/>}`.
2. Select call sites (`language-selector.tsx`, `new-session-dialog.tsx`,
   `user-table.tsx`): pass the label map via `items` on `SelectValue`; the one
   placeholder case (`new-session-dialog`) also passes `placeholder`.
3. `exit-plan-mode-card.tsx` uses Radix's `onOpenAutoFocus` to focus the
   dialog container itself (so its `onKeyDown` handler catches shortcuts)
   instead of the first tabbable child. Base UI's equivalent is
   `initialFocus`; it becomes `initialFocus={() => dialogRef.current}`. The
   `ref` and `onKeyDown` stay as they are.
4. Everything else (dialogs, separators, scroll area, labels, menus' item
   content) keeps its current JSX.

## Dependencies

Add: `@base-ui-components/react` pinned to `1.0.0-rc.0`.

Remove after the last import is gone:
`@radix-ui/react-collapsible`, `@radix-ui/react-dialog`,
`@radix-ui/react-dropdown-menu`, `@radix-ui/react-hover-card`,
`@radix-ui/react-label`, `@radix-ui/react-popover`,
`@radix-ui/react-scroll-area`, `@radix-ui/react-select`,
`@radix-ui/react-separator`, `@radix-ui/react-slot`,
`@radix-ui/react-tooltip`, `@radix-ui/react-use-controllable-state`, and the
`radix-ui` umbrella package. Verify no remaining `@radix-ui` import before
removing (other libraries bring their own transitive copies; that is fine).

## Batch order (one commit per batch)

1. Foundation: add the dependency; port `button.tsx` and `badge.tsx` to
   `useRender`; convert the navbar `Button asChild` site. Widest blast radius,
   verify first.
2. Menu family: `dropdown-menu.tsx` + the five call sites (three chat menus,
   navbar, theme toggle), including the `render` conversions.
3. Dialog family: `dialog.tsx` + six call sites.
4. Form family: `label.tsx`, `select.tsx`, and the three select call sites.
5. Misc: `tooltip.tsx`, `separator.tsx`, `scroll-area.tsx`.
6. Cleanup: drop Radix dependencies from `package.json`, refresh the lockfile,
   run all gates and the visual matrix.

If a batch reveals an API mismatch that would force a visual change, stop and
report before continuing. Never edit `streamdown` files or `markdown.tsx`.

## Verification

Gates after every batch, from the repo root:

```bash
bun run rcs:typecheck && bun run rcs:lint && bun run rcs:test && bun run rcs:build && bun run fmt:check
```

Visual matrix. There is no committed Playwright suite in this repo (the CSS
Modules migration used the same ad-hoc harness), so verification is run
interactively with Playwright MCP against a production build:
`NEXT_PUBLIC_RCS_API_URL=http://localhost:4000`, gateway on :4000, `next start`
on :3000, two viewports 1280×900 and 390×844, light and dark; screenshots land
in `.playwright-mcp/rcs-shots/` (gitignored). The `admin` password hash is
swapped to a known value for the run and restored afterwards, and an existing
chat session is reused. Routes: `/login`, `/login?error=invalid`, `/`,
`/settings`, `/admin`, `/~offline`, and one chat session. Beyond page loads,
this migration needs interactive checks that the primitives still behave:

- Dialogs: new-session dialog, admin create-user and edit-role dialogs, mobile
  navbar drawer, API-key dialog — open/close, outside click, Escape.
- Menus: theme toggle, chat model / thinking / permission-mode menus —
  placement (including `align="end"`), keyboard navigation, disabled trigger
  state.
- Selects: language selector, admin role select (row and create dialog),
  new-session environment select — label display, empty/population, popup
  placement, scroll arrows when the list overflows.
- Scroll area in the mobile drawer: scrolling and ellipsis still behave.

## Non-goals

- No visual redesign, no added animations, no new keyboard shortcuts.
- No changes to `src/components/chat/markdown.tsx`, `streamdown`, or the
  CSS-Modules/Tailwind split.
- No accessibility audit beyond preserving current semantics (the migration
  keeps Base UI's defaults, which are WAI-ARIA compliant).
- No replacement of non-Radix UI dependencies (`cmdk`, `react-resizable-panels`
  are present but unused/unrelated).

## Risks

- **RC version.** `1.0.0-rc.0` is the only current release line; APIs may
  move in later releases. Pinned exact version limits the blast radius.
- **Data-attribute styling.** Highlight/focus and open/close styling depend on
  Base UI's attributes; a missed `focus:` → `data-[highlighted]:` conversion
  would silently drop hover/keyboard styling. The visual matrix covers the
  menus and selects specifically.
- **Select label/placeholder.** Base UI resolves trigger text from `items`,
  not from item children like Radix; the three call sites are explicitly
  re-wired and checked in both locales.
- **Portal composition.** Forgetting `Positioner` produces an unpositioned
  popup; for menus/selects the wrapper owns this, so call sites cannot get it
  wrong.
- **Client boundary.** `button.tsx`/`badge.tsx` become client components; the
  one server-page usage (`settings/page.tsx` Badge) is render-only and safe.
