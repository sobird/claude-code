/**
 * ACP channel-group SSE stream (`/acp/channel-groups/:id/events`).
 *
 * ACP traffic is in-memory only (R25): the stream replays retained events after
 * `fromSeqNum` from the channel-group `AcpEventBus`, then fans out live events.
 *
 * Buses are owner-scoped, so the stream subscribes once per visible owner of the
 * group. A member only ever passes their own id; an admin viewing a group that two
 * owners reused sees the merged stream.
 */

import type { Context } from 'hono'

import { acpBusKey, getAcpEventBus } from './event-bus.js'

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

/** Create an SSE response stream for an ACP channel group visible to the listed owners. */
export function createAcpSSEStream(
  c: Context,
  ownerUserIds: string[],
  channelGroupId: string,
  fromSeqNum = 0,
): Response {
  const buses = ownerUserIds.map((ownerId) => getAcpEventBus(acpBusKey(ownerId, channelGroupId)))
  const encoder = new TextEncoder()

  let dispose = () => {}

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      const unsubs: Array<() => void> = []
      let keepalive: ReturnType<typeof setInterval> | null = null

      const cleanup = () => {
        if (closed) return
        closed = true
        for (const unsub of unsubs) unsub()
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

      // Replay retained events when reconnecting. Each owner bus numbers its events
      // independently, so merge and order the replay by seqNum.
      if (fromSeqNum > 0) {
        const replay = buses.flatMap((bus) => bus.getEventsSince(fromSeqNum))
        replay.sort((a, b) => a.seqNum - b.seqNum)
        for (const event of replay) {
          send(frame(event))
        }
      }

      // Initial keepalive.
      send(': keepalive\n\n')

      // Subscribe to new events from every visible owner's bus.
      for (const bus of buses) {
        unsubs.push(
          bus.subscribe((event) => {
            send(frame(event))
          }),
        )
      }

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
