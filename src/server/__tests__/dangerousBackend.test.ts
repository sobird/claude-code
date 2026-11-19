import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildSessionArgs, DangerousBackend } from '../backends/dangerousBackend.js'
import type { BackendExitInfo, BackendSpawnOpts } from '../sessionManager.js'

const OPTS: BackendSpawnOpts = {
  sessionId: 'sess-1',
  cwd: '/work',
  dangerouslySkipPermissions: false,
}

describe('buildSessionArgs', () => {
  test('builds the stream-json stdio protocol with the session id', () => {
    const args = buildSessionArgs(OPTS)
    expect(args).toEqual([
      '--print',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-prompt-tool',
      'stdio',
      '--session-id',
      'sess-1',
    ])
  })

  test('adds --dangerously-skip-permissions and skips permission-mode', () => {
    const args = buildSessionArgs({ ...OPTS, dangerouslySkipPermissions: true, permissionMode: 'plan' })
    expect(args).toContain('--dangerously-skip-permissions')
    expect(args).not.toContain('--permission-mode')
  })

  test('adds --permission-mode when a mode is given', () => {
    const args = buildSessionArgs({ ...OPTS, permissionMode: 'acceptEdits' })
    expect(args).toContain('--permission-mode')
    expect(args[args.indexOf('--permission-mode') + 1]).toBe('acceptEdits')
  })
})

/** Poll until `predicate` is true or fail the test. */
function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (predicate()) return resolve()
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out waiting for condition'))
      setTimeout(tick, 10)
    }
    tick()
  })
}

function writeFakeCli(): string {
  const path = join(tmpdir(), `cc-fake-cli-${randomUUID()}.mjs`)
  writeFileSync(
    path,
    `let buf = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buf += chunk
  let idx
  while ((idx = buf.indexOf('\\n')) !== -1) {
    const line = buf.slice(0, idx)
    buf = buf.slice(idx + 1)
    if (line === '__exit__') process.exit(0)
    if (line === '__err__') {
      process.stderr.write('boom\\n')
      process.stdout.write(JSON.stringify({ type: 'err-ack' }) + '\\n')
      continue
    }
    process.stdout.write(JSON.stringify({ type: 'echo', line }) + '\\n')
  }
})
`,
    'utf8',
  )
  return path
}

describe('DangerousBackend.spawn', () => {
  test('bridges stdin to child stdout lines, captures stderr, and reports exit', async () => {
    const script = writeFakeCli()
    const backend = new DangerousBackend({
      buildLaunch: () => ({ command: process.execPath, args: [script] }),
    })
    const session = backend.spawn({ sessionId: 'sess-1', cwd: tmpdir(), dangerouslySkipPermissions: false })

    const lines: string[] = []
    session.onLine((line) => lines.push(line))
    const exited = new Promise<BackendExitInfo>((resolve) => session.onExit(resolve))

    session.writeStdin('hello\n')
    await waitFor(() => lines.length >= 1)
    expect(JSON.parse(lines[0])).toMatchObject({ type: 'echo', line: 'hello' })

    session.writeStdin('__err__\n')
    await waitFor(() => lines.length >= 2)
    expect(lines[1]).toBe(JSON.stringify({ type: 'err-ack' }))
    await waitFor(() => session.getStderrTail().includes('boom'))

    session.writeStdin('__exit__\n')
    const info = await exited
    expect(info.code).toBe(0)
  })
})
