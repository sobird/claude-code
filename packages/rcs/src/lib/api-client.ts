/**
 * Token-aware fetch client for the gateway `/web/*` API.
 *
 * The browser holds a short-lived access token (see `useAccessToken`) and sends
 * it as `Authorization: Bearer …`. When a request comes back `401` the client
 * refreshes the token exactly once and retries. Error bodies come in two shapes
 * — `{ error: 'message' }` and `{ error: { type, message } }` — so both are
 * unwrapped into a single message on `ApiError`.
 */

export interface ApiClientOptions {
  getToken: () => string | null | undefined
  refreshToken: () => Promise<string | null | undefined>
  baseUrl?: string
}

export interface ApiClient {
  get: <T>(path: string) => Promise<T>
  post: <T>(path: string, body?: unknown) => Promise<T>
  patch: <T>(path: string, body?: unknown) => Promise<T>
  delete: <T>(path: string) => Promise<T>
  /** Fetch a binary response (attachments) with the same auth/refresh handling. */
  blob: (path: string) => Promise<Blob>
  /** Upload a raw binary body; `contentType` defaults to the blob's own type. */
  upload: <T>(path: string, body: Blob, contentType?: string) => Promise<T>
}

/** Error thrown for non-2xx responses, carrying the HTTP status, message, and stable code. */
export class ApiError extends Error {
  readonly status: number
  readonly code?: string

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

/**
 * Base URL for gateway API calls. `NEXT_PUBLIC_RCS_API_URL` wins when set. In
 * production an empty value keeps fetches same-origin (one origin behind the
 * reverse proxy); in development it targets the gateway on the page's own host,
 * because Next's dev rewrite proxy buffers SSE until the response completes.
 * Deriving the host (rather than hardcoding localhost) keeps LAN access working.
 *
 * `process.env.NEXT_PUBLIC_RCS_API_URL` must stay a literal member expression so
 * Next's compiler inlines it into client bundles; tests set `process.env` before
 * calling this function instead of passing an env object.
 */
export function getApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_RCS_API_URL
  if (typeof configured === 'string' && configured.length > 0) return configured.replace(/\/+$/, '')
  if (process.env.NODE_ENV === 'development' && typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:4000`
  }
  return ''
}

/** Stable code and/or human-readable message from either gateway error shape. */
export interface ExtractedApiError {
  code?: string
  message?: string
}

/**
 * Unwrap a gateway error body. Flat Web errors are `{ error: '…', code? }`;
 * nested gateway errors are `{ error: { type, message, code? } }`. Nested errors
 * fall back to `type` as the stable code so callers have something to translate.
 */
export function extractApiError(body: unknown): ExtractedApiError {
  if (!body || typeof body !== 'object' || !('error' in body)) return {}
  const outer = body as { error: unknown; code?: unknown }
  const error = outer.error

  if (typeof error === 'string' && error.length > 0) {
    if (typeof outer.code === 'string' && outer.code.length > 0) return { code: outer.code, message: error }
    return { message: error }
  }

  if (error && typeof error === 'object') {
    const nested = error as { type?: unknown; message?: unknown; code?: unknown }
    const result: ExtractedApiError = {}
    const code =
      typeof nested.code === 'string' && nested.code.length > 0
        ? nested.code
        : typeof nested.type === 'string' && nested.type.length > 0
          ? nested.type
          : undefined
    if (code !== undefined) result.code = code
    if (typeof nested.message === 'string' && nested.message.length > 0) result.message = nested.message
    return result
  }

  return {}
}

/** Extract a human-readable message from either gateway error shape. */
export function extractErrorMessage(body: unknown, fallback: string): string {
  return extractApiError(body).message ?? fallback
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.length === 0) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export function createApiClient({ getToken, refreshToken, baseUrl }: ApiClientOptions): ApiClient {
  const base = baseUrl ?? getApiBaseUrl()

  /** Runs `perform` with the current token, retrying once after a refresh on 401. */
  async function authorized(perform: (token: string | null | undefined) => Promise<Response>): Promise<Response> {
    let response = await perform(getToken())
    if (response.status === 401) {
      const refreshed = await refreshToken()
      response = await perform(refreshed)
    }
    if (!response.ok) {
      const parsed = await parseBody(response)
      const extracted = extractApiError(parsed)
      const message = extracted.message ?? (response.statusText || `HTTP ${response.status}`)
      throw new ApiError(response.status, message, extracted.code)
    }
    return response
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await authorized((token) => {
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`
      const init: RequestInit = { method, headers }
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json'
        init.body = JSON.stringify(body)
      }
      return fetch(`${base}${path}`, init)
    })
    if (response.status === 204) return undefined as T
    return (await parseBody(response)) as T
  }

  async function fetchBlob(path: string): Promise<Blob> {
    const response = await authorized((token) =>
      fetch(`${base}${path}`, {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }),
    )
    return response.blob()
  }

  async function upload<T>(path: string, body: Blob, contentType?: string): Promise<T> {
    const response = await authorized((token) => {
      const headers: Record<string, string> = { 'Content-Type': contentType ?? body.type }
      if (token) headers.Authorization = `Bearer ${token}`
      return fetch(`${base}${path}`, { method: 'POST', headers, body })
    })
    if (response.status === 204) return undefined as T
    return (await parseBody(response)) as T
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    patch: (path, body) => request('PATCH', path, body),
    delete: (path) => request('DELETE', path),
    blob: fetchBlob,
    upload,
  }
}
