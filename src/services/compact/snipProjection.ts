/**
 * Model-facing projection over the snip log.
 *
 * The REPL keeps the full history for scrollback; snip boundaries record the
 * uuids removed at execution time so both resume (sessionStorage) and the
 * model view can replay the exact removal. This module owns the read-time
 * projection: drop removed messages, the boundaries themselves, and any
 * internal markers that have not been compacted yet.
 *
 * Checks are structural (`snipMetadata` / `snipMarker`) rather than subtype
 * literals so the strings stay inside feature-gated modules.
 */

import type { Message } from '../../types/message.js'

type SnipMetadata = { removedUuids?: string[] }

function getSnipMetadata(message: Message): SnipMetadata | undefined {
  if (message.type !== 'system') return undefined
  const metadata = (message as { snipMetadata?: unknown }).snipMetadata
  return typeof metadata === 'object' && metadata !== null ? (metadata as SnipMetadata) : undefined
}

function isMarker(message: Message): boolean {
  return message.type === 'system' && (message as { snipMarker?: unknown }).snipMarker !== undefined
}

export function isSnipBoundaryMessage(message: Message): boolean {
  return getSnipMetadata(message) !== undefined
}

export function projectSnippedView(messages: Message[]): Message[] {
  const removed = new Set<string>()
  let sawBoundary = false
  for (const message of messages) {
    const metadata = getSnipMetadata(message)
    if (metadata === undefined) continue
    sawBoundary = true
    for (const uuid of metadata.removedUuids ?? []) {
      removed.add(uuid)
    }
  }

  if (!sawBoundary) {
    return messages
  }
  return messages.filter(
    (message) => !removed.has(message.uuid) && getSnipMetadata(message) === undefined && !isMarker(message),
  )
}
