import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { spawn, type Subprocess } from 'bun'

import {
  attachHandler,
  defaultBgName,
  findTmuxSessionByPid,
  formatSessionsTable,
  getBgNameArg,
  handleBgFlag,
  killHandler,
  logsHandler,
  parseTmuxPaneList,
  psHandler,
  resolveSessionTarget,
  stripBgFlags,
  tailLines,
  type BgSessionRecord,
} from '../src/cli/bg'

const AT = Date.parse('2026-11-20T12:00:00Z')

function rec(patch: Partial<BgSessionRecord>): BgSessionRecord {
  return {
    pid: 1000,
    sessionId: '11111111-2222-3333-4444-555555555555',
    cwd: '/repo',
    startedAt: AT - 5 * 60_000,
    kind: 'bg',
    name: 'task-one',
    ...patch,
  }
}

describe('stripBgFlags', () => {
  test('removes both flag spellings and keeps other args', () => {
    expect(stripBgFlags(['--bg', '--model', 'opus', 'fix tests'])).toEqual(['--model', 'opus', 'fix tests'])
    expect(stripBgFlags(['fix tests', '--background'])).toEqual(['fix tests'])
    expect(stripBgFlags(['--model', 'opus'])).toEqual(['--model', 'opus'])
  })
})

describe('getBgNameArg', () => {
  test('reads --name in both forms', () => {
    expect(getBgNameArg(['--name', 'nightly', '--bg'])).toBe('nightly')
    expect(getBgNameArg(['--bg', '--name=nightly'])).toBe('nightly')
    expect(getBgNameArg(['--bg'])).toBeUndefined()
  })
})

describe('defaultBgName', () => {
  test('prefers an explicit --name', () => {
    expect(defaultBgName(['--name', 'nightly', 'fix'], '/work/repo')).toBe('nightly')
  })

  test('uses the first positional prompt, trimmed and capped', () => {
    expect(defaultBgName(['--model', 'opus', 'Fix the failing tests now'], '/work/repo')).toBe(
      'Fix the failing tests now',
    )
    expect(defaultBgName(['a'.repeat(80)], '/work/repo')).toHaveLength(48)
  })

  test('falls back to the working directory name', () => {
    expect(defaultBgName([], '/work/my-repo')).toBe('my-repo')
    expect(defaultBgName(['--model', 'opus'], '/')).toBe('background')
  })
})

describe('resolveSessionTarget', () => {
  const alpha = rec({ pid: 1001, sessionId: 'aaaaaaaa-1111-2222-3333-444444444444', name: 'alpha' })
  const beta = rec({ pid: 1002, sessionId: 'bbbbbbbb-1111-2222-3333-444444444444', name: 'beta' })

  test('matches an exact session ID', () => {
    const result = resolveSessionTarget([alpha, beta], alpha.sessionId)
    expect(result).toEqual({ ok: true, record: alpha })
  })

  test('matches a unique session ID prefix', () => {
    const result = resolveSessionTarget([alpha, beta], 'bbbb')
    expect(result).toEqual({ ok: true, record: beta })
  })

  test('matches a name and a PID', () => {
    expect(resolveSessionTarget([alpha, beta], 'alpha')).toEqual({ ok: true, record: alpha })
    expect(resolveSessionTarget([alpha, beta], '1002')).toEqual({ ok: true, record: beta })
  })

  test('reports an ambiguous name with candidate IDs', () => {
    const dupA = rec({ pid: 1003, sessionId: 'cccccccc-1111-2222-3333-444444444444', name: 'dup' })
    const dupB = rec({ pid: 1004, sessionId: 'dddddddd-1111-2222-3333-444444444444', name: 'dup' })
    const result = resolveSessionTarget([dupA, dupB], 'dup')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Multiple sessions match')
  })

  test('reports a missing target', () => {
    const missing = resolveSessionTarget([alpha, beta], undefined)
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error).toContain('Missing session ID')

    const unknown = resolveSessionTarget([alpha, beta], 'zzz')
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.error).toContain("No session matches 'zzz'")
  })
})

