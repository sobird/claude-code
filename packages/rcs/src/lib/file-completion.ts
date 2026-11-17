/**
 * `@` file-reference completion for the composer.
 *
 * The token under the caret decides both the query sent to the bridge and the slice that an
 * accepted suggestion replaces. Only the text before the caret is considered, so a caret
 * parked mid-message behaves like the TUI's.
 */

export interface FileQueryToken {
  /** Index of the `@`. */
  start: number
  /** Caret position; the suggestion replaces `[start, end)`. */
  end: number
  /** Path fragment after `@` (or after the opening quote). */
  query: string
}

const QUOTE = '"'

/**
 * Return the `@` token under the caret, or null. A token must start a word (preceded by
 * whitespace or the start of the text) and may not contain whitespace unless it was opened
 * with `@"` — the quoting form used to reference paths with spaces.
 */
export function fileQuery(text: string, caret: number = text.length): FileQueryToken | null {
  const end = Math.max(0, Math.min(caret, text.length))
  let i = end - 1
  while (i >= 0) {
    if (text[i] === '@' && (i === 0 || /\s/.test(text[i - 1]))) {
      const rest = text.slice(i + 1, end)
      if (rest.startsWith(QUOTE)) {
        const inner = rest.slice(1)
        // A closing quote means the reference is already complete.
        if (inner.includes(QUOTE)) return null
        return { start: i, end, query: inner }
      }
      if (/\s/.test(rest)) return null
      return { start: i, end, query: rest }
    }
    i--
  }
  return null
}

/**
 * Replace a token with a suggestion, appending a trailing space so the completion menu
 * does not reopen on the result. Paths containing whitespace use the `@"…"` form.
 */
export function applyFileSuggestion(
  text: string,
  token: FileQueryToken,
  path: string,
): { text: string; caret: number } {
  const reference = /\s/.test(path) ? `@${QUOTE}${path}${QUOTE}` : `@${path}`
  const next = `${text.slice(0, token.start)}${reference} ${text.slice(token.end)}`
  return { text: next, caret: token.start + reference.length + 1 }
}
