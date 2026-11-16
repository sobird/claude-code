'use client'

/**
 * Live session event stream for the session detail UI.
 *
 * Thin React wrapper: the refresh/resume/backoff logic lives in
 * `runStreamWithRefresh` so it can be tested without React. Events are deduped
 * by `seqNum` (falling back to the frame id) because a reconnect replays.
 */

import { useEffect, useRef, useState } from 'react'

import { getApiBaseUrl } from '../lib/api-client'
import { defaultSleep, runStreamWithRefresh, type StreamStatus } from '../lib/reconnect'
import { useAccessToken } from './useAccessToken'

export interface SessionStreamEvent {
  id: string | number
  type: string
  payload: unknown
  direction: string
  seqNum: number
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

function toStreamEvent(id: string | undefined, data: string): SessionStreamEvent | null {
  let parsed: RawFrameData
  try {
    parsed = JSON.parse(data) as RawFrameData
  } catch {
    return null
  }
  if (typeof parsed.type !== 'string' || typeof parsed.seqNum !== 'number') return null
  return {
    id: parsed.seqNum,
    type: parsed.type,
    payload: parsed.payload,
    direction: typeof parsed.direction === 'string' ? parsed.direction : '',
    seqNum: parsed.seqNum,
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
    const seen = new Set<string>()
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
        const event = toStreamEvent(frame.id, frame.data)
        if (!event) return
        const key = String(event.seqNum)
        if (seen.has(key)) return
        seen.add(key)
        setEvents((prev) => [...prev, event])
      },
      onStatus: setStatus,
      signal: controller.signal,
    }).catch((err: unknown) => {
      if (controller.signal.aborted) return
      setError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    })

    return () => controller.abort()
  }, [sessionId, started])

  return { events, status, error }
}