describe('formatSessionsTable', () => {
  test('renders name, short ID, kind, status, PID and age', () => {
    const table = formatSessionsTable([rec({ pid: 4242, status: 'waiting', waitingFor: 'approve Bash' })], AT)
    expect(table).toContain('NAME')
    expect(table).toContain('task-one')
    expect(table).toContain('11111111')
    expect(table).toContain('bg')
    expect(table).toContain('waiting: approve Bash')
    expect(table).toContain('4242')
    expect(table).toContain('5m ago')
    expect(table).toContain('/repo')
  })

  test('handles an empty registry', () => {
    expect(formatSessionsTable([], AT)).toBe('No live sessions.')
  })
})

describe('tailLines', () => {
  test('returns the last N lines without a trailing newline', () => {
    expect(tailLines('a\nb\nc\n', 2)).toBe('b\nc')
    expect(tailLines('only', 2)).toBe('only')
    expect(tailLines('', 2)).toBe('')
  })
})

describe('tmux pane mapping', () => {
  test('parses pane PID to session name and looks up by PID', () => {
    const panes = parseTmuxPaneList('123\tclaude-bg-one\nnot-a-pid\tignored\n456\tclaude-bg-two\n')
    expect(panes).toEqual([
      { pid: 123, sessionName: 'claude-bg-one' },
      { pid: 456, sessionName: 'claude-bg-two' },
    ])
    expect(findTmuxSessionByPid(panes, 456)).toBe('claude-bg-two')
    expect(findTmuxSessionByPid(panes, 999)).toBeUndefined()
  })
})

