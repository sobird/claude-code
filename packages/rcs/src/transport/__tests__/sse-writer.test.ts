import { beforeEach, describe, expect, test } from 'bun:test'

import { Hono } from 'hono'

process.env.RCS_AUTH_SECRET = 'test-secret'

import type { AppEnv } from '../../auth/context.js'
import { createMemoryRepositories } from '../../db/repositories/index.js'
import type { Repositories } from '../../db/repositories/types.js'
import { getAllEventBuses, getEventBus, publishSessionEvent, removeEventBus } from '../event-bus.js'
import { createSSEStream, createWorkerEventStream } from '../sse-writer.js'

function createApp(repos: Repositories) {
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    c.set('repos', repos)
    await next()
  })
  app.get('/stream/:sessionId', (c) => {
    const from = Number.parseInt(c.req.query('from') ?? '0', 10)
    return createSSEStream(c, repos, c.req.param('sessionId'), Number.isFinite(from) ? from : 0)
  })
  app.get('/worker/:sessionId', (c) => {
    const from = Number.parseInt(c.req.query('from') ?? '0', 10)
    return createWorkerEventStream(c, repos, c.req.param('sessionId'), Number.isFinite(from) ? from : 0)
  })
  return app
}

/** Read the first non-empty chunk, then cancel the stream. */
async function readPartialStream(res: Response): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return ''
  try {
    const { value } = await reader.read()
    return value ? new TextDecoder().decode(value) : ''
  } finally {
    await reader.cancel().catch(() => {})
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), timeoutMs)
  })
  return Promise.race([promise.catch(() => fallback), timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

/** Run `fn` with `RCS_EVENT_REPLAY_LIMIT` overridden, restoring the previous value after. */
async function withReplayLimit<T>(limit: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.RCS_EVENT_REPLAY_LIMIT
  process.env.RCS_EVENT_REPLAY_LIMIT = limit
  try {
    return await fn()
  } finally {
    if (previous === undefined) delete process.env.RCS_EVENT_REPLAY_LIMIT
    else process.env.RCS_EVENT_REPLAY_LIMIT = previous
  }
}

/** Read until `count` `data:` frames have arrived (or the timeout elapses). */
async function readDataFrames(res: Response, count: number, timeoutMs = 1500): Promise<string[]> {
  const reader = res.body?.getReader()
  if (!reader) return []
  const decoder = new TextDecoder()
  let buffer = ''
  const frames: string[] = []
  const deadline = Date.now() + timeoutMs
  try {
    while (frames.length < count) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) break
      const result = await withTimeout(reader.read(), remaining, { done: true, value: undefined })
      if (result.done || !result.value) break
      buffer += decoder.decode(result.value, { stream: true })
      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const chunk = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ')) frames.push(line.slice('data: '.length))
        }
        boundary = buffer.indexOf('\n\n')
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  return frames
}

let repos: Repositories
let app: Hono<AppEnv>

beforeEach(() => {
  for (const [key] of getAllEventBuses()) removeEventBus(key)
  repos = createMemoryRepositories()
  app = createApp(repos)
})

describe('createSSEStream', () => {
  test('returns a Response with the correct SSE headers', async () => {
    const res = await app.request('/stream/s1')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('text/event-stream')
    expect(res.headers.get('Cache-Control')).toBe('no-cache')
    expect(res.headers.get('Connection')).toBe('keep-alive')
    expect(res.headers.get('X-Accel-Buffering')).toBe('no')
    await res.body?.cancel()
  })

  test('sends an initial keepalive', async () => {
    const res = await app.request('/stream/s2')
    expect(await readPartialStream(res)).toContain(': keepalive')
  })

  test('replays durable events after fromSeqNum', async () => {
    const first = await repos.events.append({
      sessionId: 's3',
      type: 'user',
      payload: { content: 'hello' },
      direction: 'outbound',
    })
    await repos.events.append({ sessionId: 's3', type: 'assistant', payload: { content: 'hi' }, direction: 'inbound' })

    const res = await app.request(`/stream/s3?from=${first.id}`)
    const text = await readPartialStream(res)
    expect(text).toContain(`id: ${first.id + 1}`)
    expect(text).toContain('"seqNum":' + (first.id + 1))
    expect(text).toContain('assistant')
  })

  test('replays the newest window when fromSeqNum is 0', async () => {
    await withReplayLimit('2', async () => {
      for (let index = 0; index < 4; index++) {
        await repos.events.append({
          sessionId: 's5',
          type: 'user',
          payload: { content: `m${index}` },
          direction: 'outbound',
        })
      }

      const res = await app.request('/stream/s5')
      const frames = await readDataFrames(res, 2)
      const contents = frames.map((frame) => (JSON.parse(frame) as { payload: { content: string } }).payload.content)
      expect(contents).toEqual(['m2', 'm3'])
      expect(contents).not.toContain('m0')
    })
  })

  test('bounds an explicit far-behind cursor to the oldest events after it', async () => {
    await withReplayLimit('2', async () => {
      const first = await repos.events.append({
        sessionId: 's8',
        type: 'user',
        payload: { content: 'm0' },
        direction: 'outbound',
      })
      for (let index = 1; index < 4; index++) {
        await repos.events.append({
          sessionId: 's8',
          type: 'user',
          payload: { content: `m${index}` },
          direction: 'outbound',
        })
      }

      const res = await app.request(`/stream/s8?from=${first.id}`)
      const frames = await readDataFrames(res, 2)
      const contents = frames.map((frame) => (JSON.parse(frame) as { payload: { content: string } }).payload.content)
      expect(contents).toEqual(['m1', 'm2'])
    })
  })

  test('a backlog larger than the replay limit drains across successive reconnects', async () => {
    await withReplayLimit('2', async () => {
      const events = []
      for (let index = 0; index < 5; index++) {
        events.push(
          await repos.events.append({
            sessionId: 's10',
            type: 'user',
            payload: { content: `b${index}` },
            direction: 'outbound',
          }),
        )
      }

      // The client had seen b0; reconnect #1 replays the oldest window after its cursor.
      const firstFrames = await readDataFrames(await app.request(`/stream/s10?from=${events[0].id}`), 2)
      // Reconnecting from b2's id (the last seqNum delivered) catches up on the rest.
      const secondFrames = await readDataFrames(await app.request(`/stream/s10?from=${events[2].id}`), 2)

      const contents = [...firstFrames, ...secondFrames].map(
        (frame) => (JSON.parse(frame) as { payload: { content: string } }).payload.content,
      )
      expect(contents).toEqual(['b1', 'b2', 'b3', 'b4'])
    })
  })

  test('subscribes to live events after replay', async () => {
    const res = await app.request('/stream/s6')
    const reader = res.body?.getReader()
    if (!reader) throw new Error('missing stream body')
    const initial = new TextDecoder().decode((await reader.read()).value)
    expect(initial).toContain(': keepalive')

    await publishSessionEvent(repos, getEventBus('s6'), 's6', 'user', { content: 'real-time' }, 'outbound')
    const { value } = await reader.read()
    expect(new TextDecoder().decode(value)).toContain('"content":"real-time"')
    await reader.cancel()
  })

  test('replay then buffered-live delivery loses and duplicates nothing (R22)', async () => {
    const bus = getEventBus('race')
    const first = await repos.events.append({
      sessionId: 'race',
      type: 'user',
      payload: { content: 'a' },
      direction: 'outbound',
    })
    const second = await repos.events.append({
      sessionId: 'race',
      type: 'assistant',
      payload: { content: 'b' },
      direction: 'inbound',
    })

    // Simulate the persist→publish race: the replay snapshot is taken, then the last row
    // is published again (duplicate) and a brand-new event is published (must not be lost).
    let racing = false
    const racingRepos: Repositories = {
      ...repos,
      events: {
        ...repos.events,
        async listSince(sessionId, afterId, limit) {
          const snapshot = await repos.events.listSince(sessionId, afterId, limit)
          if (!racing) {
            racing = true
            const last = snapshot.at(-1)
            if (last) {
              bus.publish({
                id: last.eventId,
                sessionId: last.sessionId,
                type: last.type,
                payload: last.payload,
                direction: last.direction,
                seqNum: last.id,
                createdAt: last.createdAt.getTime(),
              })
            }
            await publishSessionEvent(repos, bus, sessionId, 'user', { content: 'c' }, 'outbound')
          }
          return snapshot
        },
      },
    }

    const res = await createSSEStreamWithRepos(racingRepos, 'race', first.id)
    const frames = await readDataFrames(res, 2)
    const seqNums = frames.map((frame) => (JSON.parse(frame) as { seqNum: number }).seqNum)
    expect(seqNums).toEqual([second.id, second.id + 1])
  })
})

async function createSSEStreamWithRepos(
  target: Repositories,
  sessionId: string,
  fromSeqNum: number,
): Promise<Response> {
  const streamingApp = createApp(target)
  return streamingApp.request(`/stream/${sessionId}?from=${fromSeqNum}`)
}

describe('createWorkerEventStream', () => {
  test('sends client_event frames for outbound events only', async () => {
    await repos.events.append({ sessionId: 'w1', type: 'user', payload: { content: 'seed' }, direction: 'outbound' })
    const inbound = await repos.events.append({
      sessionId: 'w1',
      type: 'assistant',
      payload: { content: 'in' },
      direction: 'inbound',
    })
    await repos.events.append({ sessionId: 'w1', type: 'user', payload: { content: 'out' }, direction: 'outbound' })

    const res = await app.request(`/worker/w1?from=${inbound.id - 1}`)
    const [frame] = await readDataFrames(res, 1)
    const data = JSON.parse(frame) as { event_type: string; sequence_num: number }
    expect(data.event_type).toBe('user')
    expect(data.sequence_num).toBe(inbound.id + 1)
  })

  test('replays the newest outbound window when fromSeqNum is 0', async () => {
    await withReplayLimit('2', async () => {
      const ids: number[] = []
      for (let index = 0; index < 4; index++) {
        const record = await repos.events.append({
          sessionId: 'w2',
          type: 'user',
          payload: { content: `m${index}` },
          direction: 'outbound',
        })
        ids.push(record.id)
      }

      const res = await app.request('/worker/w2')
      const frames = await readDataFrames(res, 2)
      const seqNums = frames.map((frame) => (JSON.parse(frame) as { sequence_num: number }).sequence_num)
      expect(seqNums).toEqual([ids[2], ids[3]])
    })
  })

  test('replays then flushes buffered outbound events exactly once (R22)', async () => {
    const bus = getEventBus('wrace')
    await repos.events.append({
      sessionId: 'wrace',
      type: 'user',
      payload: { content: 'seed' },
      direction: 'outbound',
    })
    const first = await repos.events.append({
      sessionId: 'wrace',
      type: 'assistant',
      payload: { content: 'before' },
      direction: 'outbound',
    })

    let racing = false
    const racingRepos: Repositories = {
      ...repos,
      events: {
        ...repos.events,
        async listSince(sessionId, afterId, limit) {
          const snapshot = await repos.events.listSince(sessionId, afterId, limit)
          if (!racing) {
            racing = true
            const last = snapshot.at(-1)
            if (last) {
              bus.publish({
                id: last.eventId,
                sessionId: last.sessionId,
                type: last.type,
                payload: last.payload,
                direction: last.direction,
                seqNum: last.id,
                createdAt: last.createdAt.getTime(),
              })
            }
            await publishSessionEvent(repos, bus, sessionId, 'user', { content: 'after' }, 'outbound')
          }
          return snapshot
        },
      },
    }

    const res = await createWorkerStreamWithRepos(racingRepos, 'wrace', first.id - 1)
    const frames = await readDataFrames(res, 2)
    const seqNums = frames.map((frame) => (JSON.parse(frame) as { sequence_num: number }).sequence_num)
    expect(seqNums).toEqual([first.id, first.id + 1])
  })
})

async function createWorkerStreamWithRepos(
  target: Repositories,
  sessionId: string,
  fromSeqNum: number,
): Promise<Response> {
  const streamingApp = createApp(target)
  return streamingApp.request(`/worker/${sessionId}?from=${fromSeqNum}`)
}
