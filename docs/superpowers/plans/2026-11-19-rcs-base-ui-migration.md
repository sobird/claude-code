# RCS Radix UI → Base UI Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every Radix UI primitive in `packages/rcs/src/components/ui/*` with Base UI (`@base-ui-components/react@1.0.0-rc.0`), keeping pixel-level parity and changing business call sites only where the primitive API changes.

**Architecture:** `src/components/ui/*` stays, but becomes a thin styling preset over Base UI: its exported API is Base UI-native (`render` instead of `asChild`, Base UI part names). Business components keep their CSS Modules and only change where an API moved (`asChild` → `render`, menu item `onSelect` → `onClick`, select label wiring, dialog `onOpenAutoFocus` → `initialFocus`). Six batches, one conventional commit each; Radix dependencies are removed only after the last import is gone.

**Tech Stack:** Next.js 16 / React 19, Base UI 1.0.0-rc.0 (`useRender`, `Dialog`, `Menu`, `Select`, `Tooltip`, `ScrollArea`, `Separator`), Tailwind v4 + `cn` inside `ui/`, CSS Modules in business components, Bun workspace, `bun run rcs:*` gates.

**Spec:** `docs/superpowers/specs/2026-11-19-rcs-base-ui-design.md`

## Global Constraints

- Pin `@base-ui-components/react` to exactly `1.0.0-rc.0` (`bun add --exact`); never a range.
- `ui/` exports are Base UI-native: `render` replaces `asChild` (no compatibility shim); every part keeps its `data-slot` attribute.
- No visual redesign and no new animations: delete dead `data-[state=...]`, `animate-in/out`, `fade-*`, `zoom-*`, `slide-in-*` utilities, add nothing in their place.
- Highlight styling becomes `data-[highlighted]:*` (not `focus:*`); disabled styling stays `data-[disabled]:*`; open submenu triggers use `data-[popup-open]:*`.
- Only `src/components/ui/*` and the `streamdown` renderer use Tailwind and `cn`; never edit `src/components/chat/markdown.tsx` or `streamdown` files.
- Positioned popups are always `Portal > Positioner > Popup`; positioning props (`side`, `align`, `sideOffset`) go on Positioner; `z-50` goes on Positioner (its inline transform creates the stacking context), visual classes on Popup.
- Menu/select item call handlers move from `onSelect` to `onClick`. Base UI fires `onClick` for Enter/Space on non-native (div-rendered) items via `useButton`.
- The repo has no component-test harness; each task's verification is the gates below plus the interactive checks named in that task (Playwright MCP, production build).
- Gates after every task, from the repo root: `bun run rcs:typecheck && bun run rcs:lint && bun run rcs:test && bun run rcs:build && bun run fmt:check`.
- Conventional commits, commit directly to `main`; body lines ≤ 100 chars (commitlint).

### Verification harness (used by every task's check step)

Prereqs: Postgres 16 and `packages/rcs/.env` (`DATABASE_URL`, `RCS_AUTH_SECRET`) already in place. Run two processes:

```bash
# repo root — production build pointed at the gateway
NEXT_PUBLIC_RCS_API_URL=http://localhost:4000 bun run rcs:build
cd packages/rcs && bun run gateway          # :4000
cd packages/rcs && bunx next start -p 3000  # :3000
```

Drive the UI with Playwright MCP at 1280×900 and 390×844, light and dark (dark via the theme toggle), saving screenshots under `.playwright-mcp/rcs-shots/<batch>/`. Before the `admin` checks, swap the admin password hash to a known value (`psql` UPDATE) and restore it afterwards. Reuse an existing chat session for chat-primitive checks.

## Review Focus

- **Menu keyboard activation:** Enter/Space on a highlighted item must invoke the handler that used to be `onSelect` (thinking / model / permission-mode menus select a value and close).
- **Model-menu inline custom input:** with `closeOnClick={false}`, opening the custom row must keep the menu open, focus the input, accept typing, apply on Enter, and close the row on Escape without closing the menu.
- **Select label resolution:** trigger text must show the localized label, not the raw value, in the language selector, both admin role selects, and the new-session environment select — in `zh-CN` and `en` — and the empty environment state must keep `data-[placeholder]` styling.
- **Dialog initial focus:** the exit-plan-mode dialog must focus its container on open so A/D/Enter stay shortcuts; Escape/outside click still close it.
- **Popup stacking and placement:** `align="end"` menus must open above the page (not behind the navbar), select popups must sit 4px below the trigger with `alignItemWithTrigger` off, and the mobile drawer's scroll area must still scroll with ellipsis intact.

