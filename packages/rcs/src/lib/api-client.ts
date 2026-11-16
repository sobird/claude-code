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
  delete: <T>(path: string) => Promise<T>
}

/** Error thrown for non-2xx responses, carrying the HTTP status and message. */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/**
 * Base URL for gateway API calls. Uses `NEXT_PUBLIC_RCS_API_URL` when set (dev
 * points straight at the gateway) and otherwise returns `''` so fetches stay
 * same-origin (production serves both from one origin).
 *
 * `process.env.NEXT_PUBLIC_RCS_API_URL` must stay a literal member expression so
 * Next's compiler inlines it into client bundles; tests set `process.env` before
 * calling this function instead of passing an env object.
 */
export function getApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_RCS_API_URL
  if (typeof configured !== 'string' || configured.length === 0) return ''
  return configured.replace(/\/+$/, '')
}

/** Extract a human-readable message from either gateway error shape. */
export function extractErrorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'error' in body) {
    const error = (body as { error: unknown }).error
    if (typeof error === 'string' && error.length > 0) return error
    if (error && typeof error === 'object') {
      const message = (error as { message?: unknown }).message
      if (typeof message === 'string' && message.length > 0) return message
    }
  }
  return fallback
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

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const perform = async (token: string | null | undefined): Promise<Response> => {
      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`
      const init: RequestInit = { method, headers }
      if (body !== undefined) {
        headers['Content-Type'] = 'application/json'
        init.body = JSON.stringify(body)
      }
      return fetch(`${base}${path}`, init)
    }

    let response = await perform(getToken())
    if (response.status === 401) {
      const refreshed = await refreshToken()
      response = await perform(refreshed)
    }

    if (!response.ok) {
      const parsed = await parseBody(response)
      const message = extractErrorMessage(parsed, response.statusText || `HTTP ${response.status}`)
      throw new ApiError(response.status, message)
    }

    if (response.status === 204) return undefined as T
    return (await parseBody(response)) as T
  }

  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    delete: (path) => request('DELETE', path),
  }
}
