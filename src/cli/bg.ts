/**
 * Background session management for the `claude ps|logs|attach|kill` fast path
 * and the `--bg` / `--background` spawn flags (entrypoints/cli.tsx).
 *
 * Background sessions run inside a detached tmux session. The child CLI
 * registers itself in the `~/.claude/sessions/<pid>.json` PID registry
 * (utils/concurrentSessions.ts) with `kind: 'bg'` plus the name and log path
 * handed down through `CLAUDE_CODE_SESSION_*` env vars. The REPL treats
 * `CLAUDE_CODE_SESSION_KIND=bg` specially on exit: it detaches the tmux client
 * instead of killing the process, so a session survives detach and can be
 * reattached with `claude attach`.
 */

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, readdir, stat, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { buildCliLaunch } from '../utils/cliLaunch.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { isProcessRunning } from '../utils/genericProcessUtils.js'
import { getPlatform } from '../utils/platform.js'

export type BgSessionStatus = 'busy' | 'idle' | 'waiting'

/** Shape of a `~/.claude/sessions/<pid>.json` entry (only fields we read). */
export type BgSessionRecord = {
  pid: number
  sessionId?: string
  cwd?: string
  startedAt?: number
  kind?: string
  name?: string
  logPath?: string
  status?: BgSessionStatus
  waitingFor?: string
  updatedAt?: number
}

export type SessionResolution = { ok: true; record: BgSessionRecord } | { ok: false; error: string }

export type TmuxPane = { pid: number; sessionName: string }

const BG_FLAGS = new Set(['--bg', '--background'])
const MIN_SESSION_PREFIX = 4

/**
 * Flags that take a separate value. Used only when deriving a display name from
 * argv, so a value like `--model opus` is not mistaken for the prompt.
 */
const VALUE_TAKING_FLAGS = new Set([
  '--add-dir',
  '--agents',
  '--append-system-prompt',
  '--fallback-model',
  '--input-format',
  '--mcp-config',
  '--model',
  '--name',
  '--output-format',
  '--permission-mode',
  '--session-id',
  '--settings',
  '--system-prompt',
])

/** Drops `--bg` / `--background` and leaves everything else untouched. */
export function stripBgFlags(args: string[]): string[] {
  return args.filter((arg) => !BG_FLAGS.has(arg))
}

/** Reads `--name <value>` / `--name=<value>` from argv. */
export function getBgNameArg(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--name' && i + 1 < args.length) return args[i + 1]
    if (arg.startsWith('--name=')) return arg.slice('--name='.length)
  }
  return undefined
}

/**
 * Display name for a new background session: explicit `--name`, else the first
 * positional prompt (trimmed to 48 chars), else the working directory name.
 */
export function defaultBgName(childArgs: string[], cwd: string): string {
  const explicit = getBgNameArg(childArgs)?.trim()
  if (explicit) return explicit

  for (let i = 0; i < childArgs.length; i++) {
    const arg = childArgs[i]
    if (arg.startsWith('-')) {
      if (VALUE_TAKING_FLAGS.has(arg)) i++
      continue
    }
    const prompt = arg.trim()
    if (prompt) return prompt.length > 48 ? prompt.slice(0, 48) : prompt
  }

  const dirName = basename(cwd)
  return dirName && dirName !== '/' && dirName !== '.' ? dirName : 'background'
}

/**
 * Resolves a user-supplied target (full session ID, unique ID prefix, name, or
 * PID) against live registry records. A prefix shorter than four characters is
 * never treated as one, to avoid matching everything.
 */
export function resolveSessionTarget(records: BgSessionRecord[], target: string | undefined): SessionResolution {
  const wanted = target?.trim()
  if (!wanted) {
    return { ok: false, error: 'Missing session ID. Run `claude ps` to list sessions.' }
  }

  const byId = records.find((record) => record.sessionId === wanted)
  if (byId) return { ok: true, record: byId }

  const byName = records.filter((record) => record.name === wanted)
  if (byName.length === 1) return { ok: true, record: byName[0] }
  if (byName.length > 1) return { ok: false, error: ambiguousError(wanted, byName) }

  if (/^\d+$/.test(wanted)) {
    const byPid = records.find((record) => record.pid === Number(wanted))
    if (byPid) return { ok: true, record: byPid }
  }

  if (wanted.length >= MIN_SESSION_PREFIX) {
    const byPrefix = records.filter((record) => record.sessionId?.startsWith(wanted))
    if (byPrefix.length === 1) return { ok: true, record: byPrefix[0] }
    if (byPrefix.length > 1) return { ok: false, error: ambiguousError(wanted, byPrefix) }
  }

  return { ok: false, error: `No session matches '${wanted}'.` }
}