---

### Task 1: Foundation — dependency, `button.tsx`, `badge.tsx`, navbar button

**Files:**

- Modify: `packages/rcs/package.json`
- Modify: `packages/rcs/src/components/ui/button.tsx`
- Modify: `packages/rcs/src/components/ui/badge.tsx`
- Modify: `packages/rcs/src/components/shell/navbar.tsx:77-81`

**Interfaces:**

- Consumes: `useRender` from `@base-ui-components/react/use-render`; `useRender.ComponentProps<'button' | 'span'>` supplies `render`, `className`, `ref`.
- Produces: `Button` and `Badge` accept a Base UI `render` prop and no longer accept `asChild`. Signatures:
  - `Button(props: useRender.ComponentProps<'button'> & VariantProps<typeof buttonVariants>)`
  - `Badge(props: useRender.ComponentProps<'span'> & VariantProps<typeof badgeVariants>)`
    Both files gain `'use client'`; variant classes and `data-slot` values (`button`, `badge`) are unchanged.

- [ ] **Step 1: Add the pinned dependency**

```bash
cd packages/rcs && bun add --exact @base-ui-components/react@1.0.0-rc.0
```

Expected: `package.json` gains `"@base-ui-components/react": "1.0.0-rc.0"` (exact, no caret); `bun.lock` updated.

- [ ] **Step 2: Port `button.tsx` to `useRender`**

Keep `buttonVariants` byte-identical. Replace the `Slot`/`asChild` implementation:

```tsx
'use client'

import { useRender } from '@base-ui-components/react/use-render'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../../lib/utils'

interface ButtonProps extends useRender.ComponentProps<'button'>, VariantProps<typeof buttonVariants> {}

function Button({ className, variant, size, render, ...props }: ButtonProps) {
  return useRender({
    defaultTagName: 'button',
    render,
    props: {
      'data-slot': 'button',
      className: cn(buttonVariants({ variant, size }), className),
      ...props,
    },
  })
}
```

- [ ] **Step 3: Port `badge.tsx` the same way**

`badgeVariants` unchanged; props `interface BadgeProps extends useRender.ComponentProps<'span'>, VariantProps<typeof badgeVariants> {}`; `defaultTagName: 'span'`; `data-slot: 'badge'`; `className: cn(badgeVariants({ variant }), className)`.

- [ ] **Step 4: Convert the one `Button asChild` site in `navbar.tsx`**

Replace lines 77-81 with:

```tsx
<Button
  render={<Link href="/" />}
  variant="ghost"
  size="icon-sm"
  className={styles.dashboardButton}
  aria-label={t('dashboard')}
>
  <LayoutGrid className={styles.icon} />
</Button>
```

- [ ] **Step 5: Run the gates**

```bash
cd /Users/sobird/claude-code && bun run rcs:typecheck && bun run rcs:lint && bun run rcs:test && bun run rcs:build && bun run fmt:check
```

Expected: all pass. If `Badge` is rendered from the server page `(main)/settings/page.tsx`, it must still compile (Badge is now a client boundary; render-only use is fine).

- [ ] **Step 6: Interactive check (harness above)**

At `/` and `/settings` (both viewports, both themes): navbar dashboard control is an `<a href="/">` (via Playwright MCP element list, not a `<button>`), looks unchanged; all buttons keep current padding/height; badges on `/settings` render identically.

- [ ] **Step 7: Commit**

```bash
git add packages/rcs/package.json bun.lock packages/rcs/src/components/ui/button.tsx \
  packages/rcs/src/components/ui/badge.tsx packages/rcs/src/components/shell/navbar.tsx
git commit -m "feat(rcs): add Base UI and port Button/Badge to render"
```

---

### Task 2: Menu family — `dropdown-menu.tsx` + five call sites

**Files:**

