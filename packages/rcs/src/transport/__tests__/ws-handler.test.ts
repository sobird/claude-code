import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { GatewayConfig } from '@/config'
import type { Repositories } from '@/db/repositories/types'
import { createTestRepositories } from '@/db/testing'
import { requestBridgeControl } from '@/transport/bridge-requests'
import type { SessionEvent } from '@/transport/event-bus'
import { getAllEventBuses, getEventBus, removeEventBus } from '@/transport/event-bus'
import {
  closeAllConnections,
  handleWebSocketClose,
  handleWebSocketMessage,
  handleWebSocketOpen,
  ingestBridgeMessage,
  sendToBridge,
} from '@/transport/ws-handler'

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
    vapidPublicKey: null,
    vapidPrivateKey: null,
    vapidSubject: 'mailto:noreply@localhost',
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

beforeEach(async () => {
  rawSeq = 0
  for (const [key] of getAllEventBuses()) removeEventBus(key)
  closeAllConnections()
  repos = await createTestRepositories()
  // 事件表 session_id 有外键：先建出测试用到的会话行。
  for (const id of ['s1', 'ctl', 's3', 'limit', 'race']) await repos.sessions.create({ id })
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

  test('preserves parent_tool_use_id so subagent traffic can nest', async () => {
    const events: SessionEvent[] = []
    getEventBus('s1').subscribe((event) => events.push(event))

    await ingestBridgeMessage(repos, 's1', {
      message: { role: 'assistant', content: [{ type: 'tool_use', id: 'sub', name: 'Glob', input: {} }] },
      uuid: 'u_sub_assistant',
      parent_tool_use_id: 'toolu_agent',
    })
    await ingestBridgeMessage(repos, 's1', {
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'sub', content: 'ok' }] },
      uuid: 'u_sub_user',
      parent_tool_use_id: 'toolu_agent',
    })

    expect(events).toHaveLength(2)
    for (const event of events) {
      const payload = event.payload as Record<string, unknown> | undefined
      expect(payload?.parent_tool_use_id).toBe('toolu_agent')
    }
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

  test('keeps the flat init fields the web UI reads', async () => {
    const events: SessionEvent[] = []
    getEventBus('s1').subscribe((event) => events.push(event))

    await ingestBridgeMessage(repos, 's1', {
      type: 'system',
      subtype: 'init',
      session_id: 's1',
      slash_commands: ['compact', 'clear'],
      permissionMode: 'plan',
      model: 'claude-opus-4-6',
      fast_mode_state: 'off',
      tools: ['Bash'],
      mcp_servers: [{ name: 'secret', status: 'connected' }],
      uuid: 'init-1',
    })

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('system')
    const payload = events[0]?.payload as Record<string, unknown> | undefined
    expect(payload).toMatchObject({
      subtype: 'init',
      slash_commands: ['compact', 'clear'],
      permissionMode: 'plan',
      model: 'claude-opus-4-6',
      fast_mode_state: 'off',
      uuid: 'init-1',
    })
    // Whitelisted on purpose: tool/MCP inventories stay out of the web payload.
    expect(payload?.tools).toBeUndefined()
    expect(payload?.mcp_servers).toBeUndefined()
  })

  test('keeps the message body on non-init system messages', async () => {
    const events: SessionEvent[] = []
    getEventBus('s1').subscribe((event) => events.push(event))

    await ingestBridgeMessage(repos, 's1', {
      type: 'system',
      subtype: 'compact_boundary',
      message: { content: 'compacted' },
      uuid: 'sys-1',
    })

    const payload = events[0]?.payload as Record<string, unknown> | undefined
    expect(payload?.subtype).toBe('compact_boundary')
    expect(payload?.message).toEqual({ content: 'compacted' })
    expect(payload?.slash_commands).toBeUndefined()
  })

  test('keeps the transcript fields the detailed web view renders', async () => {
    const events: SessionEvent[] = []
    getEventBus('s1').subscribe((event) => events.push(event))

    await ingestBridgeMessage(repos, 's1', {
      type: 'system',
      subtype: 'compact_boundary',
      content: 'Context compacted',
      level: 'info',
      compactMetadata: { trigger: 'auto' },
      uuid: 'sys-1',
    })
    await ingestBridgeMessage(repos, 's1', {
      type: 'system',
      subtype: 'permission_retry',
      commands: ['Bash(npm test:*)', 42],
      uuid: 'sys-2',
    })
    await ingestBridgeMessage(repos, 's1', {
      type: 'system',
      subtype: 'memory_saved',
      writtenPaths: ['/repo/CLAUDE.md'],
      uuid: 'sys-3',
    })

    expect(events).toHaveLength(3)
    const [compact, retry, memory] = events.map((event) => event.payload as Record<string, unknown> | undefined)
    expect(compact).toMatchObject({ subtype: 'compact_boundary', content: 'Context compacted', level: 'info' })
    // Metadata objects stay out of the browser payload.
    expect(compact?.compactMetadata).toBeUndefined()
    expect(retry).toMatchObject({ subtype: 'permission_retry', commands: ['Bash(npm test:*)'] })
    expect(memory).toMatchObject({ subtype: 'memory_saved', writtenPaths: ['/repo/CLAUDE.md'] })
  })

  test('keeps the task fields the web background-task panel reads', async () => {
    const events: SessionEvent[] = []
    getEventBus('s1').subscribe((event) => events.push(event))

    await ingestBridgeMessage(repos, 's1', {
      type: 'system',
      subtype: 'task_started',
      session_id: 's1',
      task_id: 't1',
      tool_use_id: 'call-1',
      description: 'Review auth',
      task_type: 'local_agent',
      prompt: 'secret prompt',
      uuid: 'task-1',
    })

    const payload = events[0]?.payload as Record<string, unknown> | undefined
    expect(payload).toMatchObject({
      subtype: 'task_started',
      task_id: 't1',
      tool_use_id: 'call-1',
      description: 'Review auth',
      task_type: 'local_agent',
      uuid: 'task-1',
    })
    expect(payload?.prompt).toBeUndefined()
  })

  test('sanitizes task usage and never forwards the CLI-host output file', async () => {
    const events: SessionEvent[] = []
    getEventBus('s1').subscribe((event) => events.push(event))

    await ingestBridgeMessage(repos, 's1', {
      type: 'system',
      subtype: 'task_progress',
      session_id: 's1',
      task_id: 't1',
      description: 'Reviewing',
      usage: { total_tokens: 1200, tool_uses: 4, duration_ms: 90_000, secret: 'x' },
      last_tool_name: 'Read',
      summary: 'halfway',
      output_file: '/home/me/.claude/tasks/t1.txt',
      uuid: 'task-2',
    })
    await ingestBridgeMessage(repos, 's1', {
      type: 'system',
      subtype: 'task_notification',
      session_id: 's1',
      task_id: 't1',
      status: 'completed',
      summary: 'done',
      output_file: '/home/me/.claude/tasks/t1.txt',
      uuid: 'task-3',
    })

    const [progress, notification] = events.map((event) => event.payload as Record<string, unknown> | undefined)
    expect(progress).toMatchObject({
      subtype: 'task_progress',
      task_id: 't1',
      last_tool_name: 'Read',
      summary: 'halfway',
      usage: { totalTokens: 1200, toolUses: 4, durationMs: 90_000 },
    })
    expect(progress?.output_file).toBeUndefined()
    expect(notification).toMatchObject({ subtype: 'task_notification', status: 'completed', summary: 'done' })
    expect(notification?.output_file).toBeUndefined()
  })

  test('keeps session_state_changed state but no task fields on other system subtypes', async () => {
    const events: SessionEvent[] = []
    getEventBus('s1').subscribe((event) => events.push(event))

    await ingestBridgeMessage(repos, 's1', {
      type: 'system',
      subtype: 'session_state_changed',
      session_id: 's1',
      state: 'idle',
      uuid: 'state-1',
    })
    await ingestBridgeMessage(repos, 's1', {
      type: 'system',
      subtype: 'compact_boundary',
      session_id: 's1',
      task_id: 't1',
      state: 'idle',
      uuid: 'sys-9',
    })

    const [stateChanged, compact] = events.map((event) => event.payload as Record<string, unknown> | undefined)
    expect(stateChanged?.state).toBe('idle')
    // Task/state fields leak only through their own subtypes.
    expect(compact?.task_id).toBeUndefined()
    expect(compact?.state).toBeUndefined()
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

  test('drops replay acknowledgements instead of persisting them again', async () => {
    // The child acks replayed user messages with `isReplay: true`. Persisting
    // them adds a copy per reconnect, so the next replay window is larger and
    // the child echoes more — an amplification loop that ends in a 400.
    const events: SessionEvent[] = []
    getEventBus('s1').subscribe((event) => events.push(event))

    await ingestBridgeMessage(repos, 's1', {
      type: 'user',
      message: { role: 'user', content: 'already processed' },
      uuid: 'u_ack',
      isReplay: true,
    })

    expect(events).toHaveLength(0)
    expect(await repos.events.listSince('s1', 0, 10)).toHaveLength(0)
  })

  test('drops replayed assistant echoes instead of persisting them again', async () => {
    const events: SessionEvent[] = []
    getEventBus('s1').subscribe((event) => events.push(event))

    await ingestBridgeMessage(repos, 's1', {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'echoed history' }] },
      uuid: 'a_ack',
      isReplay: true,
    })

    expect(events).toHaveLength(0)
    expect(await repos.events.listSince('s1', 0, 10)).toHaveLength(0)
  })

  test('drops an unmarked echo whose uuid was already persisted', async () => {
    // The child echoes replayed assistant history without an isReplay marker.
    // Persisting it makes the next replay window larger, so the gateway must
    // deduplicate by message uuid (the transport's documented contract).
    await repos.events.append({
      sessionId: 's1',
      type: 'assistant',
      payload: { uuid: 'a_echo', content: 'history' },
      direction: 'outbound',
      messageUuid: 'a_echo',
    })
    const events: SessionEvent[] = []
    getEventBus('s1').subscribe((event) => events.push(event))

    await ingestBridgeMessage(repos, 's1', {
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: 'history' }] },
      uuid: 'a_echo',
    })

    expect(events).toHaveLength(0)
    expect(await repos.events.listSince('s1', 0, 10)).toHaveLength(1)
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
  test("replays outbound events only, never the child's own inbound history", async () => {
    // The bridge dedupes replayed *user* messages against its local transcript, but
    // injects every replayed *assistant* message into the live conversation. Replaying
    // an assistant `tool_use` whose paired user `tool_result` gets skipped produces
    // "tool_use ids were found without tool_result blocks" on the next API request.
    await repos.events.append({
      sessionId: 's1',
      type: 'user',
      payload: { uuid: 'u_prompt', content: 'hello' },
      direction: 'outbound',
    })
    await repos.events.append({
      sessionId: 's1',
      type: 'assistant',
      payload: {
        uuid: 'a_tool',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'call_1', name: 'Bash', input: {} }],
        },
      },
      direction: 'inbound',
    })
    await repos.events.append({
      sessionId: 's1',
      type: 'user',
      payload: {
        uuid: 'u_result',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'ok' }],
        },
      },
      direction: 'inbound',
    })

    const ws = createMockWs()
    await handleWebSocketOpen(repos, makeConfig(), ws as never, 's1')

    expect(ws.sent).toHaveLength(1)
    expect(sentJson(ws, 0).type).toBe('user')
    expect((sentJson(ws, 0).message as Record<string, unknown>).content).toBe('hello')
  })

  test('does not replay control events to the bridge', async () => {
    // Replaying a durable interrupt would abort the session on every
    // reconnect, and replaying old control requests/responses feeds stale
    // decisions back to the child (which echoes them, growing the window).
    for (const type of ['interrupt', 'control_request', 'control_response', 'permission_response']) {
      await repos.events.append({ sessionId: 'ctl', type, payload: { request_id: 'r1' }, direction: 'outbound' })
    }
    await repos.events.append({ sessionId: 'ctl', type: 'user', payload: { content: 'kept' }, direction: 'outbound' })

    const ws = createMockWs()
    await handleWebSocketOpen(repos, makeConfig(), ws as never, 'ctl')

    expect(ws.sent).toHaveLength(1)
    expect(sentJson(ws, 0).type).toBe('user')
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

describe('sendToBridge', () => {
  test('writes NDJSON to the live socket', async () => {
    const ws = createMockWs()
    await handleWebSocketOpen(repos, makeConfig(), ws as never, 'direct1')

    expect(sendToBridge('direct1', { type: 'control_request', request_id: 'r1' })).toBe(true)
    expect(ws.sent.at(-1)).toBe('{"type":"control_request","request_id":"r1"}\n')
  })

  test('returns false without a live connection', () => {
    expect(sendToBridge('missing', { type: 'control_request' })).toBe(false)
  })
})

describe('control_response for direct requests', () => {
  test('settles the waiter without persisting or publishing the response', async () => {
    const events: SessionEvent[] = []
    getEventBus('s1').subscribe((event) => events.push(event))
    const pending = requestBridgeControl('s1', 'r1', { subtype: 'file_suggestions' }, 1000)

    const stored = await ingestBridgeMessage(repos, 's1', {
      type: 'control_response',
      response: { subtype: 'success', request_id: 'r1', response: { suggestions: ['a.ts'] } },
    })

    expect(stored).toBeNull()
    await expect(pending).resolves.toEqual({
      subtype: 'success',
      request_id: 'r1',
      response: { suggestions: ['a.ts'] },
    })
    expect(events).toHaveLength(0)
    expect(await repos.events.listSince('s1', 0, 10)).toHaveLength(0)
  })

  test('persists a response that no waiter claims', async () => {
    const stored = await ingestBridgeMessage(repos, 's1', {
      type: 'control_response',
      response: { subtype: 'success', request_id: 'unknown' },
    })

    expect(stored?.type).toBe('control_response')
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

describe('keepalive', () => {
  test('sends keep_alive frames on the configured interval', async () => {
    const ws = createMockWs()
    await handleWebSocketOpen(repos, makeConfig({ wsKeepaliveInterval: 0.02 }), ws as never, 'ka')

    await sleep(40)

    expect(ws.sent.some((line) => line.includes('keep_alive'))).toBe(true)
    expect(ws.closes).toHaveLength(0)
  })

  test('keeps a read-only client connected without inbound data frames', async () => {
    // The bridge uses a hybrid transport: the socket is read-only there and writes
    // (including keep_alive) travel over HTTP POST, so inbound data-frame silence is
    // not evidence of a dead client. Dead sockets are reaped by Bun's idleTimeout,
    // which counts the client's protocol pings.
    const ws = createMockWs()
    await handleWebSocketOpen(repos, makeConfig({ wsKeepaliveInterval: 0.02 }), ws as never, 'hybrid')

    await sleep(120)

    expect(ws.sent.some((line) => line.includes('keep_alive'))).toBe(true)
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
    expect(message.type).toBe('control_response')
    expect(message.response).toEqual({
      subtype: 'success',
      request_id: 'req2',
      response: { behavior: 'deny', message: 'Permission denied by user' },
    })
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
    expect(message.response).toEqual({
      subtype: 'success',
      request_id: 'req-dm1',
      response: { behavior: 'deny', message: 'Please add more tests' },
    })
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
