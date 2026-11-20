/**
 * End-to-end coverage of a real terminal session.
 *
 * The CLI runs attached to a PTY (via the platform's `script`), so Ink takes
 * its interactive path: onboarding is skipped through seeded config, a typed
 * prompt goes through the scripted model, a local slash command renders its
 * table, and /exit shuts the process down cleanly.
 *
 * Windows has no `script` equivalent; the suite is skipped there.
 */

import { afterAll, afterEach, expect, test } from 'bun:test'

import type { Subprocess } from 'bun'

import { startFakeAnthropic, textReply, type FakeAnthropic } from './fake-anthropic'
import {
  cleanupRoots,
  isolatedEnv,
  makeTempRoot,
  ptySupported,
  seedInteractiveConfig,
  seedSession,
  spawnSleep,
  startPty,
  stripAnsi,
  type PtySession,
} from './harness'

const TEST_TIMEOUT = 120_000

const roots: string[] = []
const fakes: FakeAnthropic[] = []
const sessions: PtySession[] = []
const children: Subprocess[] = []

afterEach(async () => {
  for (const session of sessions.splice(0)) await session.dispose()
  for (const server of fakes.splice(0)) server.stop()
  cleanupRoots(roots)
})

afterAll(() => {
  for (const child of children) child.kill()
})

test.skipIf(!ptySupported())(
  'interactive session runs a model turn, a local command and exits cleanly',
  async () => {
    const root = makeTempRoot()
    roots.push(root.root)
    seedInteractiveConfig(root)

    const pid = spawnSleep(children)
    seedSession(root.config, {
      pid,
      sessionId: 'aaaaaaaa-1111-2222-3333-444444444444',
      name: 'e2e-peer',
      cwd: '/tmp/e2e-project',
    })

    const server = await startFakeAnthropic(textReply('INTERACTIVE_OK'))
    fakes.push(server)

    const session = await startPty({
      cwd: root.work,
      env: isolatedEnv({ home: root.home, config: root.config, baseUrl: server.url }),
      args: [],
    })
    sessions.push(session)

    // The REPL is ready once the input hint renders.
    await session.waitFor('for shortcuts')

    session.write('hello there\r')
    await session.waitFor('INTERACTIVE_OK')
    expect(server.requests.length).toBeGreaterThan(0)

    session.write('/peers\r')
    await session.waitFor('e2e-peer')

    session.write('/exit\r')
    const exitCode = await Promise.race([
      session.exited,
      Bun.sleep(20_000).then(() => {
        throw new Error('interactive CLI did not exit after /exit')
      }),
    ])
    expect(exitCode).toBe(0)

    const output = stripAnsi(session.output())
    // Printed on a clean shutdown, so it doubles as proof /exit was handled.
    expect(output).toContain('Resume this session with')
    expect(output).not.toContain('Detected a custom API key')
    expect(output).not.toContain('Auth conflict')
  },
  TEST_TIMEOUT,
)
