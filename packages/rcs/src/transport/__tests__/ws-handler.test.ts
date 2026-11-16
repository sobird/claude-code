import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { GatewayConfig } from '../../config.js'
import { createMemoryRepositories } from '../../db/repositories/index.js'
import type { Repositories } from '../../db/repositories/types.js'
import type { SessionEvent } from '../event-bus.js'
import { getAllEventBuses, getEventBus, removeEventBus } from '../event-bus.js'
import {
  closeAllConnections,
  handleWebSocketClose,
  handleWebSocketMessage,
  handleWebSocketOpen,
  ingestBridgeMessage,
} from '../ws-handler.js'

interface MockWs {
  readyState: number
  sent: string[]
  closes: Array<{ code?: number; reason?: string }>
  send(data: string): void
  close(code?: number, reason?: string): void
}

function createMockWs(readyState = 1): MockWs {
  return {
    readyState,
    sent: [],
    closes: [],
    send(data) {
      this.sent.push(data)
    },
    close(code, reason) {
      this.closes.push({ code, reason })
      this.readyState = 3
    },
  }
}

function makeConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    version: 'test',
    port: 4000,
    host: '0.0.0.0',
    authSecret: 'test-secret',
    baseUrl: 'http://localhost:4000',
    apiKeys: [],
    pollTimeout: 0,
    heartbeatInterval: 20,
    jwtExpiresIn: 3600,
    envTokenTtl: 2592000,
    disconnectTimeout: 300,
    wsIdleTimeout: 30,
    wsKeepaliveInterval: 20,
    eventReplayLimit: 5000,
    webCorsOrigins: [],
    ...overrides,
  }
}

let rawSeq = 0

/** Publish a fully-formed event straight to the bus (bypasses persistence). */
function publishRaw(
  bus: ReturnType<typeof getEventBus>,
  sessionId: string,
  type: string,
  payload: unknown,
  direction: 'inbound' | 'outbound' = 'outbound',
): SessionEvent {
  return bus.publish({
    id: `raw-${++rawSeq}`,
    sessionId,
    type,
    payload,
    direction,
    seqNum: rawSeq,
    createdAt: Date.now(),
  })
}

