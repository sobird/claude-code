/**
 * Monitor — stream events from a long-running background script.
 *
 * Each stdout line becomes a notification in the conversation while the agent
 * keeps working. The script runs as a `local_bash` task with `kind: 'monitor'`
 * (so the background-task UI, TaskStop, and agent orphan-cleanup all apply),
 * and exits when the topline ends it, a timeout elapses, or TaskStop is called.
 */

import React from 'react'
import { z } from 'zod/v4'

import { TOOL_SUMMARY_MAX_LENGTH } from '../../constants/toolLimits.js'
import { SUMMARY_TAG, TASK_ID_TAG, TASK_NOTIFICATION_TAG } from '../../constants/xml.js'
import { Box, Text } from '../../ink.js'
import { killTask } from '../../tasks/LocalShellTask/killShellTasks.js'
import { spawnShellTask } from '../../tasks/LocalShellTask/LocalShellTask.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { bashToolHasPermission } from '../../tools/BashTool/bashPermissions.js'
import { shouldUseSandbox } from '../../tools/BashTool/shouldUseSandbox.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { enqueuePendingNotification } from '../../utils/messageQueueManager.js'
import { exec } from '../../utils/Shell.js'
import { truncate } from '../../utils/truncate.js'
import { escapeXml } from '../../utils/xml.js'

// Friendly budgets. Timeout defaults to 5 min; persistent monitors run until
// TaskStop or session end.
const MONITOR_MAX_TIMEOUT_MS = 3_600_000
const MONITOR_DEFAULT_TIMEOUT_MS = 300_000

// Event-rate protection: each stdout line becomes a chat message, so cap how
// fast we emit. Token bucket of 10 with one token per 2s; when the bucket is
// empty we suppress-and-count, and if output stays over budget for 30s the
// monitor stops itself so it can't flood the conversation.
const MONITOR_TOKEN_CAPACITY = 10
const MONITOR_REFILL_MS = 2_000
const MONITOR_OVERRUN_WINDOW_MS = 30_000

// Batching: lines within 200ms fold into one notification. Single lines are
// truncated at 500 chars; a batch is truncated at 3000. The pre-newline buffer
// is capped at 1 MiB so a command that never emits a newline can't grow it.
const MONITOR_FLUSH_MS = 200
const MONITOR_LINE_MAX = 500
const MONITOR_BATCH_MAX = 3_000
const MONITOR_BUFFER_MAX = 1_048_576

const MONITOR_PROMPT = `Start a background monitor that streams events from a long-running script. Each stdout line is an event — you keep working and notifications arrive in the chat. Events arrive on their own schedule and are not replies from the user, even if one lands while you're waiting for the user to answer a question.

Monitor is for the **streaming** case: "tell me every time X happens." For one-shot "wait until X is done," use Bash with run_in_background instead — you'll get a completion notification when it exits.

Your script's stdout is the event stream. Each line becomes a notification. Exit ends the watch.

  # Each matching log line is an event
  tail -f /var/log/app.log | grep --line-buffered "ERROR"

  # Each file change is an event
  inotifywait -m --format '%e %f' /watched/dir

  # Poll GitHub for new PR comments and emit one line per new comment
  last=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  while true; do
    now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    gh api "repos/owner/repo/issues/123/comments?since=$last" --jq '.[] | "\\(.user.login): \\(.body)"'
    last=$now; sleep 30
  done

  # Node script that emits events as they arrive (e.g. WebSocket listener)
  node watch-for-events.js

**Script quality:**
- Always use \`grep --line-buffered\` in pipes — without it, pipe buffering delays events by minutes.
- In poll loops, handle transient failures (\`curl ... || true\`) — one failed request shouldn't kill the monitor.
- Poll intervals: 30s+ for remote APIs (rate limits), 0.5-1s for local checks.
- Write a specific \`description\` — it appears in every notification ("errors in deploy.log" not "watching logs").
- Only stdout is the event stream. Stderr goes to the output file (readable via Read) but does not trigger notifications.

**Output volume**: Every stdout line becomes a message in the conversation, so write selective filters. Never pipe raw logs — use \`grep --line-buffered\`, \`awk\`, or a wrapper that only emits the events you care about. Redirect progress you don't need to \`>/dev/null\`. Monitors that produce too many events are automatically stopped; restart with a tighter filter if this happens.

Stdout lines within 200ms are batched into a single notification, so multiline output from a single event groups naturally.

The script runs in the same shell environment as Bash. Exit ends the watch (exit code is reported). Timeout → killed. Set \`persistent: true\` for session-length watches (PR monitoring, log tails) — the monitor runs until you call TaskStop or the session ends. Use TaskStop to cancel early.`

