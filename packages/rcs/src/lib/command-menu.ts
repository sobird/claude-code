/**
 * Slash-command autocomplete helpers for the chat composer.
 *
 * The CLI sends the bridge-safe command names in `system/init`. These are pure
 * string helpers so the menu's open/filter/navigate rules can be unit tested
 * without a DOM.
 */

/**
 * Query typed after a leading slash, or `null` when the menu must stay closed.
 *
 * The menu only opens for a slash-prefixed first token: anything with a space
 * before the caret (arguments, mid-text slashes) is ordinary text.
 */
export function commandQuery(text: string, caret?: number): string | null {
  const end = caret === undefined ? text.length : Math.max(0, Math.min(caret, text.length))
  const upto = text.slice(0, end)
  if (!upto.startsWith('/')) return null
  const token = upto.slice(1)
  if (/\s/.test(token)) return null
  return token
}

/** Strip a leading slash so names match whether or not they carry one. */
function bareName(command: string): string {
  return command.startsWith('/') ? command.slice(1) : command
}

/**
 * Case-insensitive prefix match against the command names, preserving the
 * CLI's order and dropping duplicates. An empty query shows the leading
 * entries up to `limit` (default 8).
 */
export function filterCommands(commands: string[], query: string, limit = 8): string[] {
  const needle = query.toLowerCase()
  const seen = new Set<string>()
  const results: string[] = []

  for (const command of commands) {
    const name = bareName(command)
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    if (needle && !key.startsWith(needle)) continue
    seen.add(key)
    results.push(command)
    if (results.length >= limit) break
  }

  return results
}

/** Move the highlighted index by `delta`, wrapping around; empty lists stay at 0. */
export function moveIndex(index: number, delta: number, length: number): number {
  if (length <= 0) return 0
  return (((index + delta) % length) + length) % length
}

/** Text to insert when a command is accepted; the trailing space closes the menu. */
export function acceptCommand(name: string): string {
  return `/${bareName(name)} `
}
