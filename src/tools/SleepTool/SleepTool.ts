/**
 * Sleep tool — cooperative wait used in proactive mode.
 *
 * Unlike `Bash(sleep ...)` this holds no shell process, is interruptible by
 * the abort signal, and wakes early when the command queue gains work (an
 * inbound message, a queued prompt, a channel push). The main loop keeps the
 * process responsive while the model has "nothing to do".
 */

import { z } from 'zod/v4'

import { isProactiveActive } from '../../proactive/index.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { hasCommandsInQueue } from '../../utils/messageQueueManager.js'
import { sleep } from '../../utils/sleep.js'
import { DESCRIPTION, SLEEP_TOOL_NAME, SLEEP_TOOL_PROMPT } from './prompt.js'

/** How often the wake conditions are re-checked. */
const POLL_INTERVAL_MS = 1000
/** Upper bound so a single call can never wedge the loop indefinitely. */
const MAX_DURATION_SECONDS = 3600

const inputSchema = lazySchema(() =>
  z.strictObject({
    duration_seconds: z
      .number()
      .min(0)
      .max(MAX_DURATION_SECONDS)
      .describe(`How long to wait, in seconds (0–${MAX_DURATION_SECONDS}).`),
    reason: z.string().optional().describe('Optional short note on what you are waiting for.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    sleptMs: z.number(),
    wokenBy: z.enum(['timeout', 'command', 'abort']),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

export const SleepTool = buildTool({
  name: SLEEP_TOOL_NAME,
  searchHint: 'wait or rest for a duration',
  maxResultSizeChars: 1_000,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    return isProactiveActive()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  interruptBehavior() {
    // A new user message cancels the wait rather than queuing behind it.
    return 'cancel'
  },
  toAutoClassifierInput(input) {
    return `Sleep ${input.duration_seconds}s`
  },
  renderToolUseMessage(input) {
    return `Sleep ${input.duration_seconds ?? 0}s${input.reason ? ` (${input.reason})` : ''}`
  },
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return SLEEP_TOOL_PROMPT
  },
  async call(input, context) {
    const startedAt = Date.now()
    const deadline = startedAt + input.duration_seconds * 1000
    const signal = context.abortController.signal

    let wokenBy: Output['wokenBy'] = 'timeout'
    while (true) {
      if (signal.aborted) {
        wokenBy = 'abort'
        break
      }
      if (hasCommandsInQueue()) {
        wokenBy = 'command'
        break
      }
      const remaining = deadline - Date.now()
      if (remaining <= 0) break
      await sleep(Math.min(POLL_INTERVAL_MS, remaining), signal)
    }

    return { data: { sleptMs: Date.now() - startedAt, wokenBy } }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const message =
      output.wokenBy === 'command'
        ? 'Woke early: new work arrived in the queue.'
        : output.wokenBy === 'abort'
          ? 'Sleep interrupted.'
          : 'Slept for the requested duration.'
    return { type: 'tool_result', tool_use_id: toolUseID, content: `${message} (${output.sleptMs}ms)` }
  },
} satisfies ToolDef<InputSchema, Output>)
