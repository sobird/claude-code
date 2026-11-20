/**
 * Shared plumbing for the end-to-end suites: isolated environments, spawning
 * the real CLI from source, and driving an interactive session through a PTY.
 *
 * Isolation rules for every run:
 *   - HOME and CLAUDE_CONFIG_DIR point into a fresh temp root
 *   - the working directory is a temp project, so project settings, CLAUDE.md
 *     and session files never touch the developer's real setup
 *   - ambient model/provider variables are stripped before overrides are set;
 *     this machine routes model traffic to a non-Anthropic provider, and
 *     inheriting that silently breaks the fake server
 */

import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { spawn, type Subprocess } from 'bun'

import { defineArgs, featureArgs } from '../../scripts/config'

export const ENTRY = resolve(import.meta.dir, '../../src/entrypoints/cli.tsx')

const DEFAULT_API_KEY = 'e2e-test-key'

const EXCLUDED_PREFIXES = ['ANTHROPIC_', 'OPENAI_', 'GEMINI_', 'CLAUDE_CODE_USE_', 'CLAUDE_CODE_API_PROVIDER']

const EXCLUDED_KEYS = new Set([
  'HOME',
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_REPL',
  'CLAUDE_CODE_SIMPLE',
  'CLAUDE_REPL_MODE',
  // bun test sets NODE_ENV=test, which makes the CLI (a) replay API responses
  // from on-disk VCR fixtures instead of calling ANTHROPIC_BASE_URL, and (b)
  // suppress session persistence. Both would invalidate these runs, so the
  // child starts with NODE_ENV unset — exactly like `bun run dev`.
  'NODE_ENV',
])

export type TempRoot = {
  root: string
  home: string
  config: string
  work: string
}

export function makeTempRoot(): TempRoot {
  // Resolve symlinks up front: on macOS tmpdir() yields /var/folders/... which
  // is a symlink to /private/var/.... Sessions are keyed by the real project
  // path, so a child started in the unresolved path would not find its own
  // transcripts with --continue.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'claude-e2e-')))
  const home = join(root, 'home')
  const config = join(root, 'config')
  const work = join(root, 'work')
  for (const dir of [home, config, work]) mkdirSync(dir, { recursive: true })
  return { root, home, config, work }
}

export type IsolatedEnvOptions = {
  home: string
  config: string
  baseUrl: string
  apiKey?: string
}

export function isolatedEnv(options: IsolatedEnvOptions): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (EXCLUDED_KEYS.has(key)) continue
    if (EXCLUDED_PREFIXES.some((prefix) => key.startsWith(prefix))) continue
    env[key] = value
  }
  env.HOME = options.home
  env.CLAUDE_CONFIG_DIR = options.config
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
  // REPL mode hides Read/Bash/Edit behind the REPL tool, so scripted tool
  // calls would fail with "No such tool available".
  env.CLAUDE_CODE_REPL = '0'
  env.ANTHROPIC_API_KEY = options.apiKey ?? DEFAULT_API_KEY
  env.ANTHROPIC_BASE_URL = options.baseUrl
  return env
}

export type CliRun = { stdout: string; stderr: string; exitCode: number }

export type RunCliOptions = {
  cwd: string
  env: Record<string, string>
  args: string[]
  timeoutMs?: number
}

