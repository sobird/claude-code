/**
 * Periodic mid-turn task summaries for `claude ps`.
 *
 * Forks the main conversation every ~5 steps / 2 minutes and asks for a short
 * present-tense description of what the agent is doing right now. The result
 * is appended to the transcript and pushed to external metadata so `claude ps`
 * can show live progress instead of the last user prompt ("ok go").
 */

import type { UUID } from 'node:crypto'

import { getSessionId } from '../bootstrap/state.js'
import type { CanUseToolFn } from '../hooks/useCanUseTool.js'
import type { Message } from '../types/message.js'
import { logForDebugging } from './debug.js'
import { type CacheSafeParams, runForkedAgent } from './forkedAgent.js'
import { logError } from './log.js'
import { createUserMessage } from './messages.js'
import { notifySessionMetadataChanged } from './sessionState.js'
import { saveTaskSummary } from './sessionStorage.js'

/** Fire a summary at whichever comes first: this many steps or this interval. */
const MIN_STEPS_BETWEEN_SUMMARIES = 5
const MIN_INTERVAL_MS = 2 * 60_000

const SUMMARY_PROMPT = `Describe the task you are currently working on in 5-12 words, present tense (-ing). Name the file or function when relevant. Do not use tools. Reply with the phrase only.

Good: "Reading runAgent.ts"
Good: "Fixing null check in validate.ts"
Good: "Adding retry logic to fetchUser"
Bad (past tense): "Analyzed the branch diff"
Bad (too vague): "Working on the task"`

let stepsSinceLastSummary = 0
let lastSummaryAt = Date.now()
let inFlight = false

/**
 * Called once per tool-result turn. Doubles as the step counter: every call
 * advances the step budget, and we return true when enough steps or enough
 * wall-clock time has passed since the last summary.
 */
export function shouldGenerateTaskSummary(): boolean {
  if (inFlight) {
    return false
  }
  stepsSinceLastSummary += 1
  return stepsSinceLastSummary >= MIN_STEPS_BETWEEN_SUMMARIES || Date.now() - lastSummaryAt >= MIN_INTERVAL_MS
}

function extractSummary(messages: Message[]): string | null {
  // Last assistant text wins — earlier ones may be pre-tool chatter.
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.type !== 'assistant') {
      continue
    }
    const content = message.message.content
    if (!Array.isArray(content)) {
      continue
    }
    const block = content.find((candidate) => candidate.type === 'text')
    if (block?.type === 'text' && block.text.trim().length > 0) {
      return block.text.trim().slice(0, 200)
    }
  }
  return null
}

async function generateTaskSummary(cacheSafeParams: CacheSafeParams): Promise<void> {
  // Deny tools via the callback rather than tools:[] — an empty tool list
  // would change the cache key and defeat prompt-cache sharing with the parent.
  const canUseTool: CanUseToolFn = async () => ({
    behavior: 'deny' as const,
    message: 'No tools needed for task summary',
    decisionReason: { type: 'other' as const, reason: 'summary only' },
  })

  const result = await runForkedAgent({
    promptMessages: [createUserMessage({ content: SUMMARY_PROMPT })],
    cacheSafeParams,
    canUseTool,
    querySource: 'agent_summary',
    forkLabel: 'task_summary',
    skipTranscript: true,
  })

  const summary = extractSummary(result.messages)
  if (summary === null) {
    logForDebugging('[TaskSummary] fork produced no text')
    return
  }

  saveTaskSummary(getSessionId() as UUID, summary)
  notifySessionMetadataChanged({ task_summary: summary })
  logForDebugging(`[TaskSummary] ${summary}`)
}

/**
 * Fire-and-forget summary generation. Resets the step/time budget immediately
 * so concurrent turns don't stack up forks; `inFlight` keeps at most one
 * summary outstanding at a time.
 */
export function maybeGenerateTaskSummary(options: CacheSafeParams): void {
  stepsSinceLastSummary = 0
  lastSummaryAt = Date.now()
  inFlight = true
  void generateTaskSummary(options)
    .catch((error: unknown) => {
      logError(error)
    })
    .finally(() => {
      inFlight = false
    })
}
