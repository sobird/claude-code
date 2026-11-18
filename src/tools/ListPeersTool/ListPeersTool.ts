/**
 * ListPeers — enumerate other live Claude Code sessions on this machine.
 *
 * Session discovery is the same PID registry `claude ps` and the concurrent
 * session counter read (`~/.claude/sessions/<pid>.json`, written by
 * registerSession()). Only sessions whose process is still alive are listed;
 * stale files from crashed sessions are ignored (the counter path sweeps
 * them, but a read-only listing must not mutate state).
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { z } from 'zod/v4'

import { getSessionId } from '../../bootstrap/state.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { isProcessRunning } from '../../utils/genericProcessUtils.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { jsonParse } from '../../utils/slowOperations.js'

type PeerSession = {
  pid: number
  sessionId?: string
  name?: string
  cwd?: string
  kind?: string
  entrypoint?: string
  startedAt?: number
  messagingSocketPath?: string
}

const inputSchema = lazySchema(() =>
  z.strictObject({
    includeSelf: z.boolean().optional().describe('Include this session in the list (default false).'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    peers: z.array(
      z.object({
        pid: z.number(),
        sessionId: z.string().optional(),
        name: z.string().optional(),
        cwd: z.string().optional(),
        kind: z.string().optional(),
        entrypoint: z.string().optional(),
        startedAt: z.number().optional(),
        messagingSocketPath: z.string().optional(),
        isSelf: z.boolean(),
      }),
    ),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

/** Strict `<pid>.json` guard — see countConcurrentSessions for the rationale. */
const PID_FILE_RE = /^\d+\.json$/

async function readPeerSessions(): Promise<PeerSession[]> {
  const dir = join(getClaudeConfigHomeDir(), 'sessions')
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return []
  }

  const peers: PeerSession[] = []
  for (const file of files) {
    if (!PID_FILE_RE.test(file)) continue
    const pid = parseInt(file.slice(0, -5), 10)
    if (pid === process.pid || !isProcessRunning(pid)) continue
    try {
      const raw = jsonParse(await readFile(join(dir, file), 'utf8')) as Record<string, unknown>
      peers.push({
        pid,
        sessionId: typeof raw.sessionId === 'string' ? raw.sessionId : undefined,
        name: typeof raw.name === 'string' ? raw.name : undefined,
        cwd: typeof raw.cwd === 'string' ? raw.cwd : undefined,
        kind: typeof raw.kind === 'string' ? raw.kind : undefined,
        entrypoint: typeof raw.entrypoint === 'string' ? raw.entrypoint : undefined,
        startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : undefined,
        messagingSocketPath: typeof raw.messagingSocketPath === 'string' ? raw.messagingSocketPath : undefined,
      })
    } catch {
      // A partially written or corrupt file is not a peer.
    }
  }
  return peers
}

export const ListPeersTool = buildTool({
  name: 'ListPeers',
  searchHint: 'list other running claude sessions',
  maxResultSizeChars: 50_000,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    // This module is only loaded under feature('UDS_INBOX').
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
    return 'List peer sessions'
  },
  async description() {
    return 'List other Claude Code sessions running on this machine.'
  },
  async prompt() {
    return 'List the other Claude Code sessions running on this machine, including each session name, working directory, and messaging socket when available. Use it before sending an inter-session message so you know which peers exist.'
  },
  async call(input: z.infer<InputSchema>) {
    const selfId = getSessionId()
    const sessions = await readPeerSessions()
    const peers = sessions
      .map((s) => ({ ...s, isSelf: s.sessionId === selfId }))
      .filter((s) => input.includeSelf === true || !s.isSelf)
      .toSorted((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
    return { data: { peers } }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const text =
      output.peers.length === 0
        ? 'No other Claude Code sessions are running.'
        : output.peers
            .map((p) => {
              const label = p.name ? `${p.name} ` : ''
              const cwd = p.cwd ? ` in ${p.cwd}` : ''
              const kind = p.kind ? ` [${p.kind}]` : ''
              return `${label}(pid ${p.pid}, session ${p.sessionId ?? 'unknown'})${kind}${cwd}`
            })
            .join('\n')
    return { type: 'tool_result', tool_use_id: toolUseID, content: text }
  },
} satisfies ToolDef<InputSchema, Output>)