function ambiguousError(target: string, matches: BgSessionRecord[]): string {
  const ids = matches.map((record) => record.sessionId?.slice(0, 8) ?? String(record.pid)).join(', ')
  return `Multiple sessions match '${target}': ${ids}`
}

/** Renders the `claude ps` table. Takes `now` so age output is testable. */
export function formatSessionsTable(records: BgSessionRecord[], now: number): string {
  if (records.length === 0) return 'No live sessions.'

  const header = ['NAME', 'ID', 'KIND', 'STATUS', 'PID', 'STARTED', 'CWD']
  const rows = records.map((record) => [
    record.name?.trim() || '(unnamed)',
    record.sessionId ? record.sessionId.slice(0, 8) : '-',
    record.kind || 'interactive',
    formatStatus(record),
    String(record.pid),
    record.startedAt ? formatAge(now - record.startedAt) : '-',
    record.cwd || '-',
  ])

  const widths = header.map((cell, column) => Math.max(cell.length, ...rows.map((row) => row[column].length)))
  const render = (row: string[]): string =>
    row
      .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column])))
      .join('  ')
      .trimEnd()

  return [render(header), ...rows.map(render)].join('\n')
}

function formatStatus(record: BgSessionRecord): string {
  if (record.status === 'waiting' && record.waitingFor) return `waiting: ${record.waitingFor}`
  return record.status ?? 'unknown'
}

function formatAge(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/** Returns the last `maxLines` lines of `text`, without a trailing newline. */
export function tailLines(text: string, maxLines: number): string {
  if (!text) return ''
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines.slice(-maxLines).join('\n')
}

/** Parses `tmux list-panes -F '#{pane_pid}\t#{session_name}'` output. */
export function parseTmuxPaneList(output: string): TmuxPane[] {
  const panes: TmuxPane[] = []
  for (const line of output.split('\n')) {
    const tab = line.indexOf('\t')
    if (tab <= 0) continue
    const pidText = line.slice(0, tab).trim()
    const sessionName = line.slice(tab + 1).trim()
    if (!/^\d+$/.test(pidText) || !sessionName) continue
    panes.push({ pid: Number(pidText), sessionName })
  }
  return panes
}

/** Finds the tmux session whose pane leader is `pid`. */
export function findTmuxSessionByPid(panes: TmuxPane[], pid: number): string | undefined {
  return panes.find((pane) => pane.pid === pid)?.sessionName
}

const LOG_TAIL_MAX_BYTES = 128 * 1024
const LOG_TAIL_LINES = 200
const KILL_GRACE_MS = 5_000
const KILL_POLL_MS = 100

type TmuxResult = { status: number | null; stdout: string; stderr: string; error?: Error }

function runTmux(args: string[], env: NodeJS.ProcessEnv = process.env): TmuxResult {
  const result = spawnSync('tmux', args, { encoding: 'utf8', env })
  return {
    status: result.status,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
    error: result.error,
  }
}

function getSessionsDir(): string {
  return join(getClaudeConfigHomeDir(), 'sessions')
}

function tmuxSessionName(sessionId: string): string {
  return `claude-bg-${sessionId}`
}

function displayId(record: BgSessionRecord): string {
  return record.sessionId?.slice(0, 8) ?? String(record.pid)
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function toRecord(pid: number, data: Record<string, unknown>): BgSessionRecord {
  return {
    pid,
    sessionId: asString(data.sessionId),
    cwd: asString(data.cwd),
    startedAt: asNumber(data.startedAt),
    kind: asString(data.kind),
    name: asString(data.name),
    logPath: asString(data.logPath),
    status: data.status === 'busy' || data.status === 'idle' || data.status === 'waiting' ? data.status : undefined,
    waitingFor: asString(data.waitingFor),
    updatedAt: asNumber(data.updatedAt),
  }
}

/**
 * Reads the PID registry and keeps entries whose process is still alive.
 * Filenames are strictly `<pid>.json`; anything else is user data (see
 * countConcurrentSessions).
 */
async function readLiveSessions(): Promise<BgSessionRecord[]> {
  let files: string[]
  try {
    files = await readdir(getSessionsDir())
  } catch {
    return []
  }

  const records: BgSessionRecord[] = []
  for (const file of files) {
    if (!/^\d+\.json$/.test(file)) continue
    const pid = Number.parseInt(file.slice(0, -5), 10)
    if (!isProcessRunning(pid)) continue
    try {
      const raw = await readFile(join(getSessionsDir(), file), 'utf8')
      records.push(toRecord(pid, JSON.parse(raw) as Record<string, unknown>))
    } catch {
      // Raced with cleanup or a partial write; skip this entry.
    }
  }
  return records
}

async function requireSession(target: string | undefined): Promise<BgSessionRecord | null> {
  const resolution = resolveSessionTarget(await readLiveSessions(), target)
  if (!resolution.ok) {
    console.error(resolution.error)
    process.exitCode = 1
    return null
  }
  return resolution.record
}

/** `claude ps` — lists every live CLI session from the PID registry. */
export async function psHandler(_args: string[]): Promise<void> {
  const records = await readLiveSessions()
  records.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))
  console.log(formatSessionsTable(records, Date.now()))
}

