/**
 * ACP channel-group SSE stream (`/acp/channel-groups/:id/events`).
 *
 * ACP traffic is in-memory only (R25): the stream replays retained events after
 * `fromSeqNum` from the channel-group `AcpEventBus`, then fans out live events.
 */

import type { Context } from 'hono'

import { getAcpEventBus } from './event-bus.js'

const KEEPALIVE_MS = 15000

const SSE_HEADERS = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
}

function unrefTimer(timer: ReturnType<typeof setInterval>): void {
  ;(timer as { unref?: () => void }).unref?.()
}

/** Create an SSE response stream for an ACP channel group. */
export function createAcpSSEStream(c: Context, channelGroupId: string, fromSeqNum = 0): Response {
  const bus = getAcpEventBus(channelGroupId)
  const encoder = new TextEncoder()

  let dispose = () => {}

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      let unsub = () => {}
      let keepalive: ReturnType<typeof setInterval> | null = null

      const cleanup = () => {
        if (closed) return
        closed = true
        unsub()
        if (keepalive) clearInterval(keepalive)
      }
      dispose = cleanup

      const send = (chunk: string) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          cleanup()
        }
      }

      const frame = (event: { type: string; payload: unknown; direction: string; seqNum: number }) => {
        const data = JSON.stringify({
          type: event.type,
          payload: event.payload,
          direction: event.direction,
          seqNum: event.seqNum,
          channel_group_id: channelGroupId,
        })
        return `id: ${event.seqNum}\nevent: message\ndata: ${data}\n\n`
      }

      // Replay retained events when reconnecting.
      if (fromSeqNum > 0) {
        for (const event of bus.getEventsSince(fromSeqNum)) {
          send(frame(event))
        }
      }

      // Initial keepalive.
      send(': keepalive\n\n')

      // Subscribe to new events.
      unsub = bus.subscribe((event) => {
        send(frame(event))
      })

      keepalive = setInterval(() => send(': keepalive\n\n'), KEEPALIVE_MS)
      unrefTimer(keepalive)

      c.req.raw.signal.addEventListener('abort', () => {
        cleanup()
        try {
          controller.close()
        } catch {
          // already closed
        }
      })
    },
    cancel() {
      dispose()
    },
  })

  return new Response(stream, { headers: SSE_HEADERS })
}
