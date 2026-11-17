import type { ThreadEntry } from './session-reducer'

/**
 * Text of the most recent prompt in the thread. Feeds the composer's "edit"
 * action and the reply's "regenerate" action; both resend it as a new turn
 * because the bridge cannot rewind the CLI's conversation.
 */
export function latestPrompt(entries: ThreadEntry[]): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry.type === 'user_message' && entry.content.trim()) return entry.content
  }
  return null
}