- Modify: `packages/rcs/src/components/ui/dropdown-menu.tsx` (full rewrite of the primitive mapping)
- Modify: `packages/rcs/src/components/chat/thinking-menu.tsx:46,68`
- Modify: `packages/rcs/src/components/chat/permission-mode-menu.tsx:52,71`
- Modify: `packages/rcs/src/components/chat/model-menu.tsx:101,121,131,136-146`
- Modify: `packages/rcs/src/components/shell/navbar.tsx:85-122`
- Modify: `packages/rcs/src/components/ui/theme-toggle.tsx:22-28`

**Interfaces:**

- Consumes: `Menu` namespace from `@base-ui-components/react/menu`.
- Produces: same export names as today. `DropdownMenuTrigger` accepts `render` and `disabled`; `DropdownMenuContent` keeps `{ className?, align?, sideOffset = 4 }`; items take `onClick` (and `closeOnClick?`); `DropdownMenuCheckboxItem` takes `checked`/`onCheckedChange`.

- [ ] **Step 1: Rewrite the primitive mapping**

Mapping (keep every existing export and `data-slot`):

- `Root`, `Trigger`, `Group` → `Menu.Root`, `Menu.Trigger`, `Menu.Group`.
- `Portal` → `Menu.Portal` (kept exported; Content uses its own portal).
- `Content`: `Portal > Positioner(sideOffset, align, className="z-50") > Popup(visual classes)`. Popup classes are today's content classes with the animation/`data-[state]` classes removed and the Radix vars replaced: `max-h-(--radix-dropdown-menu-content-available-height)` → `max-h-(--available-height)`, `origin-(--radix-dropdown-menu-content-transform-origin)` → `origin-(--transform-origin)`.
- `Item`: `Menu.Item`. Class conversion: `focus:bg-accent` → `data-[highlighted]:bg-accent`, `focus:text-accent-foreground` → `data-[highlighted]:text-accent-foreground`, and every `data-[variant=destructive]:focus:*` → `data-[variant=destructive]:data-[highlighted]:*`. `data-[disabled]`/`data-[inset]` unchanged.
- `CheckboxItem`/`RadioItem`: `Menu.CheckboxItem`/`Menu.RadioItem`, indicators → `Menu.CheckboxItemIndicator`/`Menu.RadioItemIndicator`; same `focus:` → `data-[highlighted]:` conversion.
- `Label`: plain styled `div` (keep `data-slot`, `data-inset`, classes). Do **not** use `Menu.GroupLabel` (it throws without a `Group` parent).
- `Shortcut`: plain styled `span` (unchanged).
- `Separator`: `Menu.Separator`.
- `Sub`/`SubTrigger`/`SubContent`: `Menu.SubmenuRoot`/`Menu.SubmenuTrigger`/`Portal > Positioner > Popup`. On `SubmenuTrigger`, convert `data-[state=open]:*` → `data-[popup-open]:*`.

- [ ] **Step 2: Convert the chat menu triggers and item handlers**

In `thinking-menu.tsx`, `permission-mode-menu.tsx`, `model-menu.tsx`: trigger child `<button>` becomes `render={<button … />}` (props `type`, `data-testid`, `aria-label`, `className` stay on the button; children stay inside the wrapper). Change item `onSelect=...` to `onClick=...`. In `model-menu.tsx`, the custom-model item at line 139 becomes:

```tsx
<DropdownMenuItem
  data-testid="model-custom"
  disabled={pending}
  closeOnClick={false}
  onClick={() => {
    setCustomOpen(true)
    requestAnimationFrame(() => inputRef.current?.focus())
  }}
>
```

- [ ] **Step 3: Convert the navbar account menu**

Trigger: `<DropdownMenuTrigger render={<Button variant="ghost" size="sm" className={styles.accountTrigger} />}>` with the avatar/name children inside. Items: `asChild` around `<Link>` → `render={<Link href="/settings" className={styles.menuLink} />}` (and the `/admin` one); the sign-out `asChild` around `<button type="submit">` → `render={<button type="submit" className={styles.signOutButton} />}`.

- [ ] **Step 4: Convert `theme-toggle.tsx`**

Trigger: `render={<Button variant="ghost" size="icon-sm" className="h-8 w-8" />}` with the icon/sr-only children inside.

- [ ] **Step 5: Run the gates**

