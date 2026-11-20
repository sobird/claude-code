/**
 * End-to-end coverage of the print-mode pipeline against a scripted model:
 * startup and isolated config, request/response formats, tool permission and
 * execution, content block types, stop reasons, API errors, turn limits and
 * session persistence.
 *
 * Every run spawns the real CLI from source with its own HOME, config dir and
 * working directory; the only fake is the Anthropic endpoint.
 */

import { afterEach, expect, test } from 'bun:test'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  errorReply,
  redactedThinkingReply,
  serverToolReply,
  startFakeAnthropic,
  stopReply,
  textReply,
  thinkingReply,
  toolUseReply,
  type FakeAnthropic,
  type FakeScript,
} from './fake-anthropic'
import { cleanupRoots, isolatedEnv, lastJsonLine, makeTempRoot, runCli, type TempRoot } from './harness'

const TEST_TIMEOUT = 120_000

const fakes: FakeAnthropic[] = []
const roots: string[] = []

async function fake(script: FakeScript): Promise<FakeAnthropic> {
  const server = await startFakeAnthropic(script)
  fakes.push(server)
  return server
}

function project(): TempRoot {
  const root = makeTempRoot()
  roots.push(root.root)
  return root
}

function run(root: TempRoot, server: FakeAnthropic, args: string[]) {
  return runCli({
    cwd: root.work,
    env: isolatedEnv({ home: root.home, config: root.config, baseUrl: server.url }),
    args,
  })
}

function collectJsonl(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return collectJsonl(path)
      return entry.name.endsWith('.jsonl') ? [path] : []
    })
  } catch {
    return []
  }
}

afterEach(() => {
  for (const server of fakes.splice(0)) server.stop()
  cleanupRoots(roots)
})

test(
  'streams text through the text, json and stream-json output formats',
  async () => {
    const root = project()
    const server = await fake(textReply('HELLO', { chunks: ['HE', 'LL', 'O'] }))

    const text = await run(root, server, ['-p', 'hello', '--output-format', 'text'])
    expect(text.exitCode).toBe(0)
    expect(text.stdout.trim()).toBe('HELLO')

    const json = await run(root, server, ['-p', 'hello', '--output-format', 'json'])
    expect(json.exitCode).toBe(0)
    const result = lastJsonLine(json.stdout)
    expect(result.type).toBe('result')
    expect(result.result).toBe('HELLO')
    expect(result.is_error).toBe(false)
    expect(typeof result.session_id).toBe('string')

    const stream = await run(root, server, ['-p', 'hello', '--output-format', 'stream-json', '--verbose'])
    expect(stream.exitCode).toBe(0)
    expect(stream.stdout).toContain('"type":"assistant"')
    expect(lastJsonLine(stream.stdout).type).toBe('result')
  },
  TEST_TIMEOUT,
)

test(
  'executes parallel reads, split arguments, edits and shell commands',
  async () => {
    const root = project()
    writeFileSync(join(root.work, 'a.txt'), 'ALPHA\n')
    writeFileSync(join(root.work, 'b.txt'), 'BETA\n')
    const server = await fake([
      toolUseReply([
        { name: 'Read', input: { file_path: 'a.txt' }, split: true },
        { name: 'Read', input: { file_path: 'b.txt' } },
      ]),
      toolUseReply([{ name: 'Edit', input: { file_path: 'b.txt', old_string: 'BETA', new_string: 'BETA2' } }]),
      toolUseReply([{ name: 'Bash', input: { command: 'cat b.txt' } }]),
      textReply('CHAIN_OK'),
    ])

    const result = await run(root, server, [
      '-p',
      'run the chain',
      '--allowedTools',
      'Read',
      'Edit',
      'Bash',
      '--output-format',
      'json',
    ])
    expect(result.exitCode).toBe(0)
    const payload = lastJsonLine(result.stdout)
    expect(payload.result).toBe('CHAIN_OK')
    expect(payload.permission_denials).toEqual([])
    expect(server.requests.length).toBe(4)

    const afterReads = JSON.stringify(server.requests[1]?.body)
    expect(afterReads).toContain('ALPHA')
    expect(afterReads).toContain('BETA')
    expect(afterReads).toContain('tool_result')

    expect(JSON.stringify(server.requests[3]?.body)).toContain('BETA2')
    expect(readFileSync(join(root.work, 'b.txt'), 'utf8')).toBe('BETA2\n')

    const sessions = collectJsonl(join(root.config, 'projects'))
    expect(sessions.length).toBeGreaterThan(0)
    expect(sessions.some((file) => readFileSync(file, 'utf8').includes('CHAIN_OK'))).toBe(true)
  },
  TEST_TIMEOUT,
)

