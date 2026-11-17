import type { AssistantChunk } from './session-reducer'

/**
 * Text a user expects when copying an assistant reply: the prose only, with
 * thinking blocks and blank chunks left out.
 */
export function assistantCopyText(chunks: AssistantChunk[]): string {
  return chunks
    .filter((chunk) => chunk.type === 'message')
    .map((chunk) => chunk.text.trim())
    .filter(Boolean)
    .join('\n\n')
}