Same command as Task 1, Step 5. Expected: all pass; no remaining `asChild` or `onSelect` in the five business files (`grep -rn "asChild\|onSelect" packages/rcs/src/components/chat/*menu*.tsx packages/rcs/src/components/shell/navbar.tsx packages/rcs/src/components/ui/theme-toggle.tsx` shows none).

- [ ] **Step 6: Interactive check (Review Focus 1, 2, 5)**

Open the theme toggle, then in a chat session: thinking, model, permission-mode menus. Verify: menus open below/near the trigger with `align="end"` right alignment, hover and arrow-key highlight uses the accent background, Enter selects and closes (Review Focus 1), disabled triggers do nothing, and the custom-model row keeps the menu open while typing, applies on Enter, and clears on Escape (Review Focus 2). Check both viewports and themes; menu must not render behind the navbar (Review Focus 5).

- [ ] **Step 7: Commit**

```bash
git add packages/rcs/src/components/ui/dropdown-menu.tsx packages/rcs/src/components/ui/theme-toggle.tsx \
  packages/rcs/src/components/chat/thinking-menu.tsx packages/rcs/src/components/chat/permission-mode-menu.tsx \
  packages/rcs/src/components/chat/model-menu.tsx packages/rcs/src/components/shell/navbar.tsx
git commit -m "feat(rcs): port dropdown menus to Base UI Menu"
```

---

### Task 3: Dialog family — `dialog.tsx` + six call sites

**Files:**

- Modify: `packages/rcs/src/components/ui/dialog.tsx`
- Modify: `packages/rcs/src/components/chat/exit-plan-mode-card.tsx:274-284`
- Verify unchanged: `settings/api-keys.tsx`, `chat/shortcuts-dialog.tsx`, `shell/navbar.tsx`, `shell/new-session-dialog.tsx`, `admin/user-table.tsx`

**Interfaces:**

