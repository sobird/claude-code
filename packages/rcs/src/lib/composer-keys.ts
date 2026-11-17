/**
 * Keyboard policy for the chat composer, extracted so it is testable without a DOM.
 *
 * Enter always sends — a message typed mid-turn is queued by the CLI print engine,
 * matching the TUI. Escape is the interrupt key while the agent is running.
 */

export type ComposerKeyAction = 'submit' | 'interrupt' | 'newline' | 'ignore'

export interface ComposerKeyInput {
  key: string
  shiftKey: boolean
  /** IME composition in progress; the key belongs to the input method, not the composer. */
  isComposing: boolean
  isLoading: boolean
}

export function resolveComposerKey({ key, shiftKey, isComposing, isLoading }: ComposerKeyInput): ComposerKeyAction {
  if (isComposing) return 'ignore'
  if (key === 'Enter') return shiftKey ? 'newline' : 'submit'
  if (key === 'Escape' && isLoading) return 'interrupt'
  return 'ignore'
}

export type EditKeyAction = 'submit' | 'cancel' | 'newline' | 'ignore'

export interface EditKeyInput {
  key: string
  shiftKey: boolean
  /** IME composition in progress; the key belongs to the input method. */
  isComposing: boolean
}

/** Keyboard policy for the in-bubble message editor. */
export function resolveEditKey({ key, shiftKey, isComposing }: EditKeyInput): EditKeyAction {
  if (isComposing) return 'ignore'
  if (key === 'Enter') return shiftKey ? 'newline' : 'submit'
  if (key === 'Escape') return 'cancel'
  return 'ignore'
}
