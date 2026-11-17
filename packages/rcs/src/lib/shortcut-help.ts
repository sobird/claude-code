/**
 * Global policy for the keyboard-shortcut help dialog.
 *
 * `?` opens the dialog, but only when the user is not typing: inside an input
 * it is a literal character, and modified or IME keys belong to the browser or
 * the input method.
 */

export interface HelpShortcutInput {
  key: string
  inEditable: boolean
  hasModifier: boolean
  isComposing: boolean
}

export function isHelpShortcut({ key, inEditable, hasModifier, isComposing }: HelpShortcutInput): boolean {
  if (isComposing || hasModifier || inEditable) return false
  return key === '?'
}
