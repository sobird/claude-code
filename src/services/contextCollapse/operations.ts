/**
 * Context-collapse store and projection.
 *
 * Collapses are append-only commits: each records a span of session-stable
 * message uuids plus the summary that replaces it. `projectView` replays the
 * commit log over the REPL's full history on every entry, which is what makes
 * collapses persist across turns — the summary messages live here, not in the
 * transcript array.
 *
 * The upstream ctx-agent that produces staged spans is not part of this tree
 * (no spawner evidence in the bundle), so `staged` only gets populated by a
 * restored snapshot. Everything else — projection, stats, commit drain — works
 * off that state and stays inert until something stages a span.
 */

import { randomUUID } from 'node:crypto'
import type { UUID } from 'node:crypto'

import type { QuerySource } from '../../constants/querySource.js'
import type { ToolUseContext } from '../../Tool.js'
import type { ContextCollapseCommitEntry, ContextCollapseSnapshotEntry } from '../../types/logs.js'
import type { AssistantMessage, Message } from '../../types/message.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { recordContextCollapseCommit, recordContextCollapseSnapshot } from '../../utils/sessionStorage.js'

export interface ContextCollapseHealth {
  totalSpawns: number
  totalErrors: number
  lastError: string | null
  emptySpawnWarningEmitted: boolean
  totalEmptySpawns: number
}

export interface ContextCollapseStats {
  collapsedSpans: number
  collapsedMessages: number
  stagedSpans: number
  health: ContextCollapseHealth
}

export interface CollapseResult {
  messages: Message[]
}

export interface DrainResult {
  committed: number
  messages: Message[]
}

export type StagedSpan = {
  startUuid: string
  endUuid: string
  summary: string
  risk: number
  stagedAt: number
}

type CommittedCollapse = {
  collapseId: string
  summaryUuid: UUID
  summaryContent: string
  summary: string
  firstArchivedUuid: string
  lastArchivedUuid: string
  /** Filled lazily by projectView; null until the span is found. */
  archived: string[] | null
}

type CollapseStore = {
  commits: CommittedCollapse[]
  staged: StagedSpan[]
  armed: boolean
  lastSpawnTokens: number
  nextCollapseId: bigint
  health: ContextCollapseHealth
}

function createEmptyStore(): CollapseStore {
  return {
    commits: [],
    staged: [],
    armed: false,
    lastSpawnTokens: 0,
    nextCollapseId: 1n,
    health: {
      totalSpawns: 0,
      totalErrors: 0,
      lastError: null,
      emptySpawnWarningEmitted: false,
      totalEmptySpawns: 0,
    },
  }
}

let store = createEmptyStore()

const subscribers = new Set<() => void>()

function notify(): void {
  for (const callback of subscribers) {
    try {
      callback()
    } catch {
      // A subscriber throwing must not break a store mutation.
    }
  }
}

export function subscribe(callback: () => void): () => void {
  subscribers.add(callback)
  return () => {
    subscribers.delete(callback)
  }
}

export function getStats(): ContextCollapseStats {
  let collapsedMessages = 0
  for (const commit of store.commits) {
    collapsedMessages += commit.archived?.length ?? 0
  }
  return {
    collapsedSpans: store.commits.length,
    collapsedMessages,
    stagedSpans: store.staged.length,
    health: { ...store.health },
  }
}

function createSummaryMessage(commit: CommittedCollapse, first: Message): Message {
  const timestamp = (first as { timestamp?: unknown }).timestamp
  return {
    type: 'user',
    uuid: commit.summaryUuid,
    isMeta: true,
    timestamp: typeof timestamp === 'string' ? timestamp : new Date().toISOString(),
    message: { role: 'user', content: commit.summaryContent },
    snapshotFiles: [],
  }
}

/**
 * Replaces each committed span with its `<collapsed>` summary placeholder.
 * Commits whose endpoints are missing (already projected, or dropped by a
 * compact boundary) are skipped — the function is idempotent.
 */
