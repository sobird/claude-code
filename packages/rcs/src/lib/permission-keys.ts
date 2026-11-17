/**
 * Keyboard policy for the permission panel, extracted so it is testable without
 * a DOM.
 *
 * The panel is a keyboard-complete alternative to clicking Allow/Deny while the
 * composer has focus ownership of typing: keys are only interpreted when no
 * editable element is focused, and Escape is deliberately left to the composer
 * (interrupt) and dialogs (close).
 */

export type PermissionKeyAction =
  | { action: 'allow'; index: number }
  | { action: 'deny'; index: number }
  | { action: 'select'; index: number }
  | { action: 'next' }
  | { action: 'previous' }
  | { action: 'ignore' }

export interface PermissionKeyInput {
  key: string
  requestCount: number
  selectedIndex: number | null
  /** Focus is in a text field, select, button, or contenteditable host. */
  inEditable: boolean
  isComposing?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
}

export function resolvePermissionKey({
  key,
  requestCount,
  selectedIndex,
  inEditable,
  isComposing = false,
  ctrlKey = false,
  metaKey = false,
  altKey = false,
}: PermissionKeyInput): PermissionKeyAction {
  if (requestCount <= 0 || inEditable || isComposing) return { action: 'ignore' }
  if (ctrlKey || metaKey || altKey) return { action: 'ignore' }

  const selected = clampIndex(selectedIndex ?? 0, requestCount)

  switch (key) {
    case 'a':
    case 'A':
    case 'Enter':
      return { action: 'allow', index: selected }
    case 'd':
    case 'D':
      return { action: 'deny', index: selected }
    case 'ArrowDown':
    case 'j':
    case 'J':
      return { action: 'next' }
    case 'ArrowUp':
    case 'k':
    case 'K':
      return { action: 'previous' }
    default: {
      if (key.length !== 1) return { action: 'ignore' }
      const digit = Number(key)
      if (!Number.isInteger(digit) || digit < 1 || digit > requestCount) return { action: 'ignore' }
      return { action: 'select', index: digit - 1 }
    }
  }
}

function clampIndex(index: number, count: number): number {
  return Math.min(Math.max(index, 0), count - 1)
}
