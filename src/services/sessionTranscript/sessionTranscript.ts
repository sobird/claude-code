/**
 * Assistant-mode session transcript segments (KAIROS).
 *
 * In assistant mode the agent appends a human-readable log to a date-named
 * file under the auto-memory directory as it works, and a nightly /dream
 * skill distills those logs. This module owns the append side: it buckets
 * unwritten messages by their own timestamp and appends one markdown segment
 * per day, deduplicating by message uuid so repeated calls with the full
 * history are cheap.
 *
 * Everything is fire-and-forget; a write failure must never disturb the turn.
 */

import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import { isAssistantMode } from '../../assistant/index.js'
import { getAutoMemDailyLogPath } from '../../memdir/paths.js'
import type { AssistantMessage, Message, UserMessage } from '../../types/message.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'

/** Cap tracked uuids so a long session can't grow this set forever. */
const MAX_TRACKED_UUIDS = 10_000
/** Per-message text cap; the logs are an index, not a full transcript. */
const MAX_SEGMENT_CHARS = 2_000

const writtenUuids = new Set<string>()
let lastFlushedDate: string | null = null

function getTimestamp(message: Message): number | null {
  const timestamp = (message as { timestamp?: unknown }).timestamp
  if (typeof timestamp !== 'string') return null
  const parsed = Date.parse(timestamp)
  return Number.isNaN(parsed) ? null : parsed
}

function extractText(message: AssistantMessage | UserMessage): string | null {
  const content = message.message.content
  if (typeof content === 'string') {
    const trimmed = content.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  if (!Array.isArray(content)) return null
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text' && block.text.trim().length > 0) {
      parts.push(block.text.trim())
    }
  }
  return parts.length > 0 ? parts.join('\n') : null
}

function formatEntry(date: Date, role: string, text: string): string {
  const hh = date.getHours().toString().padStart(2, '0')
  const mm = date.getMinutes().toString().padStart(2, '0')
  const body = text.length > MAX_SEGMENT_CHARS ? `${text.slice(0, MAX_SEGMENT_CHARS)}…` : text
  return `\n## ${hh}:${mm}\n\n**${role}**\n\n${body}\n`
}

function pruneWrittenUuids(): void {
  if (writtenUuids.size <= MAX_TRACKED_UUIDS) return
  // Dropping the set risks re-appending messages still present in the array,
  // but an unbounded set is worse; nightly distillation tolerates duplicates.
  writtenUuids.clear()
}

async function appendSegment(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, content, 'utf8')
}

/**
 * Appends any messages not yet written to the matching daily log. Safe to
 * call with the full conversation on every turn.
 */
export function writeSessionTranscriptSegment(messages: Message[]): void {
  if (!isAssistantMode()) return

  const pendingByPath = new Map<string, string[]>()
  for (const message of messages) {
    if (writtenUuids.has(message.uuid)) continue
    writtenUuids.add(message.uuid)

    // Meta messages are system scaffolding, not work worth distilling.
    if (message.isMeta) continue
    if (message.type !== 'user' && message.type !== 'assistant') continue

    const timestamp = getTimestamp(message)
    if (timestamp === null) continue
    const text = extractText(message)
    if (text === null) continue

    const date = new Date(timestamp)
    const path = getAutoMemDailyLogPath(date)
    const lines = pendingByPath.get(path) ?? []
    lines.push(formatEntry(date, message.type, text))
    pendingByPath.set(path, lines)
  }
  pruneWrittenUuids()

  for (const [path, lines] of pendingByPath) {
    void appendSegment(path, lines.join('')).catch((error: unknown) => {
      logForDebugging(`[sessionTranscript] append failed: ${errorMessage(error)}`)
    })
  }
}

/**
 * Forces a flush when the day rolls over mid-session. Message timestamps do
 * the actual bucketing, so a multi-day gap already writes each day into its
 * own file — this just avoids redundant scans within the same day.
 */
export function flushOnDateChange(messages: Message[], currentDate: string): void {
  if (!isAssistantMode()) return
  if (lastFlushedDate === currentDate) return
  lastFlushedDate = currentDate
  writeSessionTranscriptSegment(messages)
}
