import { expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DangerousBackend } from '../backends/dangerousBackend.js'
import { createDirectConnectSession } from '../createDirectConnectSession.js'
import { DirectConnectSessionManager } from '../directConnectManager.js'
import { startServer } from '../server.js'
import { SessionManager } from '../sessionManager.js'

/**
 * A stand-in for the real `claude --print --input-format stream-json` child.
 * It speaks just enough of the NDJSON protocol to prove the whole transport
 * works: emit `system init` on startup, echo each user turn back as an
 * `assistant` + `result`. The only faked piece in this E2E is the model.
 */
function writeFakeSessionCli(): string {
  const path = join(tmpdir(), `cc-e2e-cli-${randomUUID()}.mjs`)
  writeFileSync(
    path,
    `process.stdin.setEncoding('utf8')
let buf = ''
// Emitted before any client attaches — the server must buffer and replay it.
process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'remote' }) + '\\n')
process.stdin.on('data', (chunk) => {
  buf += chunk
  let idx
  while ((idx = buf.indexOf('\\n')) !== -1) {
    const line = buf.slice(0, idx)
    buf = buf.slice(idx + 1)
    if (!line.trim()) continue
    let msg
    try { msg = JSON.parse(line) } catch { continue }
    if (msg.type === 'user') {
      const text = typeof msg.message?.content === 'string' ? msg.message.content : JSON.stringify(msg.message?.content)
      const reply = 'echo:' + text
      process.stdout.write(JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: reply }] } }) + '\\n')
      process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', result: reply }) + '\\n')
    }
  }
})
`,
    'utf8',
  )
  return path
}

test('direct-connect end to end: same client code as `claude open` drives a real server + real spawned child', async () => {
  const script = writeFakeSessionCli()
  const backend = new DangerousBackend({ buildLaunch: () => ({ command: process.execPath, args: [script] }) })
  const manager = new SessionManager(backend, { sweepIntervalMs: 0, destroyGraceMs: 500 })
  const token = 'e2e-token'
  const server = startServer({ port: 0, host: '127.0.0.1', authToken: token }, manager)

  let client: DirectConnectSessionManager | undefined
  try {
    // Real HTTP client path used by `claude open`: POST /sessions, parse ws_url.
    const { config, workDir } = await createDirectConnectSession({
      serverUrl: `http://127.0.0.1:${server.port}`,
      authToken: token,
      cwd: tmpdir(),
    })
    expect(config.sessionId).toBeTruthy()
    expect(workDir).toBe(tmpdir())
    expect(config.wsUrl).toBe(`ws://127.0.0.1:${server.port}/sessions/${config.sessionId}/ws`)

    // Real WebSocket client path used by `claude open`: connect, send a turn,
    // collect SDK messages until the terminal `result` arrives.
    const messages: Array<{ type: string; result?: string; subtype?: string }> = []
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('e2e timed out')), 5000)
      client = new DirectConnectSessionManager(config, {
        onMessage: (message) => {
          const m = message as unknown as { type: string; result?: string; subtype?: string }
          messages.push(m)
          if (m.type === 'result') {
            clearTimeout(timer)
            resolve()
          }
        },
        onPermissionRequest: () => {},
        onConnected: () => {
          client?.sendMessage('ping')
        },
        onError: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      client.connect()
    })

    const types = messages.map((m) => m.type)
    // The buffered `system init` emitted at child startup is replayed on connect.
    expect(types).toContain('system')
    expect(types).toContain('assistant')
    expect(types).toContain('result')
    const result = messages.find((m) => m.type === 'result')
    expect(result?.result).toBe('echo:ping')
  } finally {
    client?.disconnect()
    server.stop(true)
    manager.stopSweeper()
    await manager.destroyAll()
  }
}, 10_000)
