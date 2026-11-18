/**
 * REPL — run a JavaScript snippet that orchestrates the primitive tools.
 *
 * When REPL mode is on (ant-only), the primitive tools (Read/Edit/Write/Glob/
 * Grep/Bash/NotebookEdit/Agent) are hidden from direct model use. This tool is
 * the replacement: a single snippet that calls them as async functions in a VM
 * context, so batch work costs one tool round-trip instead of one per action.
 *
 * Every call still goes through `canUseTool` before the tool runs, so the REPL
 * is not a permission bypass — it is a different calling convention over the
 * same permission pipeline. The sandbox exposes only the tool wrappers (plus
 * `print`/`console`); no `process`, `require`, or host globals. `node:vm` is
 * not a security boundary on its own — the model already has Bash — but the
 * narrow surface keeps snippets honest and the timeout bounds infinite loops.
 *
 * Approximation: the upstream REPL keeps a persistent session across calls
 * (hence `REPLToolProgress.sessionId`). This implementation runs each snippet
 * in a fresh context and reports the process session id, so state must be
 * re-derived per call; files on disk are the durable channel between snippets.
 */

import { randomUUID } from 'node:crypto'
import { inspect } from 'node:util'
import * as vm from 'node:vm'

import { z } from 'zod/v4'

import { getSessionId } from '../../bootstrap/state.js'
import { buildTool, type ToolCallProgress, type ToolDef } from '../../Tool.js'
import type { REPLToolProgress } from '../../types/tools.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { AGENT_TOOL_NAME } from '../AgentTool/constants.js'
import { BASH_TOOL_NAME } from '../BashTool/toolName.js'
import { FILE_EDIT_TOOL_NAME } from '../FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from '../FileReadTool/prompt.js'
import { FILE_WRITE_TOOL_NAME } from '../FileWriteTool/prompt.js'
import { GLOB_TOOL_NAME } from '../GlobTool/prompt.js'
import { GREP_TOOL_NAME } from '../GrepTool/prompt.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from '../NotebookEditTool/constants.js'
import { REPL_TOOL_NAME, isReplModeEnabled } from './constants.js'
import { getReplPrimitiveTools } from './primitiveTools.js'

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 120_000
const MAX_LOGGED_CHARS = 10_000

