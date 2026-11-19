/**
 * /force-snip — apply pending snip markers immediately.
 *
 * The Snip tool records `snipMarker` system messages carrying the uuids it
 * removed; snipCompactIfNeeded({ force: true }) folds those markers into a new
 * snip_boundary even when the runtime Snip tool is disabled. The rebuilt message
 * array is written back through setMessages so it survives the next turn.
 */

import { snipCompactIfNeeded, type SnipResult } from '../../services/compact/snipCompact.js'
import type { LocalCommandCall } from '../../types/command.js'
import type { Message } from '../../types/message.js'

export function forceSnip(messages: Message[]): SnipResult {
  return snipCompactIfNeeded(messages, { force: true })
}

export function formatForceSnipResult(result: SnipResult): string {
  if (!result.executed) return 'Nothing to snip — no snip markers are pending in this conversation.'
  return `Context snipped — ~${result.tokensFreed} tokens freed.`
}

export const call: LocalCommandCall = async (_args, context) => {
  const result = forceSnip(context.messages)
  if (result.executed) {
    context.setMessages(() => result.messages)
  }
  return { type: 'text', value: formatForceSnipResult(result) }
}
