/**
 * Monitor — poll an MCP server's connection state for a bounded window.
 *
 * The upstream tool registers a `monitor_mcp` background task that follows a
 * server's state transitions until the user or agent stops it. This tree has
 * the task state type (tasks/MonitorMcpTask) but no spawn helper reachable
 * from a tool, so this version polls the live connection table in the tool
 * call, reports transitions, and returns. It is read-only and bounded, which
 * keeps it inside the foreground turn without wedging the loop.
 *
 * Approximations:
 * - Bounded to `duration_seconds` (default 30, max 600) instead of until-killed.
 * - Observes connection `type` transitions only; per-request MCP progress is
 *   reported through MCP progress callbacks, not this tool.
 */

import { z } from 'zod/v4'

import type { MCPServerConnection } from '../../services/mcp/types.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { sleep } from '../../utils/sleep.js'

const MAX_DURATION_SECONDS = 600
const POLL_INTERVAL_MS = 2000

const inputSchema = lazySchema(() =>
  z.strictObject({
    server: z.string().min(1).describe('MCP server name to watch (as shown in /mcp).'),
    duration_seconds: z
      .number()
      .min(1)
      .max(MAX_DURATION_SECONDS)
      .default(30)
      .describe(`How long to observe, in seconds (1–${MAX_DURATION_SECONDS}).`),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    server: z.string(),
    observations: z.array(
      z.object({
        at: z.number(),
        status: z.string(),
        detail: z.string().optional(),
      }),
    ),
    finalStatus: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

function describe(connection: MCPServerConnection | undefined): string {
  if (!connection) return 'missing'
  switch (connection.type) {
    case 'failed':
      return connection.error ? `failed: ${connection.error}` : 'failed'
    case 'pending':
      return 'pending'
    default:
      return connection.type
  }
}

export const MonitorTool = buildTool({
  name: 'Monitor',
  searchHint: 'watch an mcp server for state changes',
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
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return `Monitor ${input.server}`
  },
  renderToolUseMessage(input) {
    return `Monitor ${input.server} for ${input.duration_seconds ?? 30}s`
  },
  async description() {
    return 'Watch an MCP server connection state for a bounded window.'
  },
  async prompt() {
    return 'Watch an MCP server for a bounded period and report its connection transitions (pending, connected, needs-auth, failed, disabled). Use it when a server appears unhealthy or when a reconnection is expected, then act on the final status. Do not use it as a generic wait — prefer Sleep when there is nothing to observe.'
  },
  async call(input, context) {
    const deadline = Date.now() + input.duration_seconds * 1000
    const signal = context.abortController.signal
    const observations: Output['observations'] = []
    let lastName: string | undefined

    while (true) {
      const connection = context.options.mcpClients.find((c) => c.name === input.server)
      const status = describe(connection)
      if (status !== lastName) {
        observations.push({
          at: Date.now(),
          status: connection?.type ?? 'missing',
          detail: status === connection?.type ? undefined : status,
        })
        lastName = status
      }
      const remaining = deadline - Date.now()
      if (remaining <= 0 || signal.aborted) break
      await sleep(Math.min(POLL_INTERVAL_MS, remaining), signal)
    }

    return {
      data: {
        server: input.server,
        observations,
        finalStatus: lastName ?? 'missing',
      },
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    if (output.observations.length === 0) {
      return {
        type: 'tool_result',
        tool_use_id: toolUseID,
        content: `No state observed for ${output.server}.`,
      }
    }
    const lines = output.observations.map(
      (o) => `${new Date(o.at).toISOString()} ${o.status}${o.detail ? ` (${o.detail})` : ''}`,
    )
    lines.push(`Final status: ${output.finalStatus}`)
    return { type: 'tool_result', tool_use_id: toolUseID, content: lines.join('\n') }
  },
} satisfies ToolDef<InputSchema, Output>)