test(
  'reports permission denials without exposing file contents',
  async () => {
    const root = project()
    // Outside the working directory: reads inside the cwd are allowed by
    // default, so only an outside path actually needs a permission decision.
    const secret = join(root.home, 'secret.txt')
    writeFileSync(secret, 'TOPSECRET\n')
    const server = await fake([
      toolUseReply([{ name: 'Read', input: { file_path: secret } }]),
      textReply('DENIED_SEEN'),
    ])

    const result = await run(root, server, ['-p', 'read it', '--output-format', 'json'])
    expect(result.exitCode).toBe(0)
    const payload = lastJsonLine(result.stdout)
    expect(payload.result).toBe('DENIED_SEEN')

    const denials = payload.permission_denials as Array<{ tool_name: string }>
    expect(denials.map((denial) => denial.tool_name)).toContain('Read')

    const second = JSON.stringify(server.requests[1]?.body)
    expect(second).toContain('tool_result')
    expect(second).toContain('is_error')
    expect(second).not.toContain('TOPSECRET')
  },
  TEST_TIMEOUT,
)

test(
  '--settings can grant tool permissions',
  async () => {
    const root = project()
    const secret = join(root.home, 'secret.txt')
    writeFileSync(secret, 'TOPSECRET\n')
    const server = await fake([
      toolUseReply([{ name: 'Read', input: { file_path: secret } }]),
      textReply('SETTINGS_OK'),
    ])
    const settings = JSON.stringify({ permissions: { allow: ['Read'] } })

    const result = await run(root, server, ['-p', 'read it', '--settings', settings, '--output-format', 'json'])
    expect(result.exitCode).toBe(0)
    expect(lastJsonLine(result.stdout).result).toBe('SETTINGS_OK')
    expect(JSON.stringify(server.requests[1]?.body)).toContain('TOPSECRET')
  },
  TEST_TIMEOUT,
)

test(
  '--disallowedTools overrides --allowedTools',
  async () => {
    const root = project()
    writeFileSync(join(root.work, 'secret.txt'), 'TOPSECRET\n')
    const server = await fake([
      toolUseReply([{ name: 'Read', input: { file_path: 'secret.txt' } }]),
      textReply('DISALLOWED_OK'),
    ])

    const result = await run(root, server, [
      '-p',
      'read it',
      '--allowedTools',
      'Read',
      '--disallowedTools',
      'Read',
      '--output-format',
      'json',
    ])
    expect(result.exitCode).toBe(0)
    expect(lastJsonLine(result.stdout).result).toBe('DISALLOWED_OK')
    // A deny rule removes the tool entirely, so the call comes back as an
    // error result rather than a permission request.
    const second = JSON.stringify(server.requests[1]?.body)
    expect(second).toContain('is_error')
    expect(second).not.toContain('TOPSECRET')
  },
  TEST_TIMEOUT,
)

test(
  'renders thinking, redacted thinking and server tool blocks',
  async () => {
    const root = project()

    const thinking = await fake(thinkingReply('deliberating', 'THINK_OK'))
    const thinkRun = await run(root, thinking, ['-p', 'think', '--output-format', 'stream-json', '--verbose'])
    expect(thinkRun.exitCode).toBe(0)
    expect(thinkRun.stdout).toContain('deliberating')
    expect(lastJsonLine(thinkRun.stdout).result).toBe('THINK_OK')

    const redacted = await fake(redactedThinkingReply('REDACTED_OK'))
    const redactedRun = await run(root, redacted, ['-p', 'redacted', '--output-format', 'json'])
    expect(redactedRun.exitCode).toBe(0)
    expect(lastJsonLine(redactedRun.stdout).result).toBe('REDACTED_OK')

    const serverTool = await fake(serverToolReply('claude code', 'SERVER_OK'))
    const serverRun = await run(root, serverTool, ['-p', 'search', '--output-format', 'json'])
    expect(serverRun.exitCode).toBe(0)
    expect(lastJsonLine(serverRun.stdout).result).toBe('SERVER_OK')
  },
  TEST_TIMEOUT,
)