const inputSchema = lazySchema(() =>
  z.strictObject({
    code: z
      .string()
      .min(1)
      .describe(
        'JavaScript to run. Await the tool helpers directly: read({file_path}), write({file_path, content}), edit({file_path, old_string, new_string}), glob({pattern}), grep({pattern, path}), bash({command}), notebookEdit(...), agent({prompt}). Use print(...) to emit output.',
      ),
    timeout_ms: z
      .number()
      .int()
      .min(1)
      .max(MAX_TIMEOUT_MS)
      .default(DEFAULT_TIMEOUT_MS)
      .describe('Bounded execution time for synchronous code.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    output: z.string(),
    toolCalls: z.number(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

function format(value: unknown): string {
  const text = typeof value === 'string' ? value : inspect(value, { depth: 4, breakLength: 120 })
  return text.length > MAX_LOGGED_CHARS ? `${text.slice(0, MAX_LOGGED_CHARS)}\n… (truncated)` : text
}

export const REPLTool = buildTool({
  name: REPL_TOOL_NAME,
  searchHint: 'run javascript to batch primitive tool calls',
  maxResultSizeChars: 100_000,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    return isReplModeEnabled()
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  toAutoClassifierInput(input) {
    // Classify on the first line only — snippets can be long.
    return `REPL ${input.code.split('\n', 1)[0] ?? ''}`
  },
  renderToolUseMessage(input) {
    const firstLine = input.code?.split('\n', 1)[0] ?? ''
    return `REPL: ${firstLine}`
  },
  async description() {
    return 'Run JavaScript that calls the file, search, shell, and agent tools.'
  },
  async prompt() {
    return 'Execute a JavaScript snippet that orchestrates the primitive tools. Each helper returns the tool result data: read({file_path, offset?, limit?}), write({file_path, content}), edit({file_path, old_string, new_string, replace_all?}), glob({pattern, path?}), grep({pattern, path?, glob?, output_mode?}), bash({command, timeout?}), notebookEdit({notebook_path, new_source, cell_id?, edit_mode?}), agent({prompt, description}). Use this for multi-step work that would otherwise need many separate tool calls; keep snippets focused, print the results you need, and remember each call starts with an empty context so persist anything you need to reuse via files.'
  },
  async call(input, context, canUseTool, parentMessage, onProgress?: ToolCallProgress<REPLToolProgress>) {
    const sessionId = getSessionId()
    const logs: string[] = []
    const history: Array<{ input: string; output: string }> = []
    let toolCalls = 0

    const print = (value: unknown): void => {
      logs.push(format(value))
    }

    const invoke = async (toolName: string, rawInput: Record<string, unknown>): Promise<unknown> => {
      const tool = getReplPrimitiveTools().find((t) => t.name === toolName)
      if (!tool) {
        throw new Error(`${toolName} is not available inside the REPL`)
      }
      const parsed = tool.inputSchema.safeParse(rawInput)
      if (!parsed.success) {
        throw new Error(`Invalid input for ${toolName}: ${parsed.error.message}`)
      }
      const toolUseID = randomUUID()
      const decision = await canUseTool(tool, parsed.data, context, parentMessage, toolUseID)
      if (decision.behavior !== 'allow') {
        const reason = decision.behavior === 'deny' ? decision.message : 'permission was not granted'
        throw new Error(`${toolName} was not allowed: ${reason}`)
      }
      toolCalls += 1
      const result = await tool.call(decision.updatedInput ?? parsed.data, context, canUseTool, parentMessage)
      const output = format(result.data)
      history.push({ input: `${toolName} ${format(rawInput)}`, output })
      onProgress?.({
        toolUseID: context.toolUseId ?? toolUseID,
        data: {
          type: 'repl_progress',
          sessionId,
          prompt: input.code.slice(0, 200),
          input: history.at(-1)?.input,
          output: history.at(-1)?.output,
          history: [...history],
        },
      })
      return result.data
    }

    const sandbox = {
      read: (args: { file_path: string; offset?: number; limit?: number }) => invoke(FILE_READ_TOOL_NAME, args),
      write: (args: { file_path: string; content: string }) => invoke(FILE_WRITE_TOOL_NAME, args),
      edit: (args: { file_path: string; old_string: string; new_string: string; replace_all?: boolean }) =>
        invoke(FILE_EDIT_TOOL_NAME, args),
      glob: (args: { pattern: string; path?: string }) => invoke(GLOB_TOOL_NAME, args),
      grep: (args: { pattern: string; path?: string; glob?: string; output_mode?: string }) =>
        invoke(GREP_TOOL_NAME, args),
      bash: (args: { command: string; timeout?: number }) => invoke(BASH_TOOL_NAME, args),
      notebookEdit: (args: { notebook_path: string; new_source: string; cell_id?: string; edit_mode?: string }) =>
        invoke(NOTEBOOK_EDIT_TOOL_NAME, args),
      agent: (args: { prompt: string; description?: string }) => invoke(AGENT_TOOL_NAME, args),
      print,
      console: { log: print, info: print, warn: print, error: print },
      Promise,
      JSON,
    }

    const abortSignal = context.abortController.signal
    let onAbort: (() => void) | undefined
    const aborted = new Promise<never>((_, reject) => {
      if (abortSignal.aborted) {
        reject(new Error('REPL execution was aborted'))
        return
      }
      onAbort = () => reject(new Error('REPL execution was aborted'))
      abortSignal.addEventListener('abort', onAbort, { once: true })
    })

    let returned: unknown
    try {
      const script = new vm.Script(`(async () => {\n${input.code}\n})()`)
      const evaluation = script.runInContext(vm.createContext(sandbox), { timeout: input.timeout_ms })
      returned = await Promise.race([Promise.resolve(evaluation), aborted])
    } finally {
      if (onAbort) abortSignal.removeEventListener('abort', onAbort)
    }

    const output = [...logs]
    if (returned !== undefined) output.push(format(returned))
    return {
      data: {
        output: output.join('\n') || '(no output)',
        toolCalls,
      },
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return { type: 'tool_result', tool_use_id: toolUseID, content: output.output }
  },
} satisfies ToolDef<InputSchema, Output>)
