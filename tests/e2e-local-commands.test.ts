/**
 * End-to-end: boot the real CLI (src/entrypoints/cli.tsx) in print mode and run
 * the local commands implemented in this change — /peers, /workflows, and
 * /force-snip — against isolated fixtures.
 *
 * Each spawn gets its own CLAUDE_CONFIG_DIR and working directory, so the PID
 * registry (`<config>/sessions/<pid>.json`) and `.claude/workflows/` fixtures
 * never touch the developer's real ~/.claude. Feature flags come from
 * scripts/config.ts, so a command disappears from headless mode if its flag is
 * not enabled — which is exactly what this test pins.
 */

import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { spawn, type Subprocess } from 'bun'

import { defineArgs, featureArgs } from '../scripts/config'

const ENTRY = resolve(import.meta.dir, '../src/entrypoints/cli.tsx')
const TEST_TIMEOUT = 120_000

const roots: string[] = []
const children: Subprocess[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'e2e-local-commands-'))
  roots.push(root)
  return root
}

type CliResult = { stdout: string; stderr: string; exitCode: number }

/** Runs `claude -p "<prompt>"` from TypeScript source with the build's flags. */
async function runCli(cwd: string, configDir: string, prompt: string): Promise<CliResult> {
  const proc = spawn(['bun', ...defineArgs, ...featureArgs, ENTRY, '-p', prompt], {
    cwd,
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: configDir,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout, stderr, exitCode }
}

function seedSession(
  configDir: string,
  record: { pid: number; sessionId: string; name: string; cwd?: string; kind?: string; status?: string },
): void {
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

function spawnSleep(): number {
  const child = spawn(['sleep', '30'])
  children.push(child)
  return child.pid
}

afterAll(() => {
  for (const child of children) child.kill()
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe('e2e: /peers', () => {
  test(
    'lists a live registered session and skips a dead PID',
    async () => {
      const root = tempRoot()
      const configDir = join(root, 'config')
      const pid = spawnSleep()
      seedSession(configDir, {
        pid,
        sessionId: 'aaaaaaaa-1111-2222-3333-444444444444',
        name: 'e2e-peer',
        cwd: '/tmp/e2e-project',
      })
      writeFileSync(
        join(configDir, 'sessions', '999999.json'),
        JSON.stringify({ sessionId: 'bbbbbbbb-1111-2222-3333-444444444444', kind: 'bg', name: 'ghost' }),
      )

      const result = await runCli(root, configDir, '/peers')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('NAME')
      expect(result.stdout).toContain('e2e-peer')
      expect(result.stdout).toContain(String(pid))
      expect(result.stdout).toContain('/tmp/e2e-project')
      expect(result.stdout).not.toContain('ghost')
    },
    TEST_TIMEOUT,
  )
})

describe('e2e: /workflows', () => {
  test(
    'lists YAML and JSON definitions from .claude/workflows',
    async () => {
      const root = tempRoot()
      const configDir = join(root, 'config')
      const workflowsDir = join(root, '.claude', 'workflows')
      mkdirSync(workflowsDir, { recursive: true })
      writeFileSync(
        join(workflowsDir, 'build.yaml'),
        'name: Build & Test\ndescription: compile and verify\nsteps:\n  - action: shell\n    command: echo hi\n  - action: shell\n    command: echo bye\n',
      )
      writeFileSync(
        join(workflowsDir, 'deploy.json'),
        JSON.stringify({ name: 'deploy', steps: [{ action: 'shell', command: 'echo deploy' }] }),
      )
      writeFileSync(join(workflowsDir, 'notes.txt'), 'not a workflow')

      const result = await runCli(root, configDir, '/workflows')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('STEPS')
      expect(result.stdout).toMatch(/Build & Test\s+2/)
      expect(result.stdout).toMatch(/deploy\s+1/)
      expect(result.stdout).toContain('compile and verify')
      expect(result.stdout).toContain('/workflow-')
      expect(result.stdout).not.toContain('notes')
    },
    TEST_TIMEOUT,
  )

  test(
    'reports an empty workflow directory with the expected location',
    async () => {
      const root = tempRoot()
      const configDir = join(root, 'config')
      mkdirSync(root, { recursive: true })

      const result = await runCli(root, configDir, '/workflows')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('No workflows found')
      expect(result.stdout).toContain('.claude/workflows')
    },
    TEST_TIMEOUT,
  )
})

describe('e2e: /force-snip', () => {
  test(
    'runs headlessly and reports nothing to snip on a fresh session',
    async () => {
      const root = tempRoot()
      const configDir = join(root, 'config')

      const result = await runCli(root, configDir, '/force-snip')

      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Nothing to snip')
    },
    TEST_TIMEOUT,
  )
})