export function projectView(messages: Message[]): Message[] {
  if (store.commits.length === 0) {
    return messages
  }

  const indexByUuid = new Map<string, number>()
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    if (message) indexByUuid.set(message.uuid, i)
  }

  const spans: { start: number; end: number; commit: CommittedCollapse }[] = []
  let coveredUntil = -1
  for (const commit of store.commits) {
    const start = indexByUuid.get(commit.firstArchivedUuid)
    const end = indexByUuid.get(commit.lastArchivedUuid)
    if (start === undefined || end === undefined || start > end || start <= coveredUntil) continue
    spans.push({ start, end, commit })
    coveredUntil = end
  }
  if (spans.length === 0) {
    return messages
  }

  const spanByStart = new Map(spans.map((span) => [span.start, span]))
  const projected: Message[] = []
  let i = 0
  while (i < messages.length) {
    const message = messages[i]
    if (message === undefined) break
    const span = spanByStart.get(i)
    if (span) {
      span.commit.archived = messages.slice(span.start, span.end + 1).map((m) => m.uuid)
      projected.push(createSummaryMessage(span.commit, message))
      i = span.end + 1
      continue
    }
    projected.push(message)
    i += 1
  }
  return projected
}

export async function applyCollapsesIfNeeded(
  messages: Message[],
  _toolUseContext: ToolUseContext,
  _querySource: QuerySource,
): Promise<CollapseResult> {
  return { messages: projectView(messages) }
}

/**
 * Withholds a 413 so the query loop can drain staged collapses before the
 * error surfaces. Only meaningful when something is actually staged.
 */
export function isWithheldPromptTooLong(
  message: Message,
  isPromptTooLongMessage: (msg: AssistantMessage) => boolean,
  _querySource: QuerySource,
): boolean {
  if (store.staged.length === 0) {
    return false
  }
  return isPromptTooLongMessage(message as AssistantMessage)
}

function allocateCollapseId(): string {
  const id = store.nextCollapseId.toString().padStart(16, '0')
  store.nextCollapseId += 1n
  return id
}

/**
 * Materializes every staged span into a commit and projects the result.
 * Persistence is fire-and-forget: losing a commit entry only loses collapse
 * state on resume, never the current turn's context.
 */
export function recoverFromOverflow(messages: Message[], _querySource: QuerySource): DrainResult {
  if (store.staged.length === 0) {
    return { committed: 0, messages }
  }

  const staged = store.staged
  store.staged = []

  for (const span of staged) {
    const collapseId = allocateCollapseId()
    const commit: CommittedCollapse = {
      collapseId,
      summaryUuid: randomUUID(),
      summaryContent: `<collapsed id="${collapseId}">${span.summary}</collapsed>`,
      summary: span.summary,
      firstArchivedUuid: span.startUuid,
      lastArchivedUuid: span.endUuid,
      archived: null,
    }
    store.commits.push(commit)
    void recordContextCollapseCommit(commit).catch((error: unknown) => {
      logForDebugging(`[contextCollapse] commit persist failed: ${errorMessage(error)}`)
    })
  }

  void recordContextCollapseSnapshot({
    staged: [],
    armed: store.armed,
    lastSpawnTokens: store.lastSpawnTokens,
  }).catch((error: unknown) => {
    logForDebugging(`[contextCollapse] snapshot persist failed: ${errorMessage(error)}`)
  })

  notify()
  return { committed: staged.length, messages: projectView(messages) }
}

export function resetContextCollapse(): void {
  store = createEmptyStore()
  notify()
}

export function initContextCollapse(): void {
  logForDebugging('[contextCollapse] initialized')
}

/** Rebuilds the commit log and staged queue from persisted entries. */
export function restoreFromEntries(
  commits: ContextCollapseCommitEntry[],
  snapshot: ContextCollapseSnapshotEntry | undefined,
): void {
  store = createEmptyStore()

  for (const entry of commits) {
    store.commits.push({
      collapseId: entry.collapseId,
      summaryUuid: entry.summaryUuid as UUID,
      summaryContent: entry.summaryContent,
      summary: entry.summary,
      firstArchivedUuid: entry.firstArchivedUuid,
      lastArchivedUuid: entry.lastArchivedUuid,
      archived: null,
    })
  }

  if (snapshot) {
    store.staged = snapshot.staged.map((span) => ({ ...span }))
    store.armed = snapshot.armed
    store.lastSpawnTokens = snapshot.lastSpawnTokens
  }

  // Reseed the id counter past the highest persisted id so new collapses
  // never collide with restored ones.
  let maxId = 0n
  for (const entry of commits) {
    try {
      const value = BigInt(entry.collapseId)
      if (value > maxId) maxId = value
    } catch {
      // Malformed id — ignore rather than fail the whole restore.
    }
  }
  store.nextCollapseId = maxId + 1n

  notify()
}