test(
  'handles max_tokens recovery and refusal stop reasons',
  async () => {
    const root = project()

    // max_tokens triggers an automatic "keep going" retry. When the model
    // resumes normally the turn succeeds; the fake script answers the first
    // (truncated) call and the recovery call differently.
    const recovered = await fake([stopReply('max_tokens', 'TRUNCATED'), textReply('RESUMED')])
    const recoveredRun = await run(root, recovered, ['-p', 'long answer', '--output-format', 'json'])
    expect(recoveredRun.exitCode).toBe(0)
    expect(lastJsonLine(recoveredRun.stdout).result).toBe('RESUMED')
    expect(recovered.requests.length).toBe(2)

    // If every attempt keeps truncating, recovery is exhausted and the CLI
    // surfaces an error result with a non-zero exit.
    const exhausted = await fake(stopReply('max_tokens', 'TRUNCATED'))
    const exhaustedRun = await run(root, exhausted, ['-p', 'long answer', '--output-format', 'json'])
    expect(exhaustedRun.exitCode).toBe(1)
    const exhaustedPayload = lastJsonLine(exhaustedRun.stdout)
    expect(exhaustedPayload.is_error).toBe(true)
    expect(String(exhaustedPayload.result)).toContain('output token maximum')
    expect(exhausted.requests.length).toBeGreaterThan(1)

    const refusal = await fake(stopReply('refusal', ''))
    const refusalRun = await run(root, refusal, ['-p', 'refuse this', '--output-format', 'json'])
    expect(refusalRun.exitCode).toBe(1)
    expect(refusalRun.stdout).toContain('Usage Policy')
  },
  TEST_TIMEOUT,
)

test(
  'surfaces API errors with a non-zero exit',
  async () => {
    const root = project()
    const server = await fake(errorReply(400, 'invalid_request_error', 'malformed faux request'))

    const result = await run(root, server, ['-p', 'boom', '--output-format', 'json'])
    expect(result.exitCode).toBe(1)
    expect(result.stdout + result.stderr).toContain('malformed faux request')
  },
  TEST_TIMEOUT,
)

test(
  '--max-turns stops a tool loop',
  async () => {
    const root = project()
    writeFileSync(join(root.work, 'a.txt'), 'ALPHA\n')
    const server = await fake([toolUseReply([{ name: 'Read', input: { file_path: 'a.txt' } }])])

    const result = await run(root, server, [
      '-p',
      'loop forever',
      '--allowedTools',
      'Read',
      '--max-turns',
      '2',
      '--output-format',
      'json',
    ])
    expect(result.exitCode).toBe(1)
    const payload = lastJsonLine(result.stdout)
    expect(payload.subtype).toBe('error_max_turns')
    expect(payload.is_error).toBe(true)
  },
  TEST_TIMEOUT,
)

test(
  'persists sessions and restores them via resume and fork',
  async () => {
    const root = project()

    const first = await fake(textReply('FIRST'))
    const firstRun = await run(root, first, ['-p', 'first message', '--output-format', 'json'])
    expect(firstRun.exitCode).toBe(0)
    const firstPayload = lastJsonLine(firstRun.stdout)
    expect(firstPayload.result).toBe('FIRST')
    const sessionId = String(firstPayload.session_id)

    const second = await fake(textReply('SECOND'))
    const resumed = await run(root, second, ['-r', sessionId, '-p', 'second message', '--output-format', 'json'])
    expect(resumed.exitCode).toBe(0)
    const resumedPayload = lastJsonLine(resumed.stdout)
    expect(resumedPayload.result).toBe('SECOND')
    expect(resumedPayload.session_id).toBe(sessionId)
    expect(JSON.stringify(second.requests[0]?.body)).toContain('first message')

    const third = await fake(textReply('THIRD'))
    const forked = await run(root, third, [
      '-r',
      sessionId,
      '--fork-session',
      '-p',
      'third message',
      '--output-format',
      'json',
    ])
    expect(forked.exitCode).toBe(0)
    const forkedPayload = lastJsonLine(forked.stdout)
    expect(forkedPayload.result).toBe('THIRD')
    expect(forkedPayload.session_id).not.toBe(sessionId)
    expect(JSON.stringify(third.requests[0]?.body)).toContain('first message')

    // --continue resolves the most recent session for the cwd, but print-mode
    // transcripts carry entrypoint=sdk-cli and are filtered out of that list
    // (they are not interactive conversations). So -c starts a fresh session
    // instead of picking up the forked one; --resume <id> is the way to
    // restore a -p session.
    const fourth = await fake(textReply('FOURTH'))
    const continued = await run(root, fourth, ['-c', '-p', 'fourth message', '--output-format', 'json'])
    expect(continued.exitCode).toBe(0)
    const continuedPayload = lastJsonLine(continued.stdout)
    expect(continuedPayload.result).toBe('FOURTH')
    expect(continuedPayload.session_id).not.toBe(forkedPayload.session_id)
    expect(JSON.stringify(fourth.requests[0]?.body)).not.toContain('third message')
  },
  TEST_TIMEOUT,
)