/** `claude logs <id>` — prints the tail of a session's tmux output. */
export async function logsHandler(target: string | undefined): Promise<void> {
  const record = await requireSession(target)
  if (!record) return

  const text = await readSessionLog(record)
  if (!text.trim()) {
    console.log(`No output yet for session ${displayId(record)}.`)
    return
  }

  console.log(`--- ${record.logPath ?? 'tmux pane'} (last ${LOG_TAIL_LINES} lines) ---`)
  console.log(tailLines(text, LOG_TAIL_LINES))
}

async function readSessionLog(record: BgSessionRecord): Promise<string> {
  if (record.logPath) {
    const fromFile = await readFileTail(record.logPath, LOG_TAIL_MAX_BYTES)
    if (fromFile) return fromFile
  }

  const session = await findTmuxSession(record)
  if (!session) return ''
  const result = runTmux(['capture-pane', '-p', '-t', session, '-S', `-${LOG_TAIL_LINES}`])
  return result.status === 0 ? result.stdout : ''
}

async function readFileTail(path: string, maxBytes: number): Promise<string> {
  try {
    const info = await stat(path)
    const handle = await open(path, 'r')
    try {
      const length = Math.min(info.size, maxBytes)
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, Math.max(0, info.size - length))
      return buffer.subarray(0, bytesRead).toString('utf8')
    } finally {
      await handle.close()
    }
  } catch {
    return ''
  }
}

/** `claude attach <id>` — attaches the current terminal to a tmux session. */
export async function attachHandler(target: string | undefined): Promise<void> {
  const record = await requireSession(target)
  if (!record) return

  if (record.pid === process.pid) {
    console.error('That is the current session.')
    process.exitCode = 1
    return
  }

  const session = await findTmuxSession(record)
  if (!session) {
    console.error(
      `Session ${displayId(record)} is not running in tmux. Use \`claude logs ${displayId(record)}\` to inspect it.`,
    )
    process.exitCode = 1
    return
  }

  // Nesting `tmux attach` inside tmux is rejected by tmux itself; switch the
  // current client between sibling sessions instead.
  const args = process.env.TMUX ? ['switch-client', '-t', session] : ['attach-session', '-t', session]
  const result = spawnSync('tmux', args, { stdio: 'inherit' })
  if (result.error) {
    console.error(`Failed to attach to '${session}': ${result.error.message}`)
    process.exitCode = 1
    return
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    process.exitCode = result.status
  }
}

/** `claude kill <id>` — terminates a session and removes its registry entry. */
export async function killHandler(target: string | undefined): Promise<void> {
  const record = await requireSession(target)
  if (!record) return

  if (record.pid === process.pid) {
    console.error('Refusing to kill the current session.')
    process.exitCode = 1
    return
  }

  const session = await findTmuxSession(record)
  if (session) {
    const result = runTmux(['kill-session', '-t', session])
    if (result.status !== 0) {
      const detail = result.error?.message ?? result.stderr.trim()
      console.error(`Failed to kill tmux session '${session}'${detail ? `: ${detail}` : ''}`)
      process.exitCode = 1
      return
    }
    console.log(`Killed session ${displayId(record)} (${session}).`)
  } else if (await terminateProcess(record.pid)) {
    console.log(`Killed session ${displayId(record)} (PID ${record.pid}).`)
  } else {
    console.error(`Session ${displayId(record)} (PID ${record.pid}) is not running.`)
    process.exitCode = 1
    return
  }

  await unlink(join(getSessionsDir(), `${record.pid}.json`)).catch(() => {})
}

async function terminateProcess(pid: number): Promise<boolean> {
  if (!isProcessRunning(pid)) return false
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return false
  }

  const deadline = Date.now() + KILL_GRACE_MS
  while (Date.now() < deadline) {
    if (!isProcessRunning(pid)) return true
    await delay(KILL_POLL_MS)
  }

  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // Exited between the poll and the kill.
  }
  await delay(200)
  return true
}