export async function runCli(options: RunCliOptions): Promise<CliRun> {
  const proc = spawn(['bun', ...defineArgs, ...featureArgs, ENTRY, ...options.args], {
    cwd: options.cwd,
    env: options.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const timer = setTimeout(() => proc.kill(), options.timeoutMs ?? 120_000)
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { stdout, stderr, exitCode }
  } finally {
    clearTimeout(timer)
  }
}

/** Parses the last line of stdout as JSON (the CLI's result message). */
export function lastJsonLine(stdout: string): Record<string, unknown> {
  const lines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const last = lines[lines.length - 1]
  if (!last) throw new Error('CLI produced no stdout to parse')
  return JSON.parse(last) as Record<string, unknown>
}

/**
 * Seeds the global config that the interactive setup screens read: onboarding
 * completed, the working directory trusted, and the API key pre-approved so
 * the "Detected a custom API key" dialog never blocks a headless PTY.
 */
export function seedInteractiveConfig(root: TempRoot, apiKey = DEFAULT_API_KEY): void {
  const approved = apiKey.slice(-20)
  writeFileSync(
    join(root.config, '.claude.json'),
    JSON.stringify({
      hasCompletedOnboarding: true,
      theme: 'dark',
      customApiKeyResponses: { approved: [approved], rejected: [] },
      projects: { [root.work]: { hasTrustDialogAccepted: true } },
    }),
  )
}

export type SessionRecord = {
  pid: number
  sessionId: string
  name: string
  cwd?: string
  kind?: string
  status?: string
}

export function seedSession(configDir: string, record: SessionRecord): void {
  const dir = join(configDir, 'sessions')
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, `${record.pid}.json`),
    JSON.stringify({
      sessionId: record.sessionId,
      cwd: record.cwd ?? '/tmp/e2e',
      startedAt: Date.now() - 60_000,
      kind: record.kind ?? 'bg',
      name: record.name,
      status: record.status ?? 'idle',
    }),
  )
}

/**
 * Spawns a long-lived process so the PID registry considers it live. Uses the
 * bun binary rather than `sleep`, which doesn't exist on Windows.
 */
export function spawnSleep(children: Subprocess[]): number {
  const child = spawn(['bun', '-e', 'setTimeout(() => {}, 30_000)'], { stdout: 'ignore', stderr: 'ignore' })
  children.push(child)
  return child.pid
}

export function cleanupRoots(roots: string[]): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
}

export function ptySupported(): boolean {
  return process.platform !== 'win32' && Bun.which('script') !== null
}

// eslint-disable-next-line no-control-regex -- stripping terminal escape codes is the point
const ANSI = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][A-Za-z0-9]/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '')
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export type PtySession = {
  write(text: string): void
  waitFor(text: string, timeoutMs?: number): Promise<void>
  output(): string
  readonly exited: Promise<number>
  dispose(): Promise<void>
}

export type StartPtyOptions = {
  cwd: string
  env: Record<string, string>
  args: string[]
}

/**
 * Runs the CLI attached to a PTY so Ink takes its interactive path.
 *
 * macOS `script` takes the command as arguments; util-linux requires -c. A
 * generated wrapper script keeps argument quoting identical on both.
 */
export async function startPty(options: StartPtyOptions): Promise<PtySession> {
  const runnerDir = mkdtempSync(join(tmpdir(), 'claude-pty-'))
  const runner = join(runnerDir, 'run.sh')
  const command = ['bun', ...defineArgs, ...featureArgs, ENTRY, ...options.args].map(shellQuote).join(' ')
  writeFileSync(runner, `#!/bin/sh\nexec ${command}\n`)
  chmodSync(runner, 0o755)

  const scriptArgs =
    process.platform === 'darwin'
      ? ['script', '-q', '/dev/null', runner]
      : ['script', '-q', '-e', '-c', runner, '/dev/null']

  const proc = spawn(scriptArgs, {
    cwd: options.cwd,
    env: options.env,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })

  let buffer = ''
  const decoder = new TextDecoder()
  const pump = async (stream: ReadableStream<Uint8Array>) => {
    const reader = stream.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) buffer += decoder.decode(value, { stream: true })
      }
    } finally {
      reader.releaseLock()
    }
  }
  const pumps = Promise.all([pump(proc.stdout), pump(proc.stderr)])

  return {
    write(text: string) {
      void proc.stdin.write(text)
      void proc.stdin.flush()
    },
    async waitFor(text: string, timeoutMs = 60_000) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        if (buffer.includes(text)) return
        await Bun.sleep(50)
      }
      throw new Error(
        `PTY output never contained ${JSON.stringify(text)} within ${timeoutMs}ms.\n${stripAnsi(buffer).slice(-3000)}`,
      )
    },
    output() {
      return buffer
    },
    exited: proc.exited,
    async dispose() {
      if (proc.exitCode === null) proc.kill()
      await proc.exited.catch(() => {})
      await pumps.catch(() => {})
      rmSync(runnerDir, { recursive: true, force: true })
    },
  }
}