describe('handlers', () => {
  const root = mkdtempSync(join(tmpdir(), 'bg-sessions-'))
  const configDir = join(root, 'config')
  const binDir = join(root, 'bin')
  const sessionsDir = join(configDir, 'sessions')
  const fakeLog = join(root, 'tmux.log')
  const panesFile = join(root, 'panes.txt')
  const fakeTmux = join(binDir, 'tmux')

  const originalEnv = {
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
    PATH: process.env.PATH,
    TMUX: process.env.TMUX,
    TMUX_FAKE_LOG: process.env.TMUX_FAKE_LOG,
    TMUX_FAKE_PANES: process.env.TMUX_FAKE_PANES,
    TMUX_FAKE_PANE_PID: process.env.TMUX_FAKE_PANE_PID,
  }
  const spawned: Subprocess[] = []

  beforeAll(() => {
    mkdirSync(sessionsDir, { recursive: true })
    mkdirSync(binDir, { recursive: true })
    writeFileSync(
      fakeTmux,
      `#!/bin/sh
{
  printf 'ARGS:'
  for a in "$@"; do printf ' %s' "$a"; done
  printf '\\n'
  printf 'ENV KIND=%s NAME=%s LOG=%s TMUX=%s\\n' "$CLAUDE_CODE_SESSION_KIND" "$CLAUDE_CODE_SESSION_NAME" "$CLAUDE_CODE_SESSION_LOG" "$CLAUDE_CODE_TMUX_SESSION"
} >> "$TMUX_FAKE_LOG"
case "$1" in
  -V) echo 'tmux 3.4'; exit 0 ;;
  has-session) exit 1 ;;
  new-session) echo "\${TMUX_FAKE_PANE_PID:-4242}"; exit 0 ;;
  list-panes) cat "$TMUX_FAKE_PANES"; exit 0 ;;
  *) exit 0 ;;
esac
`,
    )
    chmodSync(fakeTmux, 0o755)
    writeFileSync(panesFile, '')
    writeFileSync(fakeLog, '')

    process.env.CLAUDE_CONFIG_DIR = configDir
    process.env.PATH = `${binDir}:${originalEnv.PATH ?? ''}`
    process.env.TMUX_FAKE_LOG = fakeLog
    process.env.TMUX_FAKE_PANES = panesFile
    delete process.env.TMUX
  })

  afterAll(() => {
    for (const child of spawned) child.kill()
    for (const key of Object.keys(originalEnv) as Array<keyof typeof originalEnv>) {
      const value = originalEnv[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(root, { recursive: true, force: true })
  })

  beforeEach(() => {
    writeFileSync(fakeLog, '')
    writeFileSync(panesFile, '')
    rmSync(sessionsDir, { recursive: true, force: true })
    mkdirSync(sessionsDir, { recursive: true })
  })

  function spawnSleep(): number {
    const child = spawn(['sleep', '30'])
    spawned.push(child)
    return child.pid
  }

  function writeSession(record: BgSessionRecord): void {
    writeFileSync(join(sessionsDir, `${record.pid}.json`), JSON.stringify(record))
  }

  async function capture(
    fn: () => Promise<void>,
  ): Promise<{ stdout: string; stderr: string; exitCode: typeof process.exitCode }> {
    const out: string[] = []
    const err: string[] = []
    const originalLog = console.log
    const originalError = console.error
    const originalExitCode = process.exitCode
    console.log = (...args: unknown[]) => {
      out.push(args.map(String).join(' '))
    }
    console.error = (...args: unknown[]) => {
      err.push(args.map(String).join(' '))
    }
    try {
      await fn()
      return { stdout: out.join('\n'), stderr: err.join('\n'), exitCode: process.exitCode }
    } finally {
      console.log = originalLog
      console.error = originalError
      process.exitCode = originalExitCode
    }
  }

  test('psHandler lists live sessions and skips dead PIDs', async () => {
    const pid = spawnSleep()
    writeSession({
      pid,
      sessionId: 'aaaaaaaa-1111-2222-3333-444444444444',
      cwd: '/work/repo',
      startedAt: Date.now() - 60_000,
      kind: 'bg',
      name: 'nightly',
      status: 'waiting',
      waitingFor: 'approve Bash',
    })
    writeSession({ pid: 999_999, sessionId: 'bbbbbbbb-1111-2222-3333-444444444444', kind: 'bg', name: 'ghost' })

    const result = await capture(() => psHandler([]))
    expect(result.stdout).toContain('nightly')
    expect(result.stdout).toContain(String(pid))
    expect(result.stdout).toContain('waiting: approve Bash')
    expect(result.stdout).not.toContain('ghost')
  })

  test('logsHandler prints the tail of the session log', async () => {
    const pid = spawnSleep()
    const logPath = join(root, 'session.log')
    const lines = Array.from({ length: 300 }, (_, i) => `l${String(i + 1).padStart(4, '0')}`)
    writeFileSync(logPath, lines.join('\n'))
    const sessionId = 'cccccccc-1111-2222-3333-444444444444'
    writeSession({ pid, sessionId, kind: 'bg', logPath })

    const result = await capture(() => logsHandler(sessionId))
    expect(result.stdout).toContain('l0300')
    expect(result.stdout).not.toContain('l0001')
    expect(result.stdout).toContain(logPath)
  })

  test('killHandler targets the tmux session that owns the PID', async () => {
    const pid = spawnSleep()
    const sessionId = 'dddddddd-1111-2222-3333-444444444444'
    writeSession({ pid, sessionId, kind: 'bg' })
    writeFileSync(panesFile, `${pid}\tclaude-bg-${sessionId}\n`)

    const result = await capture(() => killHandler(sessionId))
    const calls = readFileSync(fakeLog, 'utf8')
    expect(calls).toContain(`kill-session -t claude-bg-${sessionId}`)
    expect(result.stdout).toContain('claude-bg-')
  })

  test('attachHandler attaches to the tmux session that owns the PID', async () => {
    const pid = spawnSleep()
    const sessionId = 'eeeeeeee-1111-2222-3333-444444444444'
    writeSession({ pid, sessionId, kind: 'bg' })
    writeFileSync(panesFile, `${pid}\tclaude-bg-${sessionId}\n`)

    await capture(() => attachHandler(sessionId))
    const calls = readFileSync(fakeLog, 'utf8')
    expect(calls).toContain(`attach-session -t claude-bg-${sessionId}`)
  })

  test('handleBgFlag starts a detached tmux session with bg env and a session ID', async () => {
    const result = await capture(() => handleBgFlag(['--bg', '--name', 'nightly', 'fix tests', '--model', 'opus']))
    const calls = readFileSync(fakeLog, 'utf8')

    expect(calls).toContain('new-session -d')
    expect(calls).toContain('-s claude-bg-')
    expect(calls).toContain('fix tests')
    expect(calls).toContain('--name nightly')
    expect(calls).toContain('--session-id')
    expect(calls).not.toContain('--bg')
    expect(calls).toContain('KIND=bg')
    expect(calls).toContain('NAME=nightly')
    expect(calls).toContain('LOG=')
    expect(calls).toContain('pipe-pane')
    expect(result.stdout).toContain('claude attach')
    expect(result.stdout).toContain('claude logs')
  })

  test('unknown targets fail with an actionable error', async () => {
    const result = await capture(() => killHandler('zzz'))
    expect(result.stderr).toContain("No session matches 'zzz'")
    expect(result.exitCode).toBe(1)
  })
})
