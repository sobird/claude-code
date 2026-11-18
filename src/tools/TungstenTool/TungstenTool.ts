/**
 * Tmux (internally "Tungsten") — drive tmux sessions on Claude's isolated socket.
 *
 * The model-facing name is `Tmux`; `TungstenTool` is the module identifier kept
 * for historical reasons (permissionSetup checks `toolName === 'Tmux'`, and the
 * streamlined renderer groups COMMAND_TOOLS by that name). Every command runs
 * with `-L <claude-PID>` so it can never touch the user's own tmux sessions —
 * see `utils/tmuxSocket.ts`.
 *
 * UI coupling: creating or driving a session updates the AppState fields the
 * footer pill and live monitor read (`tungstenActiveSession`,
 * `tungstenLastCommand`, `tungstenLastCapturedTime`, panel visibility). Those
 * fields are why this tool ships an ant-only live monitor rather than being a
 * plain shell tool.
 *
 * Approximation: upstream can attach a live panel preview. Here the panel is a
 * state-driven overlay; capture returns pane text directly and also stamps
 * `tungstenLastCapturedTime` so the monitor can show freshness.
 */

import { z } from 'zod/v4'

import { buildTool, type ToolDef } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { execFileNoThrow } from '../../utils/execFileNoThrow.js'
import { lazySchema } from '../../utils/lazySchema.js'
import {
  ensureSocketInitialized,
  getClaudeSocketName,
  isSocketInitialized,
  markTmuxToolUsed,
} from '../../utils/tmuxSocket.js'

export const TMUX_TOOL_NAME = 'Tmux'

