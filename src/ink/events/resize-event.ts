import type { TerminalEvent } from './terminal-event.js'

/**
 * Resize event dispatched to `onResize` handlers.
 *
 * No resize-specific payload exists yet, so handlers receive the base terminal
 * event (with propagation control).
 */
export type ResizeEvent = TerminalEvent
