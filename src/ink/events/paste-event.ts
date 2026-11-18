import type { TerminalEvent } from './terminal-event.js'

/**
 * Paste event dispatched to `onPaste` / `onPasteCapture` handlers.
 *
 * No paste-specific payload exists yet, so handlers receive the base terminal
 * event (with propagation control).
 */
export type PasteEvent = TerminalEvent
