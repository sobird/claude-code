/**
 * Snip tool — model-driven removal of specific messages from the conversation.
 *
 * The model references messages by the six-character ids injected into
 * API-bound user messages (see utils/messages.ts appendMessageTagToUserMessage).
 * The tool never edits the transcript array directly: it returns a marker
 * message through `newMessages`, which toolExecution appends. On the next loop
 * iteration snipCompactIfNeeded() folds every marker into a single
 * `snip_boundary`, and that boundary is what both resume and the model-facing
 * projection replay.
 *
 * Keeping the removal out-of-band is what makes it replayable: the boundary
 * carries the removed uuids, so a resumed session reconstructs the exact same
 * projection without re-running the model.
 */

import { randomUUID } from 'node:crypto'

import { z } from 'zod/v4'

import { buildTool, type ToolDef } from '../../Tool.js'
import type { SystemMessage } from '../../types/message.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { deriveShortMessageId } from '../../utils/messages.js'
import { SNIP_TOOL_NAME } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    message_ids: z
      .array(z.string().min(1))
      .min(1)
      .describe('Short message ids (the six characters after "id:" in the [id:...] tag) to remove.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    removedIds: z.array(z.string()),
    removedUuids: z.array(z.string()),
    unknownIds: z.array(z.string()),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

const PROMPT = `Remove earlier messages from the conversation by their [id:...] tags.

Use this to drop material that no longer matters — superseded logs, finished debugging output, or large tool results you have already extracted what you need from. Keep the recent work and anything you may still need.

The removal is applied at the start of the next turn. Summarize the salient points before removing a message you might refer to later.`

export const SnipTool = buildTool({
  name: SNIP_TOOL_NAME,
  searchHint: 'remove messages from context by id',
  maxResultSizeChars: 10_000,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    // This module is only loaded under feature('HISTORY_SNIP'), so the
    // presence of the tool is the gate. Returning true keeps
    // isSnipRuntimeEnabled() and the [id:] tags in sync with the schema.
    return true
  },
  async description() {
    return 'Remove specific messages from the conversation by their [id:...] tags.'
  },
  async prompt() {
    return PROMPT
  },
  isReadOnly() {
    return false
  },
  isDestructive() {
    return true
  },
  toAutoClassifierInput(input) {
    return `Snip ${input.message_ids.join(', ')}`
  },
  renderToolUseMessage(input) {
    const count = input.message_ids?.length ?? 0
    return `Snip ${count} message${count === 1 ? '' : 's'}`
  },
  async call(input, context) {
    // Map short ids back to message uuids. Only messages that are actually in
    // the current transcript qualify — stale ids from a compacted prefix have
    // nothing left to remove.
    const uuidById = new Map<string, string>()
    for (const message of context.messages) {
      uuidById.set(deriveShortMessageId(message.uuid), message.uuid)
    }

    const removedIds: string[] = []
    const removedUuids: string[] = []
    const unknownIds: string[] = []
    for (const id of input.message_ids) {
      const uuid = uuidById.get(id)
      if (uuid === undefined) {
        unknownIds.push(id)
      } else {
        removedIds.push(id)
        removedUuids.push(uuid)
      }
    }

    if (removedUuids.length === 0) {
      return { data: { removedIds, removedUuids, unknownIds } }
    }

    // SystemMessage carries an open index signature; snipCompact's getMarker
    // reads `snipMarker` from any system message.
    const marker: SystemMessage = {
      type: 'system',
      subtype: 'snip_marker',
      content: `Snipping ${removedIds.length} message${removedIds.length === 1 ? '' : 's'}`,
      level: 'info',
      isMeta: false,
      timestamp: new Date().toISOString(),
      uuid: randomUUID(),
      message: { role: 'system', content: `Snipping ${removedIds.join(', ')}` },
      snapshotFiles: [],
      snipMarker: { removedUuids },
    }

    return {
      data: { removedIds, removedUuids, unknownIds },
      newMessages: [marker],
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const lines: string[] = []
    if (output.removedIds.length > 0) {
      lines.push(
        `Removed ${output.removedIds.length} message${output.removedIds.length === 1 ? '' : 's'} (${output.removedIds.join(', ')}). The removal takes effect on the next turn.`,
      )
    }
    if (output.unknownIds.length > 0) {
      lines.push(`Unknown message ids (not in the current transcript): ${output.unknownIds.join(', ')}.`)
    }
    return { type: 'tool_result', tool_use_id: toolUseID, content: lines.join('\n') }
  },
} satisfies ToolDef<InputSchema, Output>)