/**
 * Finds the tmux session hosting `record.pid`. The pane PID is the exact
 * process we spawned (tmux execs the command directly), so it survives
 * resume/`--continue` launches where the session ID is not known up front.
 */
async function findTmuxSession(record: BgSessionRecord): Promise<string | undefined> {
  const panes = runTmux(['list-panes', '-a', '-F', '#{pane_pid}\t#{session_name}'])
  if (panes.status === 0) {
    const byPid = findTmuxSessionByPid(parseTmuxPaneList(panes.stdout), record.pid)
    if (byPid) return byPid
  }

  if (record.sessionId) {
    const candidate = tmuxSessionName(record.sessionId)
    if (runTmux(['has-session', '-t', candidate]).status === 0) return candidate
  }
  return undefined
}

/**
 * `claude --bg [args...]` — starts this CLI in a detached tmux session and
 * prints the commands to attach, follow logs, or kill it.
 */
export async function handleBgFlag(args: string[]): Promise<void> {
  const childArgs = stripBgFlags(args)
  const cwd = process.cwd()

  if (!(await ensureTmux())) return

  const requestedSessionId = getFlagValue(childArgs, '--session-id')
  const resumes = hasAnyFlag(childArgs, ['--resume', '-r', '--continue', '-c'])
  const launchId = requestedSessionId ?? randomUUID()
  // `--resume`/`--continue` choose their own session ID; forcing one would
  // fail the child's argument validation.
  const addSessionId = !requestedSessionId && !resumes
  const finalArgs = addSessionId ? [...childArgs, '--session-id', launchId] : childArgs
  const name = defaultBgName(finalArgs, cwd)
  const session = tmuxSessionName(launchId)
  const logPath = join(getClaudeConfigHomeDir(), 'logs', `bg-${launchId}.log`)
  await mkdir(dirname(logPath), { recursive: true })

  if (runTmux(['has-session', '-t', session]).status === 0) {
    console.error(`Background session '${session}' already exists.`)
    process.exitCode = 1
    return
  }

  const launch = buildCliLaunch(finalArgs)
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_CODE_SESSION_KIND: 'bg',
    CLAUDE_CODE_SESSION_NAME: name,
    CLAUDE_CODE_SESSION_LOG: logPath,
    CLAUDE_CODE_TMUX_SESSION: session,
  }

  const started = spawnSync(
    'tmux',
    ['new-session', '-d', '-P', '-F', '#{pane_pid}', '-s', session, '-c', cwd, '--', launch.command, ...launch.args],
    { encoding: 'utf8', env },
  )
  if (started.error || started.status !== 0) {
    const detail = started.error?.message ?? (started.stderr ?? '').trim()
    console.error(`Failed to start background session${detail ? `: ${detail}` : ''}`)
    process.exitCode = 1
    return
  }

  const panePid = Number.parseInt((started.stdout ?? '').trim(), 10)
  // Mirror the pane to a file for `claude logs`. tmux runs the command through
  // the shell, so the path must be shell-quoted.
  const piped = runTmux(['pipe-pane', '-o', '-t', session, `cat >> ${shellQuote(logPath)}`], env)
  if (piped.status !== 0) {
    console.error(`Warning: could not capture output to ${logPath}; \`claude logs\` will use the tmux pane.`)
  }

  const target = addSessionId || Number.isNaN(panePid) ? launchId : String(panePid)
  console.log(`Started background session '${name}' in ${cwd}`)
  console.log(`  Session: ${launchId}`)
  console.log(`  Log:     ${logPath}`)
  console.log(`  Attach:  claude attach ${target}`)
  console.log(`  Logs:    claude logs ${target}`)
  console.log(`  Kill:    claude kill ${target}`)
}

async function ensureTmux(): Promise<boolean> {
  if (runTmux(['-V']).status === 0) return true
  console.error('Error: tmux is required for background sessions.')
  console.error(tmuxInstallHint())
  process.exitCode = 1
  return false
}

function tmuxInstallHint(): string {
  switch (getPlatform()) {
    case 'macos':
      return 'Install tmux with: brew install tmux'
    case 'linux':
    case 'wsl':
      return 'Install tmux with: sudo apt install tmux (Debian/Ubuntu) or sudo dnf install tmux (Fedora/RHEL)'
    case 'windows':
      return 'tmux is not natively available on Windows. Consider WSL or Cygwin.'
    default:
      return 'Install tmux using your system package manager.'
  }
}

function getFlagValue(args: string[], flag: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === flag && i + 1 < args.length) return args[i + 1]
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1)
  }
  return undefined
}

function hasAnyFlag(args: string[], flags: string[]): boolean {
  return args.some((arg) => flags.includes(arg))
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}