function sentJson(ws: MockWs, index: number): Record<string, unknown> {
  return JSON.parse(ws.sent[index]) as Record<string, unknown>
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let repos: Repositories

beforeEach(() => {
  rawSeq = 0
  for (const [key] of getAllEventBuses()) removeEventBus(key)
  closeAllConnections()
  repos = createMemoryRepositories()
})

afterEach(() => {
  closeAllConnections()
  for (const [key] of getAllEventBuses()) removeEventBus(key)
})

describe('ingestBridgeMessage', () => {
  test('ignores keep_alive messages', async () => {
    const events: SessionEvent[] = []
    getEventBus('s1').subscribe((event) => events.push(event))

    await ingestBridgeMessage(repos, 's1', { type: 'keep_alive' })

    expect(events).toHaveLength(0)
    expect(await repos.events.listSince('s1', 0, 10)).toHaveLength(0)
  })

  test('derives type from message.role for user messages', async () => {
    const events: SessionEvent[] = []
    getEventBus('s1').subscribe((event) => events.push(event))

    await ingestBridgeMessage(repos, 's1', { message: { role: 'user', content: 'hello' }, uuid: 'u1' })

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('user')
    expect(events[0]?.direction).toBe('inbound')
    expect(await repos.events.listSince('s1', 0, 10)).toHaveLength(1)
  })

  test('preserves the synthetic flag on inbound user messages', async () => {
    const events: SessionEvent[] = []
    getEventBus('s1').subscribe((event) => events.push(event))

    await ingestBridgeMessage(repos, 's1', {
      message: { role: 'user', content: 'scheduled job: refresh analytics cache' },
      uuid: 'u_synth',
      isSynthetic: true,
    })

    expect(events).toHaveLength(1)
    const payload = events[0]?.payload as Record<string, unknown> | undefined
    expect(payload?.isSynthetic).toBe(true)
  })

  test('derives type from message.role for assistant messages', async () => {
    const events: SessionEvent[] = []
    getEventBus('s1').subscribe((event) => events.push(event))

    await ingestBridgeMessage(repos, 's1', {
      message: { role: 'assistant', content: [{ type: 'text', text: 'response' }] },
      uuid: 'u2',
    })

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('assistant')
    const payload = events[0]?.payload as Record<string, unknown> | undefined
    expect(payload?.content).toBe('response')
  })

  test('derives type from an explicit type field', async () => {
    const events: SessionEvent[] = []
    getEventBus('s1').subscribe((event) => events.push(event))

    await ingestBridgeMessage(repos, 's1', {
      type: 'control_request',
      request_id: 'r1',
      request: { subtype: 'interrupt' },
    })

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('control_request')
  })

  test('derives result type from subtype/result fields', async () => {
    const events: SessionEvent[] = []
    getEventBus('s1').subscribe((event) => events.push(event))

    await ingestBridgeMessage(repos, 's1', { subtype: 'success', uuid: 'u3', result: 'done' })

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('result')
  })

  test('derives system type from the session_id field', async () => {
    const events: SessionEvent[] = []
    getEventBus('s1').subscribe((event) => events.push(event))

    await ingestBridgeMessage(repos, 's1', { session_id: 's1', init: true })

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('system')
  })

  test('handles control_response type', async () => {
    const events: SessionEvent[] = []
    getEventBus('s1').subscribe((event) => events.push(event))

    await ingestBridgeMessage(repos, 's1', { type: 'control_response', response: { subtype: 'success' } })

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('control_response')
  })

  test('handles partial_assistant type', async () => {
    const events: SessionEvent[] = []
    getEventBus('s1').subscribe((event) => events.push(event))

    await ingestBridgeMessage(repos, 's1', {
      type: 'partial_assistant',
      message: { content: 'partial...' },
      uuid: 'u4',
    })

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('partial_assistant')
  })

  test('falls back to the unknown type', async () => {
    const events: SessionEvent[] = []
    getEventBus('s1').subscribe((event) => events.push(event))

    await ingestBridgeMessage(repos, 's1', { data: 'something' })

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('unknown')
  })

  test('persists the event before it becomes observable', async () => {
    const events: SessionEvent[] = []
    getEventBus('s1').subscribe((event) => events.push(event))

    await ingestBridgeMessage(repos, 's1', { message: { role: 'user', content: 'persisted first' } })

    const stored = await repos.events.listSince('s1', 0, 10)
    expect(stored).toHaveLength(1)
    expect(events[0]?.seqNum).toBe(stored[0]?.id)
  })
})

describe('handleWebSocketOpen', () => {
  test('replays durable events (inbound and outbound) from the repository', async () => {
    await repos.events.append({ sessionId: 's1', type: 'user', payload: { content: 'hello' }, direction: 'outbound' })
    await repos.events.append({ sessionId: 's1', type: 'assistant', payload: { content: 'hi' }, direction: 'inbound' })

    const ws = createMockWs()
    await handleWebSocketOpen(repos, makeConfig(), ws as never, 's1')

    expect(ws.sent).toHaveLength(2)
    expect(sentJson(ws, 0).type).toBe('user')
    expect(sentJson(ws, 1).type).toBe('assistant')
  })

  test('replays synthetic user metadata back to the bridge', async () => {
    await repos.events.append({
      sessionId: 's3',
      type: 'user',
      payload: { content: 'scheduled job: refresh analytics cache', isSynthetic: true },
      direction: 'outbound',
    })

    const ws = createMockWs()
    await handleWebSocketOpen(repos, makeConfig(), ws as never, 's3')

    expect(sentJson(ws, 0).type).toBe('user')
    expect(sentJson(ws, 0).isSynthetic).toBe(true)
  })

  test('replays the newest eventReplayLimit events when there is no cursor', async () => {
    for (let index = 0; index < 4; index++) {
      await repos.events.append({
        sessionId: 'limit',
        type: 'user',
        payload: { content: `m${index}` },
        direction: 'outbound',
      })
    }

    const ws = createMockWs()
    await handleWebSocketOpen(repos, makeConfig({ eventReplayLimit: 2 }), ws as never, 'limit')

    expect(ws.sent).toHaveLength(2)
    expect((sentJson(ws, 0).message as Record<string, unknown>).content).toBe('m2')
    expect((sentJson(ws, 1).message as Record<string, unknown>).content).toBe('m3')
    const contents = ws.sent.map((line) => {
      const message = JSON.parse(line) as { message?: { content?: string } }
      return message.message?.content
    })
    expect(contents).not.toContain('m0')
  })

  test('replay then buffered-live delivery loses and duplicates nothing (R22)', async () => {
    const bus = getEventBus('race')
    await repos.events.append({ sessionId: 'race', type: 'user', payload: { content: 'seed' }, direction: 'outbound' })
    const last = await repos.events.append({
      sessionId: 'race',
      type: 'user',
      payload: { content: 'before' },
      direction: 'outbound',
    })

    let racing = false
    const racingRepos: Repositories = {
      ...repos,
      events: {
        ...repos.events,
        async listBefore(sessionId, beforeId, limit) {
          const snapshot = await repos.events.listBefore(sessionId, beforeId, limit)
          if (!racing) {
            racing = true
            const lastRow = snapshot.at(-1)
            if (lastRow) {
              bus.publish({
                id: lastRow.eventId,
                sessionId: lastRow.sessionId,
                type: lastRow.type,
                payload: lastRow.payload,
                direction: lastRow.direction,
                seqNum: lastRow.id,
                createdAt: lastRow.createdAt.getTime(),
              })
            }
            await repos.events.append({
              sessionId: lastRow?.sessionId ?? sessionId,
              type: 'user',
              payload: { content: 'after' },
              direction: 'outbound',
            })
            const created = (await repos.events.listSince(sessionId, 0, 100)).at(-1)
            if (created) {
              bus.publish({
                id: created.eventId,
                sessionId: created.sessionId,
                type: created.type,
                payload: created.payload,
                direction: created.direction,
                seqNum: created.id,
                createdAt: created.createdAt.getTime(),
              })
            }
          }
          return snapshot
        },
      },
    }

    const ws = createMockWs()
    await handleWebSocketOpen(racingRepos, makeConfig(), ws as never, 'race')

    const contents = ws.sent.map((line) => {
      const message = JSON.parse(line) as { type: string; message?: { content?: string } }
      return message.message?.content
    })
    expect(contents).toEqual(['seed', 'before', 'after'])
    expect(last.id).toBeGreaterThan(0)
  })

  test('replaces an existing connection for the same session', async () => {
    const first = createMockWs()
    const second = createMockWs()
    await handleWebSocketOpen(repos, makeConfig(), first as never, 's2')
    await handleWebSocketOpen(repos, makeConfig(), second as never, 's2')

    publishRaw(getEventBus('s2'), 's2', 'user', { content: 'test' }, 'outbound')

    expect(first.sent).toHaveLength(0)
    expect(second.sent).toHaveLength(1)
  })
})

describe('handleWebSocketMessage', () => {
  test('parses NDJSON and ingests each message', async () => {
    const events: SessionEvent[] = []
    getEventBus('s1').subscribe((event) => events.push(event))

    const ws = createMockWs()
    await handleWebSocketMessage(
      repos,
      ws as never,
      's1',
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hello' } }) +
        '\n' +
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: 'hi' } }) +
        '\n',
    )

    expect(events).toHaveLength(2)
    expect(events.map((event) => event.type)).toEqual(['user', 'assistant'])
  })

  test('ignores malformed JSON lines', async () => {
    const events: SessionEvent[] = []
    getEventBus('s1').subscribe((event) => events.push(event))

    const ws = createMockWs()
    await handleWebSocketMessage(repos, ws as never, 's1', 'not json\n')

    expect(events).toHaveLength(0)
  })
})

