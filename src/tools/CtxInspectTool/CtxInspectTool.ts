/**
 * CtxInspect — introspection for the context-collapse experiment.
 *
 * Reports the collapse store's committed/staged stats and, on request, the
 * projected message count (what the model would see if the current commit log
 * were replayed). Read-only: it never stages or commits a collapse.
 */

import { z } from 'zod/v4'

import { getStats, projectView } from '../../services/contextCollapse/operations.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    view: z.boolean().optional().describe('Also report the projected message count after collapses.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    stats: z.object({
      collapsedSpans: z.number(),
      collapsedMessages: z.number(),
      stagedSpans: z.number(),
      health: z.object({
        totalSpawns: z.number(),
        totalErrors: z.number(),
        lastError: z.string().nullable(),
        emptySpawnWarningEmitted: z.boolean(),
        totalEmptySpawns: z.number(),
      }),
    }),
    projectedMessages: z.number().optional(),
    currentMessages: z.number(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

export const CtxInspectTool = buildTool({
  name: 'CtxInspect',
  searchHint: 'inspect context collapse state',
  maxResultSizeChars: 10_000,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    // This module is only loaded under feature('CONTEXT_COLLAPSE').
    return true
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput() {
    return ''
  },
  renderToolUseMessage() {
    return 'Inspect context-collapse stats'
  },
  async description() {
    return 'Inspect the context-collapse store (committed spans, staged spans, health).'
  },
  async prompt() {
    return 'Report the context-collapse store: how many spans are committed, how many messages they replace, how many spans are staged, and spawn health. Pass view=true to also get the projected message count after replaying the commit log. Use this to understand what has already been collapsed before reasoning about context size.'
  },
  async call(input: z.infer<InputSchema>, context) {
    const stats = getStats()
    const data: Output = { stats, currentMessages: context.messages.length }
    if (input.view === true) {
      data.projectedMessages = projectView(context.messages).length
    }
    return { data }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const { stats } = output
    const lines = [
      `Committed spans: ${stats.collapsedSpans}`,
      `Messages replaced by committed spans: ${stats.collapsedMessages}`,
      `Staged spans: ${stats.stagedSpans}`,
      `Spawns/errors: ${stats.health.totalSpawns}/${stats.health.totalErrors}`,
    ]
    if (stats.health.lastError) lines.push(`Last error: ${stats.health.lastError}`)
    lines.push(`Current messages: ${output.currentMessages}`)
    if (output.projectedMessages !== undefined) {
      lines.push(`Projected messages: ${output.projectedMessages}`)
    }
    return { type: 'tool_result', tool_use_id: toolUseID, content: lines.join('\n') }
  },
} satisfies ToolDef<InputSchema, Output>)
