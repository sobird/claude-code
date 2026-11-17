/**
 * Prompt history for the composer's ArrowUp/ArrowDown recall, mirroring the TUI.
 *
 * Pure so it can be tested without a DOM; the component owns persistence and
 * the draft that is restored when navigating past the newest entry.
 */

export const HISTORY_LIMIT = 50

/** Records a successfully sent prompt, skipping blanks and consecutive repeats. */
export function appendHistory(history: readonly string[], text: string, limit = HISTORY_LIMIT): string[] {
  const trimmed = text.trim()
  if (!trimmed) return [...history]
  if (history[history.length - 1] === trimmed) return [...history]
  const next = [...history, trimmed]
  return next.length > limit ? next.slice(next.length - limit) : next
}

export interface HistoryMove {
  index: number | null
  text: string
}

/**
 * Moves through history. `index` is the currently recalled entry, or null when
 * the user is editing their draft. Up from the draft recalls the newest prompt;
 * down past the newest restores the draft. Returns null when the press should
 * fall through to normal cursor movement.
 */
export function moveHistory(
  history: readonly string[],
  index: number | null,
  delta: -1 | 1,
  draft: string,
): HistoryMove | null {
  if (history.length === 0) return null

  if (delta === -1) {
    const next = index === null ? history.length - 1 : Math.max(0, index - 1)
    return { index: next, text: history[next] ?? '' }
  }

  if (index === null) return null
  if (index >= history.length - 1) return { index: null, text: draft }
  return { index: index + 1, text: history[index + 1] ?? '' }
}
