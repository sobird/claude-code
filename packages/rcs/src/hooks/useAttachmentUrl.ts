'use client'

/**
 * Resolves `/web/attachments/:id` to an object URL the browser can render.
 *
 * `<img src>` cannot carry the bearer token, so images are fetched through the
 * API client and cached as object URLs. The cache is capped; the oldest entries
 * are dropped first (object URLs are never revoked, so the cap bounds memory).
 */

import { useEffect, useMemo, useRef, useState } from 'react'

import { createApiClient, type ApiClient } from '../lib/api-client'
import { useAccessToken } from './useAccessToken'

const MAX_CACHED_URLS = 50
const urlCache = new Map<string, Promise<string>>()

function loadUrl(api: Pick<ApiClient, 'blob'>, id: string): Promise<string> {
  const cached = urlCache.get(id)
  if (cached) return cached
  const pending = api.blob(`/web/attachments/${encodeURIComponent(id)}`).then((blob) => URL.createObjectURL(blob))
  urlCache.set(id, pending)
  const oldest = urlCache.keys().next().value
  if (oldest !== undefined && urlCache.size > MAX_CACHED_URLS) urlCache.delete(oldest)
  pending.catch(() => urlCache.delete(id))
  return pending
}

export function useAttachmentUrl(id: string | null | undefined): string | null {
  const { token, refresh } = useAccessToken()
  const tokenRef = useRef(token)
  useEffect(() => {
    tokenRef.current = token
  }, [token])
  const api = useMemo(() => createApiClient({ getToken: () => tokenRef.current, refreshToken: refresh }), [refresh])
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    if (!id) {
      setUrl(null)
    } else {
      loadUrl(api, id)
        .then((resolved) => {
          if (active) setUrl(resolved)
        })
        .catch(() => {
          if (active) setUrl(null)
        })
    }
    return () => {
      active = false
    }
  }, [api, id])

  return url
}
