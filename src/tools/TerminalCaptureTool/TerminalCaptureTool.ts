/**
 * TerminalCapture — read the scrollback of the built-in terminal panel.
 *
 * The panel (Meta+J) keeps a persistent shell in an isolated tmux server with
 * a per-instance socket (`utils/terminalPanel.ts`). Upstream lets the model
 * inspect that shell without attaching to it; this implementation captures the
 * `panel` session's pane through the same socket.
 *
 * Approximation: the session name and capture command are reconstructed from
 * `utils/terminalPanel.ts` (TMUX_SESSION = 'panel'). When the user has not
 * opened the panel yet there is no session, which is reported rather than
 * auto-created — capturing should never start a shell the user did not ask for.
 */

import { z } from 'zod/v4'

import { buildTool, type ToolDef } from '../../Tool.js'
import { execFileNoThrow } from '../../utils/execFileNoThrow.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { getTerminalPanelSocket } from '../../utils/terminalPanel.js'
import { TERMINAL_CAPTURE_TOOL_NAME } from './prompt.js'

const TMUX_SESSION = 'panel'
const DEFAULT_LINES = 200
const MAX_LINES = 2000

const inputSchema = lazySchema(() =>
  z.strictObject({
    lines: z
      .number()
      .int()
      .min(1)
      .max(MAX_LINES)
      .default(DEFAULT_LINES)
      .describe(`How many scrollback lines to capture (1–${MAX_LINES}).`),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    running: z.boolean(),
    text: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

export const TerminalCaptureTool = buildTool({
  name: TERMINAL_CAPTURE_TOOL_NAME,
  searchHint: 'read the built-in terminal panel output',
  maxResultSizeChars: 100_000,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    // Loaded only under feature('TERMINAL_PANEL').
    return true
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return `TerminalCapture ${input.lines} lines`
  },
  renderToolUseMessage(input) {
    return `Capture last ${input.lines ?? DEFAULT_LINES} lines from the terminal panel`
  },
  async description() {
    return 'Capture recent output from the built-in terminal panel.'
  },
  async prompt() {
    return 'Read the most recent output of the built-in terminal panel (opened with Meta+J). Use it when the user asks about something running in that panel, or to check whether a command they started there finished. It only reads; it cannot type into the panel, and it reports "not running" if the panel has never been opened this session.'
  },
  async call(input: z.infer<InputSchema>) {
    const socket = getTerminalPanelSocket()
    const has = await execFileNoThrow('tmux', ['-L', socket, 'has-session', '-t', TMUX_SESSION])
    if (has.code !== 0) {
      return { data: { running: false, text: '' } }
    }
    const result = await execFileNoThrow('tmux', [
      '-L',
      socket,
      'capture-pane',
      '-p',
      '-t',
      TMUX_SESSION,
      '-S',
      `-${input.lines}`,
    ])
    if (result.code !== 0) {
      throw new Error(`Failed to capture terminal panel: ${result.stderr || result.error || result.code}`)
    }
    return { data: { running: true, text: result.stdout } }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const content = output.running
      ? output.text.trim() || '(the terminal panel is running but has produced no output)'
      : 'The built-in terminal panel is not running in this session.'
    return { type: 'tool_result', tool_use_id: toolUseID, content }
  },
} satisfies ToolDef<InputSchema, Output>)