const inputSchema = lazySchema(() =>
  z
    .strictObject({
      description: z
        .string()
        .describe('Short human-readable description of what you are monitoring (shown in notifications).'),
      command: z.string().describe('Shell command or script. Each stdout line is an event; exit ends the watch.'),
      timeout_ms: z
        .number()
        .min(1000)
        .optional()
        .default(MONITOR_DEFAULT_TIMEOUT_MS)
        .describe(
          `Kill the monitor after this deadline. Default ${MONITOR_DEFAULT_TIMEOUT_MS}ms, max ${MONITOR_MAX_TIMEOUT_MS}ms. Ignored when persistent is true.`,
        ),
      persistent: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          'Run for the lifetime of the session (no timeout). Use for session-length watches like PR monitoring or log tails. Stop with TaskStop.',
        ),
    })
    .refine((v) => v.persistent || v.timeout_ms <= MONITOR_MAX_TIMEOUT_MS, {
      message: `timeout_ms must be ≤ ${MONITOR_MAX_TIMEOUT_MS}`,
      path: ['timeout_ms'],
    }),
)
type InputSchema = ReturnType<typeof inputSchema>
type Input = z.infer<InputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    taskId: z.string().describe('ID of the background monitor task.'),
    timeoutMs: z.number().describe('Timeout deadline in milliseconds (0 when persistent).'),
    persistent: z.boolean().optional().describe('No timeout — runs until TaskStop or session end.'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

const TOKEN_TAG = TASK_ID_TAG
const NOTIFICATION_TAG = TASK_NOTIFICATION_TAG
const SUMMARY = SUMMARY_TAG

/** One stdout event, surfaced to the conversation as a task notification. */
function emitMonitorEvent(description: string, eventText: string, taskId: string): void {
  const taskIdLine = taskId ? `\n<${TOKEN_TAG}>${escapeXml(taskId)}</${TOKEN_TAG}>` : ''
  const message = `<${NOTIFICATION_TAG}>${taskIdLine}
<${SUMMARY}>Monitor event: "${escapeXml(description)}"</${SUMMARY}>
<event>${escapeXml(eventText)}</event>
</${NOTIFICATION_TAG}>`
  enqueuePendingNotification({ value: message, mode: 'task-notification', priority: 'next' })
}

/** Refills one token per `refillMs`, capped at `capacity`. */
function createTokenBucket(capacity: number, refillMs: number): { tryConsume(): boolean } {
  let tokens = capacity
  let last = Date.now()
  return {
    tryConsume() {
      const now = Date.now()
      const refills = Math.floor((now - last) / refillMs)
      if (refills > 0) {
        tokens = Math.min(capacity, tokens + refills)
        last += refills * refillMs
      }
      if (tokens > 0) {
        tokens--
        return true
      }
      return false
    },
  }
}

/**
 * Splits streamed stdout into trimmed lines, batching them so several lines
 * arriving within the debounce window emit together.
 */
function createLineBatcher(emit: (text: string) => void): { onData(data: string): void; flush(final: boolean): void } {
  let pending = ''
  let batch: string[] = []
  let timer: ReturnType<typeof setTimeout> | null = null

  const clampLine = (line: string): string =>
    line.length > MONITOR_LINE_MAX ? `${line.slice(0, MONITOR_LINE_MAX)}...(truncated)` : line

  function flushBatch(final: boolean): void {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (final && pending.trim()) {
      batch.push(clampLine(pending.trim()))
      pending = ''
    }
    if (batch.length === 0) return
    let text = batch.join('\n')
    if (text.length > MONITOR_BATCH_MAX) text = `${text.slice(0, MONITOR_BATCH_MAX)}\n...(truncated)`
    batch = []
    emit(text)
  }

  return {
    onData(data) {
      pending += data
      if (pending.length > MONITOR_BUFFER_MAX) pending = pending.slice(-MONITOR_BUFFER_MAX)
      let newline = pending.indexOf('\n')
      while (newline !== -1) {
        const line = pending.slice(0, newline).trim()
        pending = pending.slice(newline + 1)
        if (line) batch.push(clampLine(line))
        newline = pending.indexOf('\n')
      }
      if (batch.length > 0 && !timer) timer = setTimeout(() => flushBatch(false), MONITOR_FLUSH_MS)
    },
    flush(final) {
      flushBatch(final)
    },
  }
}

async function startMonitor(
  command: string,
  input: Input,
  context: Parameters<ToolDef<InputSchema, Output>['call']>[1],
) {
  const { description, timeout_ms, persistent } = input
  const { abortController, getAppState, setAppState, toolUseId, agentId } = context
  const taskSetAppState = context.setAppStateForTasks ?? setAppState

  const taskRef = { id: '' }
  let suppressed = 0
  let lastEventAt: number | undefined
  let windowStart: number | undefined
  let stopped = false
  const bucket = createTokenBucket(MONITOR_TOKEN_CAPACITY, MONITOR_REFILL_MS)

  const batcher = createLineBatcher((text) => {
    if (stopped) return
    if (bucket.tryConsume()) {
      if (suppressed > 0) {
        emitMonitorEvent(
          description,
          `[${suppressed} events suppressed — output rate too high. Consider using TaskStop to restart this monitor with a more selective filter.]`,
          taskRef.id,
        )
        suppressed = 0
        if (lastEventAt !== undefined && Date.now() - lastEventAt > MONITOR_REFILL_MS * 3) windowStart = undefined
      }
      emitMonitorEvent(description, text, taskRef.id)
      return
    }
    suppressed++
    lastEventAt = Date.now()
    if (windowStart === undefined) windowStart = Date.now()
    if (Date.now() - windowStart > MONITOR_OVERRUN_WINDOW_MS) {
      stopped = true
      emitMonitorEvent(
        description,
        `[Monitor stopped — your script produced too much output (${suppressed} events suppressed over ${Math.round((Date.now() - windowStart) / 1000)}s). Write a new monitor command that filters more aggressively — pipe through grep --line-buffered, awk, or a wrapper script that only emits the specific events you need.]`,
        taskRef.id,
      )
      killTask(taskRef.id, taskSetAppState)
    }
  })

  const shellCommand = await exec(command, abortController.signal, 'bash', {
    preventCwdChanges: true,
    shouldUseSandbox: shouldUseSandbox({ command }),
    onStdout: batcher.onData,
  })

  const handle = await spawnShellTask(
    { command, description, shellCommand, toolUseId, agentId, kind: 'monitor' },
    { abortController, getAppState, setAppState: taskSetAppState },
  )
  taskRef.id = handle.taskId

  const timeoutHandle = persistent
    ? undefined
    : setTimeout(() => {
        if (stopped) return
        emitMonitorEvent(description, '[Monitor timed out — re-arm if needed.]', handle.taskId)
        killTask(handle.taskId, taskSetAppState)
      }, timeout_ms)

  void shellCommand.result.then(() => {
    if (timeoutHandle) clearTimeout(timeoutHandle)
    batcher.flush(true)
    stopped = true
  })

  return { data: { taskId: handle.taskId, timeoutMs: persistent ? 0 : timeout_ms, persistent } }
}

export const MonitorTool = buildTool({
  name: 'Monitor',
  searchHint: 'stream events from a background script as live notifications',
  shouldDefer: true,
  maxResultSizeChars: 10_000,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    // Loaded only under feature('MONITOR_TOOL').
    return true
  },
  isConcurrencySafe() {
    return true
  },
  userFacingName() {
    return 'Monitor'
  },
  toAutoClassifierInput(input) {
    return input.command
  },
  async description() {
    return MONITOR_PROMPT
  },
  async prompt() {
    return MONITOR_PROMPT
  },
  getToolUseSummary(input) {
    if (!input?.description) return null
    return truncate(input.description, TOOL_SUMMARY_MAX_LENGTH)
  },
  getActivityDescription(input) {
    return input?.description ? `Monitoring: ${input.description}` : 'Monitoring'
  },
  async checkPermissions(input, context) {
    return bashToolHasPermission({ command: input.command, description: input.description }, context)
  },
  renderToolUseMessage(input) {
    return input.description || null
  },
  renderToolResultMessage(output) {
    return (
      <Box>
        <Text>
          Monitor started{' '}
          <Text dimColor>
            · task {output.taskId} · {output.persistent ? 'persistent' : `timeout ${output.timeoutMs / 1000}s`}
          </Text>
        </Text>
      </Box>
    )
  },
  async call(input, context) {
    return startMonitor(input.command, input, context)
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `Monitor started (task ${output.taskId}, ${output.persistent ? 'persistent — runs until TaskStop or session end' : `timeout ${output.timeoutMs}ms`}). You will be notified on each event. Keep working — do not poll or sleep. Events may arrive while you are waiting for the user — an event is not their reply.`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
