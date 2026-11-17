/**
 * Keyboard shortcuts for the ExitPlanMode dialog.
 *
 * Only active while the dialog is open: A/Enter approve, D opens the rejection
 * form, Escape closes it. Everything else is left to Radix (which closes the
 * dialog on Escape) and to the focused control.
 */

export type PlanDialogAction = 'approve' | 'deny' | 'closeDeny'

export interface PlanDialogKeyInput {
  key: string
  /** The rejection textarea is visible. */
  denyOpen: boolean
  /** Focus is in a text field — the key belongs to typing. */
  inEditable?: boolean
  /** Focus is on a button; Enter already activates it. */
  onButton?: boolean
  /** IME composition in progress. */
  isComposing?: boolean
  /** Meta/Ctrl/Alt held — leave browser and OS shortcuts alone. */
  hasModifier?: boolean
}

export function resolvePlanDialogKey(input: PlanDialogKeyInput): PlanDialogAction | null {
  if (input.isComposing || input.hasModifier) return null

  if (input.denyOpen) return input.key === 'Escape' ? 'closeDeny' : null

  if (input.inEditable || input.onButton) return null
  if (input.key === 'Enter' || input.key === 'a' || input.key === 'A') return 'approve'
  if (input.key === 'd' || input.key === 'D') return 'deny'
  return null
}
