/**
 * End-to-end coverage of PreToolUse command hooks. The hook is configured
 * through --settings, runs as a real subprocess, and its exit-code-2 blocking
 * feedback must stop the tool from executing and reach the model instead.
 */

import { afterEach, expect, test } from 'bun:test'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { startFakeAnthropic, textReply, toolUseReply, type FakeAnthropic } from './fake-anthropic'
import { cleanupRoots, isolatedEnv, lastJsonLine, makeTempRoot, runCli, type TempRoot } from './harness'

const TEST_TIMEOUT = 120_000

const fakes: FakeAnthropic[] = []
const roots: string[] = []

function project(): TempRoot {
  const root = makeTempRoot()
  roots.push(root.root)
  return root
}

afterEach(() => {
  for (const server of fakes.splice(0)) server.stop()
  cleanupRoots(roots)
})

test(
  'a PreToolUse hook blocks Bash and reports the reason to the model',
  async () => {
    const root = project()

    // Exit code 2 is the blocking path; stderr becomes the denial reason.
    const hook = join(root.home, 'deny-hook.mjs')
    writeFileSync(hook, "console.error('blocked by policy')\nprocess.exit(2)\n")
    const settings = JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `bun "${hook}"` }] }],
      },
    })

    const server = await startFakeAnthropic([
      toolUseReply([{ name: 'Bash', input: { command: 'touch marker.txt' } }]),
      textReply('HOOK_BLOCKED_SEEN'),
    ])
    fakes.push(server)

    const result = await runCli({
      cwd: root.work,
      env: isolatedEnv({ home: root.home, config: root.config, baseUrl: server.url }),
      args: ['-p', 'try to run bash', '--allowedTools', 'Bash', '--settings', settings, '--output-format', 'json'],
    })
    expect(result.exitCode).toBe(0)
    expect(lastJsonLine(result.stdout).result).toBe('HOOK_BLOCKED_SEEN')

    // The tool never ran, and the model saw the hook's stderr as the reason.
    expect(existsSync(join(root.work, 'marker.txt'))).toBe(false)
    expect(JSON.stringify(server.requests[1]?.body)).toContain('blocked by policy')
  },
  TEST_TIMEOUT,
)
