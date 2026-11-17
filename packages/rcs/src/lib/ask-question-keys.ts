/**
 * Keyboard mapping for an AskUserQuestion card. It is only consulted while focus
 * is inside the card: editable targets (the free-text "Other" field) keep their
 * own keys, and modified keys are left to the browser.
 */

export type AskQuestionKeyAction =
  | { action: 'select'; index: number }
  | { action: 'next-question' }
  | { action: 'prev-question' }
  | { action: 'next-option' }
  | { action: 'prev-option' }
  | { action: 'submit' }
  | { action: 'decline' }
  | { action: 'ignore' }

export interface AskQuestionKeyInput {
  key: string
  optionCount: number
  inEditable: boolean
  isComposing: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}

export function resolveAskQuestionKey(input: AskQuestionKeyInput): AskQuestionKeyAction {
  if (input.isComposing || input.inEditable) return { action: 'ignore' }
  if (input.ctrlKey || input.metaKey || input.altKey) return { action: 'ignore' }

  if (input.key.length === 1 && input.key >= '1' && input.key <= '9') {
    const index = input.key.charCodeAt(0) - '1'.charCodeAt(0)
    return index < input.optionCount ? { action: 'select', index } : { action: 'ignore' }
  }

  switch (input.key) {
    case 'ArrowLeft':
      return { action: 'prev-question' }
    case 'ArrowRight':
      return { action: 'next-question' }
    case 'ArrowUp':
      return { action: 'prev-option' }
    case 'ArrowDown':
      return { action: 'next-option' }
    case 'Enter':
      return { action: 'submit' }
    case 'Escape':
      return { action: 'decline' }
    default:
      return { action: 'ignore' }
  }
}