- Consumes: `Dialog` namespace from `@base-ui-components/react/dialog`.
- Produces: same export names (`Dialog`, `DialogTrigger`, `DialogPortal`, `DialogClose`, `DialogOverlay`, `DialogContent`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`). `DialogContent` forwards `ref` and `initialFocus` to `Dialog.Popup` and keeps `showCloseButton = true`.

- [ ] **Step 1: Rewrite the primitive mapping**

- `Dialog` → `Dialog.Root`; `Trigger`/`Portal`/`Close`/`Title`/`Description` → `Dialog.Trigger`/`Dialog.Portal`/`Dialog.Close`/`Dialog.Title`/`Dialog.Description`.
- `DialogOverlay` → `Dialog.Backdrop`, classes minus `data-[state=*]`: `fixed inset-0 z-50 bg-black/50`.
- `DialogContent` → `Dialog.Portal > Dialog.Backdrop > Dialog.Popup`; Popup keeps `bg-background fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg` and spreads `{...props}` (so `ref`, `initialFocus`, `tabIndex`, `onKeyDown` reach Popup). Drop the animation/`data-[state]` utilities.
- Built-in close button → `Dialog.Close` with today's classes minus the dead `data-[state=open]:*` utilities (Radix sets no `data-state` on Close, so they never applied).

- [ ] **Step 2: Convert the exit-plan-mode dialog**

Replace the `onOpenAutoFocus` block with `initialFocus={() => dialogRef.current}`; keep `ref`, `tabIndex={-1}`, `onKeyDown`.

- [ ] **Step 3: Run the gates**

Same command as Task 1, Step 5. Expected: all pass.

- [ ] **Step 4: Interactive check (Review Focus 4)**

Open/close every dialog: new-session (dashboard), admin create-user and edit-role, API-key create/revoke (`/settings`), mobile navbar drawer (390px), shortcuts dialog. Verify outside click and Escape close, the X button closes, and the exit-plan-mode dialog in a chat session focuses its container — pressing A/D/Enter triggers the shortcuts rather than re-activating a button (Review Focus 4). Both viewports/themes.

- [ ] **Step 5: Commit**

```bash
git add packages/rcs/src/components/ui/dialog.tsx packages/rcs/src/components/chat/exit-plan-mode-card.tsx
git commit -m "feat(rcs): port dialogs to Base UI Dialog"
```

---

### Task 4: Form family — `label.tsx`, `select.tsx` + three call sites

**Files:**

- Modify: `packages/rcs/src/components/ui/label.tsx`
- Modify: `packages/rcs/src/components/ui/select.tsx`
- Modify: `packages/rcs/src/components/settings/language-selector.tsx:74`
- Modify: `packages/rcs/src/components/shell/new-session-dialog.tsx:96`
- Modify: `packages/rcs/src/components/admin/user-table.tsx:73,249`

**Interfaces:**

- Consumes: `Select` namespace from `@base-ui-components/react/select`; `Separator` from Base UI.
- Produces: `Label(props: React.ComponentProps<'label'>)` (plain element, no `'use client'`). `SelectValue(props: Omit<React.ComponentProps<typeof SelectPrimitive.Value>, 'children'> & { items?: Record<string, string>; placeholder?: React.ReactNode })` — without `items`/`placeholder` it renders plain `Select.Value`; with either it renders a children function `(value) => value == null ? placeholder : items?.[value] ?? value`. `SelectContent` keeps `{ className?, align = 'center' }` and drops the Radix `position` prop.

- [ ] **Step 1: Replace the Label primitive**

Plain styled `<label>` with today's classes and `data-slot="label"`; drop the `'use client'` directive, the Radix import, and `cn` stays for the class string.

- [ ] **Step 2: Rewrite the Select mapping**

- `Root`, `Group`, `Trigger`, `Item`, `ItemText`, `ItemIndicator`, `GroupLabel`, `Separator` → the Base UI parts of the same names.
- `Trigger`: keep classes; render the icon as `<Select.Icon render={<ChevronDownIcon className="size-4 opacity-50" />} />`; keep `*:data-[slot=select-value]:*` selectors (the Value wrapper keeps `data-slot="select-value"`).
- `Content`: `Portal > Positioner(sideOffset={4}, align={align}, alignItemWithTrigger={false}, className="z-50") > Popup(visual classes) > [ScrollUpArrow, List(p-1 w-full min-w-[var(--anchor-width)] scroll-my-1), ScrollDownArrow]`. Popup classes: today's minus `p-1` handling and animation/`data-[state]` utilities, with `max-h-(--radix-select-content-available-height)` → `max-h-(--available-height)` and `origin-(--radix-select-content-transform-origin)` → `origin-(--transform-origin)`.
- `Item`: classes with `focus:bg-accent focus:text-accent-foreground` → `data-[highlighted]:*` (same conversion rule as menus). `data-[placeholder]` styling on the trigger already matches Base UI's attribute.
- `ScrollUp/DownButton` → `Select.ScrollUpArrow`/`Select.ScrollDownArrow` with unchanged classes/icons.

- [ ] **Step 3: Wire the three select call sites**

- `language-selector.tsx`: `<SelectValue items={labels} />`.
- `new-session-dialog.tsx`: build the label map next to the render and pass it:

```tsx
const environmentItems: Record<string, string> = {
  [NO_ENVIRONMENT]: t('newSession.noEnvironment'),
  ...Object.fromEntries(
    environments.map((environment) => [
      environment.id,
      `${environment.machine_name || environment.id}${environment.branch ? ` (${environment.branch})` : ''}`,
    ]),
  ),
}
```

then `<SelectValue items={environmentItems} placeholder={t('newSession.noEnvironment')} />`.

- `user-table.tsx`: both `SelectValue`s get `items={{ admin: tCommon('role.admin'), member: tCommon('role.member') }}` (the row `RoleSelect` and the create-user dialog).

- [ ] **Step 4: Run the gates**

Same command as Task 1, Step 5. Expected: all pass.

- [ ] **Step 5: Interactive check (Review Focus 3, 5)**

In both locales: `/settings` language selector shows the current locale label and changes locale; admin row role select and create-user role select show "Admin"/"Member" (translated), open below the trigger with a small gap, and update on selection; the new-session environment select shows "No environment" initially with muted placeholder styling and lists environments with `name (branch)`, with scroll arrows appearing when the list overflows (Review Focus 3, 5). Keyboard: arrows move the highlight, Enter selects.

- [ ] **Step 6: Commit**

```bash
git add packages/rcs/src/components/ui/label.tsx packages/rcs/src/components/ui/select.tsx \
  packages/rcs/src/components/settings/language-selector.tsx \
  packages/rcs/src/components/shell/new-session-dialog.tsx packages/rcs/src/components/admin/user-table.tsx
git commit -m "feat(rcs): port labels and selects to Base UI"
```

---

### Task 5: Misc — `tooltip.tsx`, `separator.tsx`, `scroll-area.tsx`

**Files:**

- Modify: `packages/rcs/src/components/ui/tooltip.tsx`
- Modify: `packages/rcs/src/components/ui/separator.tsx`
- Modify: `packages/rcs/src/components/ui/scroll-area.tsx`
- Business usage: only `shell/navbar.tsx` (ScrollArea in the mobile drawer)

**Interfaces:**

- Consumes: `Tooltip` namespace, `Separator`, `ScrollArea` namespace from Base UI.
- Produces: same export names. `TooltipProvider` prop `delayDuration` → `delay` (no call sites today). `Separator` drops `decorative` and keeps `orientation`.

- [ ] **Step 1: Port `tooltip.tsx`**

`Tooltip.Provider(delay) > Root > Trigger > Portal > Positioner(sideOffset) > Popup(classes minus animation/`data-[state]`) > Arrow`. Keep the exported shape (`Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider`).

- [ ] **Step 2: Port `separator.tsx`**

Base UI `Separator` with `orientation` and `data-slot="separator"`; keep the orientation classes; drop `decorative`. Note: this wrapper currently has **no business call sites** (menus use `DropdownMenuSeparator`, which Task 2 maps to `Menu.Separator`).

- [ ] **Step 3: Port `scroll-area.tsx`**

`ScrollArea.Root > Viewport + Scrollbar(orientation) > Thumb + Corner`; keep today's classes; remove the Radix #926 workaround class `[&>div[style]]:!block` and its comment.

- [ ] **Step 4: Run the gates**

Same command as Task 1, Step 5. Expected: all pass.

- [ ] **Step 5: Interactive check (Review Focus 5)**

On 390×844, open the navbar drawer: the session list scrolls, text truncates with ellipsis (no clipping/overflow), and the scrollbar thumb renders when the list overflows. Tooltip and Separator have no call sites; their check is that `/` and `/settings` still render unchanged.

- [ ] **Step 6: Commit**

```bash
git add packages/rcs/src/components/ui/tooltip.tsx packages/rcs/src/components/ui/separator.tsx \
  packages/rcs/src/components/ui/scroll-area.tsx
git commit -m "feat(rcs): port tooltip, separator, scroll area to Base UI"
```

---

### Task 6: Cleanup — remove Radix, full matrix

**Files:**

- Modify: `packages/rcs/package.json`, `bun.lock`

- [ ] **Step 1: Confirm no Radix imports remain**

```bash
grep -rn "@radix-ui" packages/rcs/src || echo "clean"
```

Expected: `clean`. (Transitive copies in `node_modules` are irrelevant.)

- [ ] **Step 2: Remove the dependencies**

```bash
cd packages/rcs && bun remove @radix-ui/react-collapsible @radix-ui/react-dialog @radix-ui/react-dropdown-menu \
  @radix-ui/react-hover-card @radix-ui/react-label @radix-ui/react-popover @radix-ui/react-scroll-area \
  @radix-ui/react-select @radix-ui/react-separator @radix-ui/react-slot @radix-ui/react-tooltip \
  @radix-ui/react-use-controllable-state radix-ui
```

- [ ] **Step 3: Run the gates**

Same command as Task 1, Step 5. Expected: all pass.

- [ ] **Step 4: Run the full visual matrix**

Routes `/login`, `/login?error=invalid`, `/`, `/settings`, `/admin`, `/~offline`, and one chat session; 1280×900 and 390×844; light and dark. For each page load compare against the pre-migration look (no layout, spacing, or color drift). Then re-run the interactive checks from Tasks 2-5 in one pass (menus, dialogs, selects, drawer). Fix any drift in the owning wrapper before committing.

- [ ] **Step 5: Commit**

```bash
git add packages/rcs/package.json bun.lock
git commit -m "chore(rcs): drop Radix UI dependencies"
```
