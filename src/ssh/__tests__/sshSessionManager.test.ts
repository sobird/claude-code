import { describe, expect, test } from 'bun:test'

import type { SDKControlPermissionRequest } from '../../entrypoints/sdk/controlTypes.js'
import type { SDKMessage } from '../../entrypoints/sdk/coreTypes.js'
import { createSSHSessionManager, type ManagerTransport, type SSHSessionManagerOptions } from '../SSHSessionManager.js'

class FakeTransport implements ManagerTransport {
  written: string[] = []
  killed = false
  private lineHandler?: (line: string) => void
  private exitHandler?: (info: { code: number | null; signal: string | null }) => void

  write(chunk: string): void {
    this.written.push(chunk)
  }
  onLine(cb: (line: string) => void): void {
    this.lineHandler = cb
  }
  onExit(cb: (info: { code: number | null; signal: string | null }) => void): void {
    this.exitHandler = cb
  }
  kill(): void {
    this.killed = true
  }
  emitLine(line: string): void {
    this.lineHandler?.(line)
  }
  exit(code: number | null = 1, signal: string | null = null): void {
    this.exitHandler?.({ code, signal })
  }
  lastFrame(): unknown {
    return JSON.parse(this.written.at(-1)!)
  }
}

function makeOptions(overrides: Partial<SSHSessionManagerOptions> = {}) {
  const calls = {
    messages: [] as SDKMessage[],
    permissions: [] as { request: SDKControlPermissionRequest; id: string }[],
    connected: 0,
    reconnecting: [] as [number, number][],
    disconnected: 0,
    errors: [] as Error[],
  }
  const options: SSHSessionManagerOptions = {
    onMessage: (m) => calls.messages.push(m),
    onPermissionRequest: (request, id) => calls.permissions.push({ request, id }),
    onConnected: () => calls.connected++,
    onReconnecting: (attempt, max) => calls.reconnecting.push([attempt, max]),
    onDisconnected: () => calls.disconnected++,
    onError: (e) => calls.errors.push(e),
    ...overrides,
  }
  return { options, calls }
}

describe('sendMessage / sendInterrupt', () => {
  test('writes a user frame as newline-delimited JSON', async () => {
    const transport = new FakeTransport()
    const { options } = makeOptions()
    const manager = createSSHSessionManager(transport, options)
    manager.connect()

    expect(await manager.sendMessage('hello')).toBe(true)
    const frame = transport.lastFrame() as Record<string, unknown>
    expect(frame.type).toBe('user')
    expect((frame.message as { content: string }).content).toBe('hello')
  })

  test('writes an interrupt control request', () => {
    const transport = new FakeTransport()
    const { options } = makeOptions()
    const manager = createSSHSessionManager(transport, options)
    manager.connect()

    manager.sendInterrupt()
    const frame = transport.lastFrame() as Record<string, unknown>
    expect(frame.type).toBe('control_request')
    expect((frame.request as { subtype: string }).subtype).toBe('interrupt')
  })

  test('sendMessage returns false after disconnect', async () => {
    const transport = new FakeTransport()
    const { options } = makeOptions()
    const manager = createSSHSessionManager(transport, options)
    manager.connect()
    manager.disconnect()
    expect(await manager.sendMessage('late')).toBe(false)
  })
})

