import { describe, expect, test } from 'bun:test'

import { runStreamWithRefresh, type RunStreamDeps, type StreamStatus } from '../reconnect'

const encoder = new TextEncoder()

interface FetchCall {
  url: string
  headers: Record<string, string>
}

function headersOf(init: RequestInit | undefined): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>
}

function sseFrame(id: string, data: string): string {
  return `id: ${id}\nevent: message\ndata: ${data}\n\n`
}

/** A stream that emits one frame, then fails the next read with `error`. */
function streamThenError(frame: string, error: unknown): ReadableStream<Uint8Array> {
  let pulled = false
  return new ReadableStream({
    pull(controller) {
      if (!pulled) {
        pulled = true
        controller.enqueue(encoder.encode(frame))
        return
      }
      controller.error(error)
    },
  })
}

/** A stream that emits the given chunks and then closes. */
function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

function baseDeps(overrides: Partial<RunStreamDeps>): RunStreamDeps {
  return {
    url: '/web/sessions/s1/events',
    fetch: async () => new Response(streamOf()),
    sleep: async () => {},
    getToken: () => 'token-1',
    refreshToken: async () => 'token-2',
    ...overrides,
  }
}

describe('runStreamWithRefresh', () => {
  test('401 during a stream triggers one refresh then resume from last id', async () => {
    const calls: FetchCall[] = []
    const controller = new AbortController()
    let refreshCount = 0
    const authError = Object.assign(new Error('unauthorized'), { status: 401 })

    const deps = baseDeps({
      fetch: async (url, init) => {
        calls.push({ url, headers: headersOf(init) })
        if (calls.length === 1) {
          // Emit id 7, then surface a 401 mid-stream (e.g. the token expired).
          return new Response(
            streamThenError(sseFrame('7', '{"type":"message","payload":{"n":7},"seqNum":7}'), authError),
          )
        }
        // The resumed stream produces one more event so the gate can abort it.
        return new Response(streamOf(sseFrame('8', '{"type":"message","payload":{"n":8},"seqNum":8}')))
      },
      refreshToken: async () => {
        refreshCount += 1
        return 'token-2'
      },
      // A clean EOF reconnects too, so end the test by aborting on the resumed stream.
      onEvent: () => {
        if (calls.length === 2) controller.abort()
      },
      signal: controller.signal,
    })

    const result = await runStreamWithRefresh(deps)

    expect(result).toMatchObject({ reconnects: 1, resumedFrom: '7' })
    expect(refreshCount).toBe(1)
    expect(calls).toHaveLength(2)
    // Resume sends the last event id and the refreshed bearer token.
    expect(calls[1]?.headers['Last-Event-ID']).toBe('7')
    expect(calls[1]?.headers.Authorization).toBe('Bearer token-2')
  })

  test('backoff doubles from 1s and caps at 30s', async () => {
    const sleeps: number[] = []
    const statuses: StreamStatus[] = []
    const controller = new AbortController()
    let fetchCalls = 0

    const deps = baseDeps({
      fetch: async () => {
        fetchCalls += 1
        if (fetchCalls >= 8) controller.abort()
        throw new Error('network down')
      },
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      signal: controller.signal,
      onStatus: (status) => statuses.push(status),
    })

    const result = await runStreamWithRefresh(deps)

    expect(sleeps).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000])
    expect(result.reconnects).toBe(7)
    expect(statuses[0]).toBe('connecting')
    expect(statuses[1]).toBe('reconnecting')
  })

  test('a second consecutive 401 surfaces an error after a single refresh', async () => {
    const unauthorized = () =>
      new Response(JSON.stringify({ error: { type: 'unauthorized', message: 'nope' } }), { status: 401 })
    let fetchCalls = 0
    let refreshCount = 0

    const deps = baseDeps({
      fetch: async () => {
        fetchCalls += 1
        return unauthorized()
      },
      refreshToken: async () => {
        refreshCount += 1
        return 'token-2'
      },
    })

    let thrown: unknown
    try {
      await runStreamWithRefresh(deps)
    } catch (err) {
      thrown = err
    }
    expect(thrown instanceof Error).toBe(true)
    expect((thrown as Error).message).toContain('unauthorized')
    expect(refreshCount).toBe(1)
    expect(fetchCalls).toBe(2)
  })

  test('a clean EOF reconnects with backoff and resumes from the last id', async () => {
    const sleeps: number[] = []
    const statuses: StreamStatus[] = []
    const headers: Record<string, string>[] = []
    const controller = new AbortController()
    let fetchCalls = 0

    const deps = baseDeps({
      fetch: async (_url, init) => {
        fetchCalls += 1
        headers.push(headersOf(init))
        // Both responses end cleanly, as if a proxy closed the stream.
        return new Response(streamOf(sseFrame(String(fetchCalls + 6), `{"seqNum":${fetchCalls + 6}}`)))
      },
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      signal: controller.signal,
      onEvent: () => {
        if (fetchCalls === 2) controller.abort()
      },
      onStatus: (status) => statuses.push(status),
    })

    const result = await runStreamWithRefresh(deps)

    expect(sleeps).toEqual([1000])
    expect(result).toMatchObject({ reconnects: 1, resumedFrom: '7' })
    expect(headers[1]?.['Last-Event-ID']).toBe('7')
    expect(statuses).toContain('reconnecting')
  })

  test('5xx and 429 responses reconnect with backoff', async () => {
    const sleeps: number[] = []
    const statuses: StreamStatus[] = []
    const controller = new AbortController()
    let fetchCalls = 0

    const deps = baseDeps({
      fetch: async () => {
        fetchCalls += 1
        if (fetchCalls === 1) return new Response(null, { status: 503 })
        if (fetchCalls === 2) return new Response(null, { status: 429 })
        controller.abort()
        return new Response(streamOf())
      },
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      signal: controller.signal,
      onStatus: (status) => statuses.push(status),
    })

    const result = await runStreamWithRefresh(deps)

    expect(sleeps).toEqual([1000, 2000])
    expect(result.reconnects).toBe(2)
    expect(statuses.filter((status) => status === 'reconnecting')).toHaveLength(2)
  })

  test('4xx responses other than 429 fail terminally', async () => {
    let fetchCalls = 0
    const deps = baseDeps({
      fetch: async () => {
        fetchCalls += 1
        return new Response(null, { status: 400 })
      },
    })

    let thrown: unknown
    try {
      await runStreamWithRefresh(deps)
    } catch (err) {
      thrown = err
    }
    expect(thrown instanceof Error).toBe(true)
    expect((thrown as Error).message).toContain('HTTP 400')
    expect(fetchCalls).toBe(1)
  })

  test('stops on abort without further fetches', async () => {
    const controller = new AbortController()
    let fetchCalls = 0

    const deps = baseDeps({
      fetch: async () => {
        fetchCalls += 1
        return new Response(streamOf(sseFrame('1', '{"type":"message","seqNum":1}')))
      },
      signal: controller.signal,
      onEvent: () => controller.abort(),
    })

    const result = await runStreamWithRefresh(deps)
    expect(result.reconnects).toBe(0)
    expect(fetchCalls).toBe(1)
  })
})
