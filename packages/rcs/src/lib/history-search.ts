/**
 * Prompt-history search for the composer's Ctrl+R overlay. Results come back
 * newest-first (from the tail of the stored history), so the most recent match
 * is selected by default.
 */

export interface HistoryMatch {
  index: number
  text: string
}

/** Default number of matches returned. */
export const HISTORY_SEARCH_LIMIT = 20

export function searchHistory(history: readonly string[], query: string, limit = HISTORY_SEARCH_LIMIT): HistoryMatch[] {
  const cap = Math.max(0, limit)
  if (cap === 0) return []
  const needle = query.trim().toLowerCase()
  const matches: HistoryMatch[] = []
  for (let index = history.length - 1; index >= 0; index--) {
    const text = history[index]
    if (!text) continue
    if (needle && !text.toLowerCase().includes(needle)) continue
    matches.push({ index, text })
    if (matches.length >= cap) break
  }
  return matches
}
