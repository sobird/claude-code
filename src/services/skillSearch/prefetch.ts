/**
 * Skill-discovery attachment producer.
 *
 * Two entry points:
 * - `getTurnZeroSkillDiscovery` blocks on the user's opening input (the only
 *   signal with no prior work to hide the lookup under).
 * - `startSkillDiscoveryPrefetch` runs on each query iteration and fires only
 *   when the latest assistant turn wrote a file — the write path is the
 *   intent signal that the model is about to need a skill for that area.
 *
 * Both share a keyword index (localSearch) and suppress skills already
 * surfaced this session via `ToolUseContext.discoveredSkillNames`.
 */

import type { ToolUseContext } from '../../Tool.js'
import { FILE_EDIT_TOOL_NAME } from '../../tools/FileEditTool/constants.js'
import { FILE_WRITE_TOOL_NAME } from '../../tools/FileWriteTool/prompt.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from '../../tools/NotebookEditTool/constants.js'
import type { Command } from '../../types/command.js'
import type { Message } from '../../types/message.js'
import type { Attachment } from '../../utils/attachments.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { searchSkills } from './localSearch.js'

const WRITE_TOOL_NAMES = new Set<string>([FILE_EDIT_TOOL_NAME, FILE_WRITE_TOOL_NAME, NOTEBOOK_EDIT_TOOL_NAME])

/** Write pivots already turned into a discovery pass this session. */
const consumedWritePivots = new Set<string>()

type WritePivot = {
  toolUseId: string
  filePath: string
}

function getFilePathFromInput(input: unknown): string | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null
  const filePath = (input as Record<string, unknown>).file_path
  return typeof filePath === 'string' && filePath.length > 0 ? filePath : null
}

/** Newest assistant tool_use that wrote a file, if any. */
function findWritePivot(messages: Message[]): WritePivot | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!message || message.type !== 'assistant') continue
    const content = message.message.content
    if (!Array.isArray(content)) continue
    for (let j = content.length - 1; j >= 0; j--) {
      const block = content[j]
      if (!block || block.type !== 'tool_use' || !WRITE_TOOL_NAMES.has(block.name)) continue
      const filePath = getFilePathFromInput(block.input)
      if (filePath !== null) {
        return { toolUseId: block.id, filePath }
      }
    }
  }
  return null
}

async function getMcpSkills(context: ToolUseContext): Promise<readonly Command[]> {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { getMcpSkillCommands } = require('../../commands.js') as typeof import('../../commands.js')
  /* eslint-enable @typescript-eslint/no-require-imports */
  return getMcpSkillCommands(context.getAppState().mcp.commands)
}

async function buildSkillDiscoveryAttachment(
  query: string,
  context: ToolUseContext,
  signal: string,
): Promise<Attachment | null> {
  if (query.trim().length === 0) {
    return null
  }
  const matches = await searchSkills(query, await getMcpSkills(context))
  if (matches.length === 0) {
    return null
  }

  const discovered = context.discoveredSkillNames ?? new Set<string>()
  const fresh = matches.filter((command) => !discovered.has(command.name))
  if (fresh.length === 0) {
    return null
  }
  for (const command of fresh) {
    discovered.add(command.name)
  }
  context.discoveredSkillNames = discovered

  return {
    type: 'skill_discovery',
    skills: fresh.map((command) => ({ name: command.name, description: command.description })),
    signal,
    source: 'native',
  }
}

/**
 * Turn-zero discovery: blocks on the user's input. `messages` is accepted for
 * signature parity with the caller but not needed — the input is the signal.
 */
export async function getTurnZeroSkillDiscovery(
  input: string,
  _messages: Message[],
  context: ToolUseContext,
): Promise<Attachment | null> {
  try {
    return await buildSkillDiscoveryAttachment(input, context, 'user_input')
  } catch (error) {
    logForDebugging(`[skillSearch] turn-zero discovery failed: ${errorMessage(error)}`)
    return null
  }
}

/**
 * Per-iteration prefetch. With a non-null `input` this behaves like turn-zero
 * discovery; otherwise it fires only for the first observation of a write
 * pivot. Never throws — resolves to an empty list on any failure.
 */
export async function startSkillDiscoveryPrefetch(
  input: string | null,
  messages: Message[],
  context: ToolUseContext,
): Promise<Attachment[]> {
  if (input !== null) {
    const attachment = await getTurnZeroSkillDiscovery(input, messages, context)
    return attachment === null ? [] : [attachment]
  }

  const pivot = findWritePivot(messages)
  if (pivot === null || consumedWritePivots.has(pivot.toolUseId)) {
    return []
  }
  consumedWritePivots.add(pivot.toolUseId)

  try {
    const attachment = await buildSkillDiscoveryAttachment(pivot.filePath, context, 'write_pivot')
    return attachment === null ? [] : [attachment]
  } catch (error) {
    logForDebugging(`[skillSearch] write-pivot discovery failed: ${errorMessage(error)}`)
    return []
  }
}

export async function collectSkillDiscoveryPrefetch(pending: Promise<Attachment[]>): Promise<Attachment[]> {
  try {
    return await pending
  } catch (error) {
    logForDebugging(`[skillSearch] prefetch collection failed: ${errorMessage(error)}`)
    return []
  }
}
