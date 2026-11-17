/**
 * Keyboard cursor over the message thread, mirroring the TUI's message actions.
 * Pure list math: the view supplies the visible, already-grouped items and maps
 * the returned keys back to entries.
 */

export type CursorKind = 'user' | 'assistant' | 'tools' | 'plan' | 'system' | 'turn_end'

export interface CursorItem {
  key: string
  kind: CursorKind
}

export type CursorMove = 'prev' | 'next' | 'user-prev' | 'user-next' | 'top' | 'bottom'

/** Items the cursor may land on: everything except turn markers. */
export function navigableItems(items: readonly CursorItem[]): CursorItem[] {
  return items.filter((item) => item.kind !== 'turn_end')
}

/**
 * Entry point for Shift+↑: the newest user message, or the last navigable item
 * when the thread has none yet.
 */
export function latestUserKey(items: readonly CursorItem[]): string | null {
  const navigable = navigableItems(items)
  for (let i = navigable.length - 1; i >= 0; i--) {
    if (navigable[i]?.kind === 'user') return navigable[i]?.key ?? null
  }
  return navigable[navigable.length - 1]?.key ?? null
}

/**
 * Move the cursor. A missing or stale key lands on a sensible item instead of
 * exiting, so prepended history pages never strand the cursor.
 */
export function moveCursorKey(items: readonly CursorItem[], current: string | null, move: CursorMove): string | null {
  const navigable = navigableItems(items)
  const first = navigable[0]?.key ?? null
  const last = navigable[navigable.length - 1]?.key ?? null
  if (!first || !last) return null

  const index = current === null ? -1 : navigable.findIndex((item) => item.key === current)

  switch (move) {
    case 'top':
      return first
    case 'bottom':
      return last
    case 'prev':
      if (index < 0) return first
      return navigable[Math.max(index - 1, 0)]?.key ?? first
    case 'next':
      if (index < 0) return first
      return navigable[Math.min(index + 1, navigable.length - 1)]?.key ?? last
    case 'user-prev': {
      if (index < 0) return latestUserKey(items)
      for (let i = index - 1; i >= 0; i--) {
        if (navigable[i]?.kind === 'user') return navigable[i]?.key ?? current
      }
      return current
    }
    case 'user-next': {
      if (index < 0) return latestUserKey(items)
      for (let i = index + 1; i < navigable.length; i++) {
        if (navigable[i]?.kind === 'user') return navigable[i]?.key ?? current
      }
      return current
    }
  }
}

export type CursorKeyAction =
  | { action: 'enter-cursor' }
  | { action: 'move'; move: CursorMove }
  | { action: 'enter' }
  | { action: 'copy' }
  | { action: 'copy-primary' }
  | { action: 'exit' }
  | { action: 'ignore' }

export interface CursorKeyInput {
  key: string
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  isComposing: boolean
  cursorActive: boolean
}

/**
 * Map a keydown to a cursor action. Shift+↑ enters; while active, plain
 * arrows/j/k navigate, Shift+arrows hop between user messages, Cmd+arrows jump
 * to the ends, Enter acts, `c`/`p` copy, and Esc/Ctrl+C exit.
 */
export function resolveCursorKey(input: CursorKeyInput): CursorKeyAction {
  const { key, shiftKey, metaKey, ctrlKey, altKey, isComposing, cursorActive } = input
  if (isComposing || altKey) return { action: 'ignore' }

  if (!cursorActive) {
    if (key === 'ArrowUp' && shiftKey && !metaKey && !ctrlKey) return { action: 'enter-cursor' }
    return { action: 'ignore' }
  }

  if (key === 'Escape') return { action: 'exit' }
  if (ctrlKey && !metaKey && !shiftKey && key.toLowerCase() === 'c') return { action: 'exit' }

  if (metaKey && !shiftKey && !ctrlKey) {
    if (key === 'ArrowUp') return { action: 'move', move: 'top' }
    if (key === 'ArrowDown') return { action: 'move', move: 'bottom' }
    return { action: 'ignore' }
  }

  if (shiftKey && !ctrlKey) {
    if (key === 'ArrowUp') return { action: 'move', move: 'user-prev' }
    if (key === 'ArrowDown') return { action: 'move', move: 'user-next' }
    return { action: 'ignore' }
  }

  if (ctrlKey) return { action: 'ignore' }

  switch (key) {
    case 'ArrowUp':
    case 'k':
      return { action: 'move', move: 'prev' }
    case 'ArrowDown':
    case 'j':
      return { action: 'move', move: 'next' }
    case 'Enter':
      return { action: 'enter' }
    case 'c':
      return { action: 'copy' }
    case 'p':
      return { action: 'copy-primary' }
    default:
      return { action: 'ignore' }
  }
}
