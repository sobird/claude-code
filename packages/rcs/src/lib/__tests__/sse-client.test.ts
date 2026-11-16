import { describe, expect, test } from 'bun:test'

import { consumeSse, type SseEvent } from '../sse-client'

const encoder = new TextEncoder()

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

async function collect(chunks: string[]): Promise<SseEvent[]> {
  const seen: SseEvent[] = []
  await consumeSse(new Response(streamOf(chunks)), (event) => seen.push(event))
  return seen
}

describe('consumeSse', () => {
  test('consumeSse handles split chunks and multiple events', async () => {
    const chunks = ['id: 2\nevent:', ' message\ndata: {"a":1}\n\nid: 3\ndata: {', '"a":2}\n\n']
    const seen: SseEvent[] = []
    await consumeSse(new Response(streamOf(chunks)), (event) => seen.push(event))
    expect(seen).toEqual([
      { id: '2', event: 'message', data: '{"a":1}' },
      { id: '3', event: undefined, data: '{"a":2}' },
    ])
  })

  test('ignores comments and keepalives', async () => {
    const seen = await collect([
      ': keepalive\n\n',
      'id: 1\ndata: one\n\n',
      ': another ping\n\n',
      'id: 2\ndata: two\n\n',
    ])
    expect(seen).toEqual([
      { id: '1', event: undefined, data: 'one' },
      { id: '2', event: undefined, data: 'two' },
    ])
  })

  test('joins multiple data lines with newlines', async () => {
    const seen = await collect(['id: 5\nevent: message\ndata: line one\ndata: line two\n\n'])
    expect(seen).toEqual([{ id: '5', event: 'message', data: 'line one\nline two' }])
  })

  test('handles CRLF frame separators', async () => {
    const seen = await collect(['id: 9\r\nevent: message\r\ndata: {"ok":true}\r\n\r\n'])
    expect(seen).toEqual([{ id: '9', event: 'message', data: '{"ok":true}' }])
  })

  test('skips frames without a data field', async () => {
    const seen = await collect(['id: 4\nevent: ping\n\n', 'id: 6\ndata: real\n\n'])
    expect(seen).toEqual([{ id: '6', event: undefined, data: 'real' }])
  })

  test('emits a trailing frame that lacks a blank line at EOF', async () => {
    const seen = await collect(['id: 8\ndata: tail'])
    expect(seen).toEqual([{ id: '8', event: undefined, data: 'tail' }])
  })

  test('stops emitting once the signal is aborted', async () => {
    const controller = new AbortController()
    const seen: SseEvent[] = []
    controller.abort()
    await consumeSse(new Response(streamOf(['id: 1\ndata: one\n\n'])), (event) => seen.push(event), controller.signal)
    expect(seen).toEqual([])
  })
})
