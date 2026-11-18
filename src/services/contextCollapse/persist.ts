/**
 * Resume entry point for the context-collapse store.
 *
 * sessionRestore calls this unconditionally after loading a transcript —
 * including with empty entries — because the implementation resets the store
 * first. Without that reset, resuming into a session with no commits would
 * leave the previous session's commit log intact.
 */

export { restoreFromEntries } from './operations.js'
