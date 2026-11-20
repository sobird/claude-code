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
  // The repo's `.env` sets USER_TYPE=ant so `bun run dev` exposes internal
  // commands; Bun auto-loads it whenever the working directory is the repo
  // root, but CI has no `.env`. Strip it so a run behaves identically on both
  // — tests that genuinely need an internal command opt in explicitly.
  'USER_TYPE',
  'IS_DEMO',
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
  //
  // `.native` is what resolves Windows 8.3 short names (RUNNER~1) to the long
  // form. The plain JS realpath leaves them short, and the CLI then sees
  // in-cwd paths (written by the test via the short root) as outside its own
  // long-form cwd, turning allowed tool calls into permission denials.
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'claude-e2e-')))
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
  // Running from source leaves the installer as "npm-global" (the bun binary
  // under /usr/local/lib/node_modules matches). That triggers the npm→native
  // migration banner, which outranks the REPL footer and blocks the PTY test
  // from ever seeing its prompt hint.
  env.DISABLE_INSTALLATION_CHECKS = '1'
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
  for (const root of roots.splice(0)) {
    // Windows can briefly keep handles on the tree open after a spawned CLI
    // exits, so a single rmSync races and throws EBUSY; retry with a short
    // linear backoff instead of failing the test's afterEach.
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}

export function ptySupported(): boolean {
  if (process.platform === 'win32') return false
  if (process.platform === 'darwin') return Bun.which('python3') !== null
  return Bun.which('script') !== null
}

// eslint-disable-next-line no-control-regex -- stripping terminal escape codes is the point
const ANSI = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][A-Za-z0-9]/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '')
}

/** ANSI- and whitespace-insensitive form used for PTY text matching. */
function normalizeForMatch(text: string): string {
  return stripAnsi(text).replace(/\s+/g, '')
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Python relay for the macOS PTY path. `pty.fork()` gives the CLI a real
 * terminal while our own stdin (the harness pipe) is forwarded in, and the
 * relay exits with the child's status as soon as it dies — never blocking on
 * our still-open stdin the way `pty.spawn` would.
 */
const PTY_RUNNER = String.raw`
import fcntl
import os
import pty
import select
import struct
import sys
import termios
import time


def set_winsize(fd, rows, cols):
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    except OSError:
        pass


def drain(master, out_fd):
    end = time.time() + 0.5
    while time.time() < end:
        r, _, _ = select.select([master], [], [], 0.05)
        if not r:
            break
        try:
            data = os.read(master, 65536)
        except OSError:
            break
        if not data:
            break
        os.write(out_fd, data)


def main():
    argv = sys.argv[1:]
    if not argv:
        sys.stderr.write("runner.py: missing command\n")
        return 2
    pid, master = pty.fork()
    if pid == 0:
        try:
            os.execvp(argv[0], argv)
        except OSError as exc:
            os.write(2, ("runner.py: exec failed: %s\n" % exc).encode())
        os._exit(127)
    set_winsize(master, 40, 120)
    stdin_fd, stdout_fd = 0, 1
    watch_stdin = True
    status = None
    try:
        while True:
            if status is None:
                wpid, st = os.waitpid(pid, os.WNOHANG)
                if wpid == pid:
                    status = st
            if status is not None:
                drain(master, stdout_fd)
                break
            rfds = [master] + ([stdin_fd] if watch_stdin else [])
            try:
                ready, _, _ = select.select(rfds, [], [], 0.1)
            except OSError:
                break
            for fd in ready:
                if fd == master:
                    try:
                        data = os.read(master, 65536)
                    except OSError:
                        data = b""
                    if data:
                        os.write(stdout_fd, data)
                    else:
                        _, st = os.waitpid(pid, 0)
                        status = st
                        break
                else:
                    try:
                        data = os.read(stdin_fd, 65536)
                    except OSError:
                        data = b""
                    if not data:
                        watch_stdin = False
                    else:
                        try:
                            os.write(master, data)
                        except OSError:
                            pass
    finally:
        try:
            os.close(master)
        except OSError:
            pass
    if status is None:
        _, status = os.waitpid(pid, 0)
    return os.waitstatus_to_exitcode(status)


sys.exit(main())
`

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
 * macOS goes through the Python relay (its `script` can't take piped stdin);
 * util-linux uses `script -e -c` over a generated wrapper script.
 */
export async function startPty(options: StartPtyOptions): Promise<PtySession> {
  const runnerDir = mkdtempSync(join(tmpdir(), 'claude-pty-'))
  const command = ['bun', ...defineArgs, ...featureArgs, ENTRY, ...options.args]

  let spawnArgs: string[]
  if (process.platform === 'darwin') {
    // macOS `script` rejects a piped stdin ("tcgetattr/ioctl: Operation not
    // supported on socket") — true on the GitHub runner. Drive the CLI on a
    // pty through a small Python relay instead: it forwards our stdin/stdout
    // and exits with the child's status, even while our stdin stays open.
    const runner = join(runnerDir, 'pty_runner.py')
    writeFileSync(runner, PTY_RUNNER)
    spawnArgs = ['python3', runner, ...command]
  } else {
    // util-linux `script` takes the command via -c; a wrapper script keeps
    // argument quoting identical.
    const runner = join(runnerDir, 'run.sh')
    writeFileSync(runner, `#!/bin/sh\nexec ${command.map(shellQuote).join(' ')}\n`)
    chmodSync(runner, 0o755)
    spawnArgs = ['script', '-q', '-e', '-c', runner, '/dev/null']
  }

  const proc = spawn(spawnArgs, {
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
      // Ink paints horizontal gaps as cursor-forward escapes (`ESC[nC`), so a
      // word-gapped phrase like "for shortcuts" never appears verbatim in the
      // raw stream. Compare with escapes and whitespace removed.
      const wanted = normalizeForMatch(text)
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        if (normalizeForMatch(buffer).includes(wanted)) return
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
