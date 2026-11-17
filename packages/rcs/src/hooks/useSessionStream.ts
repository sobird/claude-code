'use client'

/**
 * Live session event stream for the session detail UI.
 *
 * Thin React wrapper: the refresh/resume/backoff logic lives in
 * `runStreamWithRefresh` so it can be tested without React. Events match the
 * gateway history shape (`GET /web/sessions/:id/events`) so callers can render
 * either source with one type, and are deduped by `seqNum` because a reconnect
 * replays.
 */

import { useEffect, useRef, useState } from 'react'

import { getApiBaseUrl } from '../lib/api-client'
import { defaultSleep, runStreamWithRefresh, type StreamStatus } from '../lib/reconnect'
import { useAccessToken } from './useAccessToken'

export interface SessionStreamEvent {
  /** Monotonic per-session sequence number; also the dedupe key. */
  seqNum: number
  type: string
  payload: unknown
  direction: 'inbound' | 'outbound'
  sessionId: string
  /** `Date.now()` at the moment the live frame was parsed. */
  receivedAt: number
  /** The SSE frame carried no `id:`, so this event has no durable counterpart. */
  ephemeral?: boolean
}

export interface UseSessionStreamResult {
  events: SessionStreamEvent[]
  status: StreamStatus
  error: string | null
}

interface RawFrameData {
  type?: unknown
  payload?: unknown
  direction?: unknown
  seqNum?: unknown
}

function toStreamEvent(sessionId: string, data: string, ephemeral: boolean): SessionStreamEvent | null {
  let parsed: RawFrameData
  try {
    parsed = JSON.parse(data) as RawFrameData
  } catch {
    return null
  }
  if (typeof parsed.type !== 'string' || typeof parsed.seqNum !== 'number') return null
  return {
    seqNum: parsed.seqNum,
    type: parsed.type,
    payload: parsed.payload,
    direction: parsed.direction === 'outbound' ? 'outbound' : 'inbound',
    sessionId,
    receivedAt: Date.now(),
    ephemeral,
  }
}

export function useSessionStream(sessionId: string | null): UseSessionStreamResult {
  const { token, refresh } = useAccessToken()
  const [events, setEvents] = useState<SessionStreamEvent[]>([])
  const [status, setStatus] = useState<StreamStatus>('connecting')
  const [error, setError] = useState<string | null>(null)

  const tokenRef = useRef(token)
  const refreshRef = useRef(refresh)

  useEffect(() => {
    tokenRef.current = token
  }, [token])

  useEffect(() => {
    refreshRef.current = refresh
  }, [refresh])

  const started = token !== null

  useEffect(() => {
    if (!sessionId || !started) return undefined

    const controller = new AbortController()
    const seen = new Set<number>()
    let cancelled = false
    const isStale = () => cancelled || controller.signal.aborted
    setEvents([])
    setError(null)
    setStatus('connecting')

    const url = `${getApiBaseUrl()}/web/sessions/${encodeURIComponent(sessionId)}/events`

    runStreamWithRefresh({
      url,
      fetch: (input, init) => fetch(input, init),
      sleep: defaultSleep,
      getToken: () => tokenRef.current,
      refreshToken: async () => {
        const next = await refreshRef.current()
        if (next) tokenRef.current = next
        return next
      },
      onEvent: (frame) => {
        if (isStale()) return
        const event = toStreamEvent(sessionId, frame.data, frame.id === undefined)
        if (!event) return
        if (seen.has(event.seqNum)) return
        seen.add(event.seqNum)
        setEvents((prev) => [...prev, event])
      },
      onStatus: (next) => {
        if (isStale()) return
        setStatus(next)
      },
      signal: controller.signal,
    }).catch((err: unknown) => {
      if (isStale()) return
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [sessionId, started])

  return { events, status, error }
}
