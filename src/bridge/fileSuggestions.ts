import { generateFileSuggestions } from '../hooks/fileSuggestions.js'

/** How many paths a remote client (`@` completion) receives per query. */
export const SUGGESTION_LIMIT = 12

/** Longest query accepted from a remote client; the index caps much lower. */
const MAX_QUERY_LENGTH = 256

export interface FileSuggestionLike {
  displayText: string
}

/**
 * Collapse suggestion items to the path list remote clients render. Keeps the
 * CLI's ranking, drops empty and duplicate paths, and caps the list.
 */
export function toSuggestionPaths(items: readonly FileSuggestionLike[], limit = SUGGESTION_LIMIT): string[] {
  const paths: string[] = []
  const seen = new Set<string>()
  for (const item of items) {
    const path = typeof item.displayText === 'string' ? item.displayText.trim() : ''
    if (!path || seen.has(path)) continue
    seen.add(path)
    paths.push(path)
    if (paths.length >= limit) break
  }
  return paths
}

/**
 * Answer a `file_suggestions` control request from a remote client. Reuses the
 * TUI's project index (git-aware, progressively built), so the first call in a
 * large repo may return partial results until the background build finishes.
 */
export async function collectFileSuggestions(query: string, limit = SUGGESTION_LIMIT): Promise<string[]> {
  const items = await generateFileSuggestions(query.slice(0, MAX_QUERY_LENGTH), true)
  return toSuggestionPaths(items, limit)
}