describe('control request routing', () => {
  const permissionRequest: SDKControlPermissionRequest = {
    subtype: 'can_use_tool',
    tool_name: 'Bash',
    input: { command: 'ls' },
    tool_use_id: 'tool-1',
  }

  test('forwards can_use_tool and answers with a control_response', () => {
    const transport = new FakeTransport()
    const { options, calls } = makeOptions()
    const manager = createSSHSessionManager(transport, options)
    manager.connect()

    transport.emitLine(JSON.stringify({ type: 'control_request', request_id: 'req-1', request: permissionRequest }))
    expect(calls.permissions).toHaveLength(1)
    expect(calls.permissions[0].request.tool_name).toBe('Bash')

    manager.respondToPermissionRequest('req-1', { behavior: 'allow', updatedInput: { command: 'ls' } })
    const frame = transport.lastFrame() as {
      type: string
      response: { subtype: string; request_id: string; response: unknown }
    }
    expect(frame.type).toBe('control_response')
    expect(frame.response.subtype).toBe('success')
    expect(frame.response.request_id).toBe('req-1')
    expect(frame.response.response).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } })

    // Pending entry is consumed: a second response is a no-op.
    transport.written.length = 0
    manager.respondToPermissionRequest('req-1', { behavior: 'deny', message: 'nope' })
    expect(transport.written).toHaveLength(0)
  })

  test('replies with an error response for unsupported control subtypes', () => {
    const transport = new FakeTransport()
    const { options } = makeOptions()
    const manager = createSSHSessionManager(transport, options)
    manager.connect()

    transport.emitLine(
      JSON.stringify({ type: 'control_request', request_id: 'req-2', request: { subtype: 'unknown_thing' } }),
    )
    const frame = transport.lastFrame() as {
      type: string
      response: { subtype: string; request_id: string; error: string }
    }
    expect(frame.type).toBe('control_response')
    expect(frame.response.subtype).toBe('error')
    expect(frame.response.request_id).toBe('req-2')
    expect(frame.response.error).toContain('Unsupported')
  })

  test('drops a cancelled permission request', () => {
    const transport = new FakeTransport()
    const { options, calls } = makeOptions()
    const manager = createSSHSessionManager(transport, options)
    manager.connect()

    transport.emitLine(JSON.stringify({ type: 'control_request', request_id: 'req-3', request: permissionRequest }))
    transport.emitLine(JSON.stringify({ type: 'control_cancel_request', request_id: 'req-3' }))
    expect(calls.permissions).toHaveLength(1)

    transport.written.length = 0
    manager.respondToPermissionRequest('req-3', { behavior: 'deny', message: 'too late' })
    expect(transport.written).toHaveLength(0)
  })
})

describe('message forwarding and lifecycle', () => {
  test('forwards SDK messages and fires onConnected once', () => {
    const transport = new FakeTransport()
    const { options, calls } = makeOptions()
    const manager = createSSHSessionManager(transport, options)
    manager.connect()

    transport.emitLine(JSON.stringify({ type: 'system', subtype: 'init' }))
    transport.emitLine(JSON.stringify({ type: 'result', subtype: 'success' }))
    expect(calls.messages).toHaveLength(2)
    expect(calls.connected).toBe(1)
    expect(calls.messages[0].type).toBe('system')
  })

  test('ignores malformed lines without erroring', () => {
    const transport = new FakeTransport()
    const { options, calls } = makeOptions()
    const manager = createSSHSessionManager(transport, options)
    manager.connect()

    transport.emitLine('not json')
    expect(calls.messages).toHaveLength(0)
    expect(calls.errors).toHaveLength(0)
  })

  test('disconnect kills the transport and suppresses onDisconnected', () => {
    const transport = new FakeTransport()
    const { options, calls } = makeOptions()
    const manager = createSSHSessionManager(transport, options)
    manager.connect()
    manager.disconnect()

    expect(transport.killed).toBe(true)
    transport.exit(0)
    expect(calls.disconnected).toBe(0)
  })

  test('unexpected exit without respawn reports disconnection', () => {
    const transport = new FakeTransport()
    const { options, calls } = makeOptions()
    const manager = createSSHSessionManager(transport, options)
    manager.connect()

    transport.exit(1)
    expect(calls.disconnected).toBe(1)
  })

  test('unexpected exit respawns while attempts remain', () => {
    const first = new FakeTransport()
    const second = new FakeTransport()
    const { options, calls } = makeOptions()
    const manager = createSSHSessionManager(first, options, {
      maxReconnect: 2,
      respawn: () => second,
    })
    manager.connect()

    first.exit(255)
    expect(calls.reconnecting).toEqual([[1, 2]])
    expect(calls.disconnected).toBe(0)

    second.emitLine(JSON.stringify({ type: 'result', subtype: 'success' }))
    expect(calls.messages).toHaveLength(1)
  })

  test('stops reconnecting once the budget is exhausted', () => {
    const transports = [new FakeTransport(), new FakeTransport(), new FakeTransport()]
    let next = 0
    const { options, calls } = makeOptions()
    const manager = createSSHSessionManager(transports[0], options, {
      maxReconnect: 1,
      respawn: () => transports[++next],
    })
    manager.connect()

    transports[0].exit(255)
    expect(calls.reconnecting).toEqual([[1, 1]])

    transports[1].exit(255)
    expect(calls.disconnected).toBe(1)
  })
})
