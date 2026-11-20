/**
 * End-to-end: boot the real CLI (src/entrypoints/cli.tsx) in print mode and run
 * its local commands — /peers, /workflows and /force-snip — against isolated
 * fixtures. None of these talk to the model, so the fake endpoint must stay
 * silent.
 *
 * Feature flags come from scripts/config.ts, so a command disappears from
 * headless mode if its flag is not enabled — which is exactly what this file
 * pins. Each run gets its own HOME, CLAUDE_CONFIG_DIR and working directory, so
 * the PID registry (`<config>/sessions/<pid>.json`) and `.claude/workflows/`
 * fixtures never touch the developer's real ~/.claude.
 */

import { afterAll, afterEach, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Subprocess } from 'bun'

import { startFakeAnthropic, textReply, type FakeAnthropic } from './fake-anthropic'
import { cleanupRoots, isolatedEnv, makeTempRoot, runCli, seedSession, spawnSleep, type TempRoot } from './harness'

const TEST_TIMEOUT = 120_000

const roots: string[] = []
const fakes: FakeAnthropic[] = []
const children: Subprocess[] = []

async function fake(): Promise<FakeAnthropic> {
  const server = await startFakeAnthropic(textReply('unused'))
  fakes.push(server)
  return server
}

function project(): TempRoot {
  const root = makeTempRoot()
  roots.push(root.root)
  return root
}

function run(root: TempRoot, server: FakeAnthropic, prompt: string) {
  return runCli({
    cwd: root.work,
    env: isolatedEnv({ home: root.home, config: root.config, baseUrl: server.url }),
    args: ['-p', prompt],
  })
}

afterEach(() => {
  for (const server of fakes.splice(0)) server.stop()
  cleanupRoots(roots)
})

afterAll(() => {
  for (const child of children) child.kill()
})

test(
  '/peers lists live sessions and hides dead PIDs',
  async () => {
    const root = project()
    const pid = spawnSleep(children)
    seedSession(root.config, {
      pid,
      sessionId: 'aaaaaaaa-1111-2222-3333-444444444444',
      name: 'e2e-peer',
      cwd: '/tmp/e2e-project',
    })
    writeFileSync(
      join(root.config, 'sessions', '999999.json'),
      JSON.stringify({ sessionId: 'bbbbbbbb-1111-2222-3333-444444444444', kind: 'bg', name: 'ghost' }),
    )
    const server = await fake()

    const result = await run(root, server, '/peers')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('NAME')
    expect(result.stdout).toContain('e2e-peer')
    expect(result.stdout).toContain(String(pid))
    expect(result.stdout).toContain('/tmp/e2e-project')
    expect(result.stdout).not.toContain('ghost')
    expect(server.requests.length).toBe(0)
  },
  TEST_TIMEOUT,
)

test(
  '/workflows explains how to define one when none exist',
  async () => {
    const root = project()
    const server = await fake()

    const result = await run(root, server, '/workflows')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('No workflows found in')
    expect(result.stdout).toContain(join('.claude', 'workflows'))
    expect(server.requests.length).toBe(0)
  },
  TEST_TIMEOUT,
)

test(
  '/workflows lists definitions from the project directory',
  async () => {
    const root = project()
    const dir = join(root.work, '.claude', 'workflows')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'release.yml'),
      'name: release\ndescription: Cut a release\nsteps:\n  - name: build\n    run: echo build\n',
    )
    const server = await fake()

    const result = await run(root, server, '/workflows')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('NAME')
    expect(result.stdout).toContain('release')
    expect(result.stdout).toContain('Cut a release')
    expect(result.stdout).toContain('/workflow-<slug>')
    expect(server.requests.length).toBe(0)
  },
  TEST_TIMEOUT,
)

test(
  '/force-snip reports nothing pending on a fresh session',
  async () => {
    const root = project()
    const server = await fake()

    // force-snip lives in INTERNAL_ONLY_COMMANDS, which COMMANDS() only
    // registers under USER_TYPE=ant. The harness strips the repo `.env`'s
    // USER_TYPE so CI and a dev machine agree, so opt in here explicitly.
    const env = isolatedEnv({ home: root.home, config: root.config, baseUrl: server.url })
    env.USER_TYPE = 'ant'
    const result = await runCli({ cwd: root.work, env, args: ['-p', '/force-snip'] })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('Nothing to snip')
    expect(server.requests.length).toBe(0)
  },
  TEST_TIMEOUT,
)
