/**
 * Server-Sent Events transports.
 *
 * Both streams replay durable `session_events` rows and then fan out from the in-process
 * session bus. The subscription is opened *before* the replay query and live events that
 * arrive mid-query are buffered and deduped by `seqNum` (R22), so reconnecting clients see
 * every event exactly once across the replay→live boundary.
 */

import type { Context } from 'hono'

import { loadConfig } from '@/config'
import type { Repositories } from '@/db/repositories/types'

import { createAttachmentLoader, toHydratedWorkerFrame, toSessionEventFrame } from './client-payload.js'
import type { SessionEvent } from './event-bus.js'
import { getEventBus, loadEventReplayWindow, subscribeReplayThenLive } from './event-bus.js'

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

interface EventStreamOptions {
  sessionId: string
  /** `Last-Event-ID` / `from_sequence_num`; 0 replays the newest window. */
  fromSeqNum: number
  /** Replay even when the cursor is 0; the SSE routes default to true. */
  replay?: boolean
  /** Frames may await work (attachment hydration); order is preserved per stream. */
  frame: (event: SessionEvent) => string | Promise<string>
  /** Replay direction, pushed into the query so the window limit counts matching rows. */
  direction?: SessionEvent['direction']
  /** Extra filter applied to both the durable replay and live events. */
  include?: (event: SessionEvent) => boolean
  /** Runs once when the stream closes, for per-connection bookkeeping. */
  onClose?: () => void
}

async function loadReplay(repos: Repositories, options: EventStreamOptions): Promise<SessionEvent[]> {
  const events = await loadEventReplayWindow(
    repos,
    options.sessionId,
    options.fromSeqNum,
    loadConfig().eventReplayLimit,
    options.direction,
  )
  return options.include ? events.filter(options.include) : events
}

function createEventStream(c: Context, repos: Repositories, options: EventStreamOptions): Response {
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
        options.onClose?.()
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

      // Serialize frame production: hydration is async and frames must keep seqNum order.
      let frameChain = Promise.resolve()
      const enqueueFrame = (event: SessionEvent) => {
        frameChain = frameChain
          .then(() => options.frame(event))
          .then((chunk) => send(chunk))
          .catch((error) => console.error('[sse] frame error:', error))
      }

      const subscription = subscribeReplayThenLive({
        bus: getEventBus(options.sessionId),
        fromSeqNum: options.fromSeqNum,
        replay: options.replay ?? true,
        loadSince: () => loadReplay(repos, options),
        filterLiveEvent: options.include,
        onReplayEvent: enqueueFrame,
        onLiveEvent: enqueueFrame,
        isClosed: () => closed,
      })
      unsub = subscription.unsubscribe

      void (async () => {
        await subscription.ready
        // Frames are produced asynchronously (hydration); let the replay window flush
        // before the first keepalive so readers never see it ahead of a data frame.
        await frameChain
        if (closed) return
        send(': keepalive\n\n')
        keepalive = setInterval(() => send(': keepalive\n\n'), KEEPALIVE_MS)
        unrefTimer(keepalive)
      })()

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

/**
 * Live SSE stream for the web UI: `message` frames containing every direction.
 * `fromSeqNum` is the `Last-Event-ID` cursor (0 = no replay).
 */
export function createSSEStream(
  c: Context,
  repos: Repositories,
  sessionId: string,
  fromSeqNum = 0,
  onClose?: () => void,
): Response {
  return createEventStream(c, repos, {
    sessionId,
    fromSeqNum,
    frame: toSessionEventFrame,
    ...(onClose ? { onClose } : {}),
  })
}

/**
 * CCR worker SSE stream: `client_event` frames for outbound events only. `fromSeqNum` is the
 * `Last-Event-ID` / `from_sequence_num` cursor (0 = no replay).
 */
export function createWorkerEventStream(c: Context, repos: Repositories, sessionId: string, fromSeqNum = 0): Response {
  const load = createAttachmentLoader(repos)
  return createEventStream(c, repos, {
    sessionId,
    fromSeqNum,
    frame: (event) => toHydratedWorkerFrame(event, load),
    direction: 'outbound',
    include: (event) => event.direction === 'outbound',
  })
}