describe('handleWebSocketClose', () => {
  test('cleans up on close', async () => {
    const ws = createMockWs()
    await handleWebSocketOpen(repos, makeConfig(), ws as never, 's3')
    handleWebSocketClose(ws as never, 's3', 1000, 'done')

    publishRaw(getEventBus('s3'), 's3', 'user', {}, 'outbound')
    expect(ws.sent).toHaveLength(0)
  })
})

describe('keepalive and dead-client detection', () => {
  test('sends keep_alive frames on the configured interval', async () => {
    const ws = createMockWs()
    await handleWebSocketOpen(repos, makeConfig({ wsKeepaliveInterval: 0.02 }), ws as never, 'ka')

    await sleep(40)

    expect(ws.sent.some((line) => line.includes('keep_alive'))).toBe(true)
    expect(ws.closes).toHaveLength(0)
  })

  test('closes a connection that stops sending data', async () => {
    const ws = createMockWs()
    await handleWebSocketOpen(repos, makeConfig({ wsKeepaliveInterval: 0.02 }), ws as never, 'dead')

    await sleep(110)

    expect(ws.closes.some((entry) => entry.code === 1000 && entry.reason === 'client inactive')).toBe(true)
  })

  test('client activity postpones the dead-client close', async () => {
    const ws = createMockWs()
    await handleWebSocketOpen(repos, makeConfig({ wsKeepaliveInterval: 0.05 }), ws as never, 'alive')

    for (let index = 0; index < 4; index++) {
      await sleep(30)
      await handleWebSocketMessage(repos, ws as never, 'alive', '{"type":"keep_alive"}\n')
    }

    expect(ws.closes).toHaveLength(0)
  })
})