const DEFAULT_CAPTURE_LINES = 100
const MAX_CAPTURE_LINES = 2000

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z.enum(['create', 'list', 'kill', 'send', 'capture']).describe('Operation to perform.'),
    session: z.string().optional().describe('Session name. Required for create; selects the target otherwise.'),
    command: z.string().optional().describe('Keys to send into the session (send only).'),
    lines: z
      .number()
      .int()
      .min(1)
      .max(MAX_CAPTURE_LINES)
      .default(DEFAULT_CAPTURE_LINES)
      .describe('Scrollback lines to capture (capture only).'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    action: z.string(),
    session: z.string().optional(),
    target: z.string().optional(),
    sessions: z.array(z.string()).optional(),
    text: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

/** Sessions this tool created, so /clear can drop bookkeeping. */
const sessionsWithTungstenUsage = new Set<string>()
let initialized = false

export function clearSessionsWithTungstenUsage(): void {
  sessionsWithTungstenUsage.clear()
}

export function resetInitializationState(): void {
  initialized = false
}

async function tmux(args: string[]) {
  return execFileNoThrow('tmux', ['-L', getClaudeSocketName(), ...args], { useCwd: true })
}

function requireSession(input: z.infer<InputSchema>): string {
  if (!input.session) throw new Error(`The ${input.action} action requires a "session" name.`)
  return input.session
}

export const TungstenTool = buildTool({
  name: TMUX_TOOL_NAME,
  searchHint: 'manage tmux sessions in an isolated socket',
  maxResultSizeChars: 50_000,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    // Ant-only; tools.ts only registers it when USER_TYPE === 'ant'.
    return true
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  toAutoClassifierInput(input) {
    return `Tmux ${input.action}${input.session ? ` ${input.session}` : ''}`
  },
  renderToolUseMessage(input) {
    return `Tmux ${input.action}${input.session ? ` ${input.session}` : ''}`
  },
  async description() {
    return 'Create, list, kill, drive, and capture tmux sessions in Claude\u2019s isolated tmux socket.'
  },
  async prompt() {
    return 'Manage tmux sessions on Claude\u2019s private socket (never the user\u2019s own sessions). Actions: create a detached session, list sessions, kill a session, send keys to a session, and capture recent pane output. Prefer one long-lived session for iterative work; create fresh sessions for test or verification shells so they do not disturb your working session. Capture before sending input if you need the current prompt state.'
  },
  async call(input, context) {
    if (!initialized) {
      markTmuxToolUsed()
      await ensureSocketInitialized()
      initialized = true
    }
    if (!isSocketInitialized()) {
      throw new Error('tmux is not available on this system, so the Tmux tool cannot run.')
    }
    const appState = context.getAppState()
    const activeTarget = appState.tungstenActiveSession?.target

    switch (input.action) {
      case 'create': {
        const session = requireSession(input)
        const result = await tmux(['new-session', '-d', '-s', session, '-c', getCwd()])
        if (result.code !== 0) {
          throw new Error(`Failed to create tmux session "${session}": ${result.stderr || result.code}`)
        }
        sessionsWithTungstenUsage.add(session)
        const target = `${session}:0.0`
        context.setAppState((prev) => ({
          ...prev,
          tungstenActiveSession: { sessionName: session, socketName: getClaudeSocketName(), target },
          tungstenPanelVisible: true,
          tungstenPanelAutoHidden: false,
        }))
        return { data: { action: input.action, session, target } }
      }
      case 'list': {
        const result = await tmux(['list-sessions', '-F', '#{session_name}'])
        if (result.code !== 0) {
          // No server yet is not an error — report an empty list.
          return { data: { action: input.action, sessions: [] } }
        }
        const sessions = result.stdout
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
        return { data: { action: input.action, sessions } }
      }
      case 'kill': {
        const session = requireSession(input)
        const result = await tmux(['kill-session', '-t', session])
        if (result.code !== 0) {
          throw new Error(`Failed to kill tmux session "${session}": ${result.stderr || result.code}`)
        }
        sessionsWithTungstenUsage.delete(session)
        context.setAppState((prev) => {
          if (prev.tungstenActiveSession?.sessionName !== session) return prev
          const { tungstenActiveSession: _removed, ...rest } = prev
          return { ...rest, tungstenPanelVisible: false }
        })
        return { data: { action: input.action, session } }
      }
      case 'send': {
        const session = requireSession(input)
        if (!input.command) throw new Error('The send action requires a "command".')
        const target = session.includes(':') ? session : `${session}:0.0`
        const result = await tmux(['send-keys', '-t', target, input.command, 'Enter'])
        if (result.code !== 0) {
          throw new Error(`Failed to send keys to "${target}": ${result.stderr || result.code}`)
        }
        context.setAppState((prev) => ({
          ...prev,
          tungstenLastCommand: { command: input.command!, timestamp: Date.now() },
          tungstenPanelVisible: true,
          tungstenPanelAutoHidden: false,
        }))
        return { data: { action: input.action, session, target } }
      }
      case 'capture': {
        const target = input.session
          ? input.session.includes(':')
            ? input.session
            : `${input.session}:0.0`
          : activeTarget
        if (!target) {
          throw new Error('No tmux session to capture. Create one or pass "session".')
        }
        const result = await tmux(['capture-pane', '-p', '-t', target, '-S', `-${input.lines}`])
        if (result.code !== 0) {
          throw new Error(`Failed to capture "${target}": ${result.stderr || result.code}`)
        }
        context.setAppState((prev) => ({ ...prev, tungstenLastCapturedTime: Date.now() }))
        return { data: { action: input.action, target, text: result.stdout } }
      }
      default:
        throw new Error(`Unknown tmux action: ${String((input as { action?: unknown }).action)}`)
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const lines: string[] = []
    if (output.sessions) {
      lines.push(output.sessions.length > 0 ? `Sessions: ${output.sessions.join(', ')}` : 'No tmux sessions.')
    }
    if (output.session) lines.push(`Session: ${output.session}`)
    if (output.target) lines.push(`Target: ${output.target}`)
    if (output.text !== undefined) lines.push('', output.text.trim() || '(no output)')
    if (lines.length === 0) lines.push(`Tmux ${output.action} completed.`)
    return { type: 'tool_result', tool_use_id: toolUseID, content: lines.join('\n') }
  },
} satisfies ToolDef<InputSchema, Output>)
