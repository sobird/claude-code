/**
 * `/btw` side-question helpers shared by the composer, chat view, and gateway.
 *
 * Mirrors the CLI trigger (`src/utils/sideQuestion.ts`): `/btw` at the start of
 * the draft, case-insensitive, word boundary. The web client never sends the
 * command as a chat turn; it posts the question to the side-question route so a
 * forked agent answers against the current context without interrupting the
 * main turn.
 */

/** Official CLI trigger rule; `/btwfoo` is not a side question. */
const BTW_COMMAND = /^\/btw\b/i

/** Longest question forwarded to the bridge; a quick aside, not a prompt. */
export const MAX_SIDE_QUESTION_LENGTH = 4000

/** True when the draft starts with `/btw`, even if no question follows yet. */
export function isBtwCommand(text: string): boolean {
  return BTW_COMMAND.test(text)
}

/** The trimmed question after `/btw`, or null when this is not a side question with content. */
export function parseBtwCommand(text: string): string | null {
  if (!isBtwCommand(text)) return null
  const question = text.replace(BTW_COMMAND, '').trim()
  return question.length > 0 ? question : null
}
