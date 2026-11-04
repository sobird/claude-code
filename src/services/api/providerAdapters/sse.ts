import type { AnthropicStreamEvent, JsonObject } from './types.js'

export const SSE_HEADERS: Record<string, string> = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache',
  connection: 'keep-alive',
}

const DONE = Symbol('sse-done')

function parseSSEBlock(raw: string): JsonObject | typeof DONE | null {
  const dataLines: string[] = []
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data:')) continue
    dataLines.push(line.slice(5).trimStart())
  }
  if (dataLines.length === 0) return null
  const data = dataLines.join('\n')
  if (data === '[DONE]') return DONE
  try {
    const parsed: unknown = JSON.parse(data)
    return parsed && typeof parsed === 'object' ? (parsed as JsonObject) : null
  } catch {
    // Keep-alive comments and malformed partial chunks are ignored; the next
    // chunk re-synchronises on the blank-line boundary.
    return null
  }
}

/** Parses an SSE byte stream into JSON payloads (event names are ignored). */
export async function* parseSSEEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<JsonObject> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n')
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const event = parseSSEBlock(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 2)
        if (event === DONE) return
        if (event) yield event
        boundary = buffer.indexOf('\n\n')
      }
    }
    const tail = parseSSEBlock(buffer.replace(/\r\n/g, '\n'))
    if (tail && tail !== DONE) yield tail
  } finally {
    reader.releaseLock()
  }
}

export function encodeSSEEvent(event: JsonObject & { type: string }): Uint8Array {
  return new TextEncoder().encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
}

/** Wraps a generator of Anthropic stream events in an SSE Response. */
export function anthropicSSEResponse(
  events: AsyncIterable<AnthropicStreamEvent>,
  options: { signal?: AbortSignal; requestId?: string } = {},
): Response {
  const { signal, requestId } = options
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of events) {
          if (signal?.aborted) break
          controller.enqueue(encodeSSEEvent(event))
        }
      } catch (error) {
        try {
          controller.enqueue(
            encodeSSEEvent({
              type: 'error',
              error: {
                type: 'api_error',
                message: error instanceof Error ? error.message : String(error),
              },
            }),
          )
        } catch {
          // The consumer cancelled the stream; nothing left to deliver.
        }
      } finally {
        try {
          controller.close()
        } catch {
          // Already closed/cancelled.
        }
      }
    },
  })
  return new Response(body, {
    status: 200,
    headers: {
      ...SSE_HEADERS,
      ...(requestId ? { 'request-id': requestId } : {}),
    },
  })
}