describe('toSDKMessage (via live outbound delivery)', () => {
  test('converts permission_response with approved=true', async () => {
    const ws = createMockWs()
    await handleWebSocketOpen(repos, makeConfig(), ws as never, 'pr1')
    publishRaw(getEventBus('pr1'), 'pr1', 'permission_response', { approved: true, request_id: 'req1' })

    const message = sentJson(ws, ws.sent.length - 1)
    expect(message.type).toBe('control_response')
    const response = message.response as Record<string, unknown>
    expect(response.subtype).toBe('success')
    expect(response.request_id).toBe('req1')
    expect((response.response as { behavior: string }).behavior).toBe('allow')
  })

  test('converts permission_response with approved=false', async () => {
    const ws = createMockWs()
    await handleWebSocketOpen(repos, makeConfig(), ws as never, 'pr2')
    publishRaw(getEventBus('pr2'), 'pr2', 'permission_response', { approved: false, request_id: 'req2' })

    const message = sentJson(ws, ws.sent.length - 1)
    const response = message.response as Record<string, unknown>
    expect(message.type).toBe('control_response')
    expect(response.subtype).toBe('error')
    expect(response.error).toBe('Permission denied by user')
    expect((response.response as { behavior: string }).behavior).toBe('deny')
  })

  test('converts permission_response with an existing response object', async () => {
    const ws = createMockWs()
    await handleWebSocketOpen(repos, makeConfig(), ws as never, 'pr3')
    publishRaw(getEventBus('pr3'), 'pr3', 'control_response', { response: { subtype: 'success', data: 'custom' } })

    const message = sentJson(ws, ws.sent.length - 1)
    expect(message.type).toBe('control_response')
    expect((message.response as Record<string, unknown>).subtype).toBe('success')
    expect((message.response as Record<string, unknown>).data).toBe('custom')
  })

  test('converts interrupt events', async () => {
    const ws = createMockWs()
    await handleWebSocketOpen(repos, makeConfig(), ws as never, 'int1')
    publishRaw(getEventBus('int1'), 'int1', 'interrupt', { action: 'interrupt' })

    const message = sentJson(ws, ws.sent.length - 1)
    expect(message.type).toBe('control_request')
    expect(message.request_id).toBe('raw-1')
    expect((message.request as { subtype: string }).subtype).toBe('interrupt')
  })

  test('converts control_request events', async () => {
    const ws = createMockWs()
    await handleWebSocketOpen(repos, makeConfig(), ws as never, 'cr1')
    publishRaw(getEventBus('cr1'), 'cr1', 'control_request', {
      request_id: 'req5',
      request: { subtype: 'permission', tool_name: 'Bash' },
    })

    const message = sentJson(ws, ws.sent.length - 1)
    expect(message.type).toBe('control_request')
    expect(message.request_id).toBe('req5')
    expect((message.request as { subtype: string }).subtype).toBe('permission')
  })

  test('converts user_message event type', async () => {
    const ws = createMockWs()
    await handleWebSocketOpen(repos, makeConfig(), ws as never, 'um1')
    publishRaw(getEventBus('um1'), 'um1', 'user_message', { content: 'hello world' })

    const message = sentJson(ws, ws.sent.length - 1)
    expect(message.type).toBe('user')
    expect((message.message as { content: string }).content).toBe('hello world')
  })

  test('preserves the payload uuid for outbound user events', async () => {
    const ws = createMockWs()
    await handleWebSocketOpen(repos, makeConfig(), ws as never, 'um2')
    publishRaw(getEventBus('um2'), 'um2', 'user', { uuid: 'web-message-uuid', content: 'hello from web' })

    const message = sentJson(ws, ws.sent.length - 1)
    expect(message.uuid).toBe('web-message-uuid')
    expect((message.message as { content: string }).content).toBe('hello from web')
  })

  test('converts generic event types', async () => {
    const ws = createMockWs()
    await handleWebSocketOpen(repos, makeConfig(), ws as never, 'gen1')
    publishRaw(getEventBus('gen1'), 'gen1', 'status', { state: 'running' })

    const message = sentJson(ws, ws.sent.length - 1)
    expect(message.type).toBe('status')
    expect(message.message).toEqual({ state: 'running' })
  })

  test('permission_response with updated_input', async () => {
    const ws = createMockWs()
    await handleWebSocketOpen(repos, makeConfig(), ws as never, 'ui1')
    publishRaw(getEventBus('ui1'), 'ui1', 'permission_response', {
      approved: true,
      request_id: 'req8',
      updated_input: { cmd: 'ls -la' },
    })

    const message = sentJson(ws, ws.sent.length - 1)
    const response = message.response as { response: { behavior: string; updatedInput: unknown } }
    expect(response.response.behavior).toBe('allow')
    expect(response.response.updatedInput).toEqual({ cmd: 'ls -la' })
  })

  test('permission_response with updated_permissions', async () => {
    const ws = createMockWs()
    await handleWebSocketOpen(repos, makeConfig(), ws as never, 'up1')
    const permissions = [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }]
    publishRaw(getEventBus('up1'), 'up1', 'permission_response', {
      approved: true,
      request_id: 'req-ep1',
      updated_input: { plan: 'my plan' },
      updated_permissions: permissions,
    })

    const message = sentJson(ws, ws.sent.length - 1)
    const response = message.response as { response: { updatedPermissions: unknown } }
    expect(response.response.updatedPermissions).toEqual(permissions)
  })

  test('permission_response denied with a feedback message', async () => {
    const ws = createMockWs()
    await handleWebSocketOpen(repos, makeConfig(), ws as never, 'dm1')
    publishRaw(getEventBus('dm1'), 'dm1', 'permission_response', {
      approved: false,
      request_id: 'req-dm1',
      message: 'Please add more tests',
    })

    const message = sentJson(ws, ws.sent.length - 1)
    expect((message.response as Record<string, unknown>).message).toBe('Please add more tests')
  })

  test('does not forward inbound events to the WS', async () => {
    const ws = createMockWs()
    await handleWebSocketOpen(repos, makeConfig(), ws as never, 'no_in')
    publishRaw(getEventBus('no_in'), 'no_in', 'assistant', { content: 'reply' }, 'inbound')
    expect(ws.sent).toHaveLength(0)
  })

  test('control_request falls back to the payload when no request field is present', async () => {
    const ws = createMockWs()
    await handleWebSocketOpen(repos, makeConfig(), ws as never, 'cf1')
    publishRaw(getEventBus('cf1'), 'cf1', 'control_request', { request_id: 'req10', subtype: 'custom', data: 'test' })

    const message = sentJson(ws, ws.sent.length - 1)
    expect(message.type).toBe('control_request')
    expect(message.request_id).toBe('req10')
  })
})

describe('closeAllConnections', () => {
  test('closes all active connections', async () => {
    const first = createMockWs()
    const second = createMockWs()
    await handleWebSocketOpen(repos, makeConfig(), first as never, 's1')
    await handleWebSocketOpen(repos, makeConfig(), second as never, 's2')

    closeAllConnections()

    expect(first.closes.some((entry) => entry.code === 1001)).toBe(true)
    expect(second.closes.some((entry) => entry.code === 1001)).toBe(true)
  })

  test('is a no-op when there are no connections', () => {
    expect(() => closeAllConnections()).not.toThrow()
  })
})
