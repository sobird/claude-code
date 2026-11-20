/**
 * End-to-end coverage of prompt and directory-access flags: the system prompt
 * overrides must land in the request the model actually receives, and
 * --add-dir must widen read access beyond the working directory.
 */

import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
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

async function fake(reply: Parameters<typeof startFakeAnthropic>[0]): Promise<FakeAnthropic> {
  const server = await startFakeAnthropic(reply)
  fakes.push(server)
  return server
}

function run(root: TempRoot, server: FakeAnthropic, args: string[]) {
  return runCli({
    cwd: root.work,
    env: isolatedEnv({ home: root.home, config: root.config, baseUrl: server.url }),
    args,
  })
}

afterEach(() => {
  for (const server of fakes.splice(0)) server.stop()
  cleanupRoots(roots)
})

test(
  'sends --append-system-prompt and --system-prompt to the model',
  async () => {
    const root = project()

    const appended = await fake(textReply('APPEND_OK'))
    const appendRun = await run(root, appended, [
      '-p',
      'hello',
      '--append-system-prompt',
      'APPENDED_MARKER_123',
      '--output-format',
      'json',
    ])
    expect(appendRun.exitCode).toBe(0)
    expect(lastJsonLine(appendRun.stdout).result).toBe('APPEND_OK')
    expect(JSON.stringify(appended.requests[0]?.body)).toContain('APPENDED_MARKER_123')

    const replaced = await fake(textReply('REPLACE_OK'))
    const replaceRun = await run(root, replaced, [
      '-p',
      'hello',
      '--system-prompt',
      'REPLACED_MARKER_456',
      '--output-format',
      'json',
    ])
    expect(replaceRun.exitCode).toBe(0)
    expect(lastJsonLine(replaceRun.stdout).result).toBe('REPLACE_OK')
    expect(JSON.stringify(replaced.requests[0]?.body)).toContain('REPLACED_MARKER_456')
  },
  TEST_TIMEOUT,
)

test(
  '--add-dir grants read access outside the working directory',
  async () => {
    const root = project()
    const shared = join(root.home, 'shared')
    mkdirSync(shared, { recursive: true })
    writeFileSync(join(root.work, 'inside.txt'), 'INSIDE\n')
    writeFileSync(join(shared, 'outside.txt'), 'ADD_DIR_CONTENT\n')
    const server = await fake([
      toolUseReply([{ name: 'Read', input: { file_path: join(shared, 'outside.txt') } }]),
      textReply('ADD_DIR_OK'),
    ])

    const result = await run(root, server, [
      '-p',
      'read the outside file',
      '--add-dir',
      shared,
      '--output-format',
      'json',
    ])
    expect(result.exitCode).toBe(0)
    const payload = lastJsonLine(result.stdout)
    expect(payload.result).toBe('ADD_DIR_OK')
    expect(payload.permission_denials).toEqual([])
    expect(JSON.stringify(server.requests[1]?.body)).toContain('ADD_DIR_CONTENT')
  },
  TEST_TIMEOUT,
)
