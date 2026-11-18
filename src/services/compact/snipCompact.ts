/**
 * HISTORY_SNIP compaction pass and pacing.
 *
 * The Snip tool lets the model remove specific messages by their [id:...]
 * tags. Each execution records a boundary carrying the removed uuids so both
 * resume (sessionStorage's applySnipRemovals) and the model-facing projection
 * (snipProjection) can replay the exact removal.
 *
 * When the runtime tool is disabled (SnipTool.isEnabled() === false), every
 * path here is inert — the boundary and nudge strings are harmless because
 * nothing ever produces a marker to trigger them.
 */

import { randomUUID } from 'node:crypto'

import type { Message } from '../../types/message.js'
import { tokenCountWithEstimation } from '../../utils/tokens.js'
import { roughTokenCountEstimationForMessages } from '../tokenEstimation.js'

/** Nudge the model toward Snip after this much token growth since a reset. */
const NUDGE_INTERVAL_TOKENS = 10_000

export const SNIP_NUDGE_TEXT =
  'Context is growing. If earlier messages are no longer needed — superseded logs, finished debugging, or large tool outputs you have already used — call the Snip tool with their [id:...] tags to remove them from the conversation. Keep recent work intact.'

type SnipMetadata = { removedUuids?: string[] }
type SnipMarker = { removedUuids?: string[] }

function getBoundaryMetadata(message: Message): SnipMetadata | undefined {
  if (message.type !== 'system') return undefined
  const metadata = (message as { snipMetadata?: unknown }).snipMetadata
  return typeof metadata === 'object' && metadata !== null ? (metadata as SnipMetadata) : undefined
}

function getMarker(message: Message): SnipMarker | undefined {
  if (message.type !== 'system') return undefined
  const marker = (message as { snipMarker?: unknown }).snipMarker
  return typeof marker === 'object' && marker !== null ? (marker as SnipMarker) : undefined
}

export function isSnipMarkerMessage(message: Message): boolean {
  return getMarker(message) !== undefined
}

/**
 * Truth mirrored from SnipTool.isEnabled() — the [id:] tags and the nudge
 * must never appear when the tool isn't in the schema.
 */
export function isSnipRuntimeEnabled(): boolean {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { SnipTool } = require('../../tools/SnipTool/SnipTool.js') as typeof import('../../tools/SnipTool/SnipTool.js')
  /* eslint-enable @typescript-eslint/no-require-imports */
  return SnipTool.isEnabled()
}

export type SnipResult = {
  messages: Message[]
  executed: boolean
  tokensFreed: number
  boundaryMessage?: Message
}

/**
 * Applies pending snips (markers) or rebuilds the boundary on `force`.
 *
 * Markers and prior boundaries are always dropped from the surviving array —
 * they're control records, not conversation. The removed set is cumulative:
 * a new boundary records everything this pass and every prior boundary
 * removed, so a single resume replay reproduces the full projection.
 */
export function snipCompactIfNeeded(messages: Message[], options?: { force?: boolean }): SnipResult {
  const force = options?.force === true
  if (!isSnipRuntimeEnabled() && !force) {
    return { messages, executed: false, tokensFreed: 0 }
  }

  const removed = new Set<string>()
  let markerCount = 0
  for (const message of messages) {
    const boundary = getBoundaryMetadata(message)
    if (boundary !== undefined) {
      for (const uuid of boundary.removedUuids ?? []) removed.add(uuid)
    }
    const marker = getMarker(message)
    if (marker !== undefined) {
      markerCount += 1
      for (const uuid of marker.removedUuids ?? []) removed.add(uuid)
    }
  }

  if (markerCount === 0 && removed.size === 0) {
    return { messages, executed: false, tokensFreed: 0 }
  }

  const tokensFreed = roughTokenCountEstimationForMessages(
    messages.filter((message) => removed.has(message.uuid)) as Parameters<
      typeof roughTokenCountEstimationForMessages
    >[0],
  )
  const kept = messages.filter(
    (message) =>
      !removed.has(message.uuid) && getBoundaryMetadata(message) === undefined && getMarker(message) === undefined,
  )

  const removedUuids = [...removed]
  const content = 'Context snipped'
  const boundary: Message = {
    type: 'system',
    subtype: 'snip_boundary',
    content,
    level: 'info',
    isMeta: false,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    message: { role: 'system', content },
    snapshotFiles: [],
    snipMetadata: { removedUuids, tokensFreed },
  }

  return {
    messages: [...kept, boundary],
    executed: true,
    tokensFreed,
    boundaryMessage: boundary,
  }
}

let baselineTokens: number | null = null
let lastResetUuid: string | null = null

function isResetMessage(message: Message): boolean {
  if (message.type === 'attachment' && message.attachment?.type === 'context_efficiency') {
    return true
  }
  if (getMarker(message) !== undefined || getBoundaryMetadata(message) !== undefined) {
    return true
  }
  return message.type === 'system' && (message as { compactMetadata?: unknown }).compactMetadata !== undefined
}

function findLastReset(messages: Message[]): { uuid: string } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message && isResetMessage(message)) {
      return { uuid: message.uuid }
    }
  }
  return null
}

/**
 * Nudges at most once per NUDGE_INTERVAL_TOKENS of growth. The baseline is
 * reset by prior nudges, snip markers/boundaries, and compact boundaries so
 * a fresh context window starts its own interval.
 */
export function shouldNudgeForSnips(messages: Message[]): boolean {
  if (!isSnipRuntimeEnabled()) {
    return false
  }
  const currentTokens = tokenCountWithEstimation(messages)

  const reset = findLastReset(messages)
  if (reset !== null && reset.uuid !== lastResetUuid) {
    lastResetUuid = reset.uuid
    baselineTokens = currentTokens
    return false
  }
  if (baselineTokens === null) {
    baselineTokens = currentTokens
    return false
  }
  if (currentTokens - baselineTokens >= NUDGE_INTERVAL_TOKENS) {
    baselineTokens = currentTokens
    return true
  }
  return false
}
