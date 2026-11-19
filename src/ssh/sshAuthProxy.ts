/**
 * Local auth-injecting proxy for `claude ssh`.
 *
 * The remote CLI points `ANTHROPIC_UNIX_SOCKET` at a unix socket that ssh
 * reverse-forwards (`-R`) back to this server. Every API request arrives here
 * over that socket with the remote's placeholder credentials; we strip them,
 * inject the local machine's real auth (OAuth or API key), and forward to the
 * upstream Anthropic API. Remote tools run; real credentials never leave the
 * local machine.
 *
 * The proxy speaks plain HTTP on the socket. The launcher sets
 * `ANTHROPIC_BASE_URL=http://api.anthropic.com` on the remote child so the
 * Anthropic SDK's unix-socket fetch is plain HTTP (an `https://` base URL makes
 * Bun attempt TLS on the socket).
 */

import { randomUUID } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getApiKeyFromApiKeyHelper } from '../utils/auth.js'
import { type AuthHeaders, getAuthHeaders } from '../utils/http.js'

export interface SSHAuthProxyOptions {
  socketPath?: string
  /** Upstream base URL; defaults to the local ANTHROPIC_BASE_URL or Anthropic. */
  upstreamBaseUrl?: string
  /** Injectable for tests; defaults to {@link resolveProxyAuthHeaders}. */
  authHeaders?: () => AuthHeaders | Promise<AuthHeaders>
}

export interface SSHAuthProxyHandle {
  socketPath: string
  stop(): void
}

const DEFAULT_UPSTREAM = 'https://api.anthropic.com'
const STRIPPED_HEADERS = new Set(['host', 'content-length', 'authorization', 'x-api-key', 'anthropic-beta'])

function mergeBetaHeaders(existing: string | null, injected: string | undefined): string | undefined {
  const tokens = new Set<string>()
  for (const value of [existing, injected]) {
    if (!value) continue
    for (const token of value.split(',')) {
      const trimmed = token.trim()
      if (trimmed) tokens.add(trimmed)
    }
  }
  return tokens.size > 0 ? [...tokens].join(', ') : undefined
}

/** Dependencies for {@link resolveProxyAuthHeaders}; injectable for tests. */
export interface ProxyAuthDeps {
  authHeaders: () => AuthHeaders
  getApiKeyFromHelper: () => Promise<string | null>
  env: () => Record<string, string | undefined>
}

/**
 * Resolve the credentials to inject, mirroring the live client exactly:
 * `configureApiKeyHeaders` (client.ts:135) always turns an explicit
 * `ANTHROPIC_AUTH_TOKEN` — or an `apiKeyHelper` token — into a Bearer
 * `Authorization` header, taking precedence over the OAuth/x-api-key paths.
 * Only when neither exists do we fall back to `getAuthHeaders()` (OAuth for
 * subscribers, else `x-api-key`). Many Anthropic-compatible gateways (e.g.
 * DeepSeek `/anthropic`) accept only a Bearer token and 401 the placeholder
 * `ANTHROPIC_API_KEY`, which would otherwise make the child retry forever.
 */
export async function resolveProxyAuthHeaders(deps: ProxyAuthDeps): Promise<AuthHeaders> {
  const token = deps.env().ANTHROPIC_AUTH_TOKEN || (await deps.getApiKeyFromHelper().catch(() => null))
  if (token) return { headers: { Authorization: `Bearer ${token}` } }
  return deps.authHeaders()
}

const realAuthDeps: ProxyAuthDeps = {
  authHeaders: getAuthHeaders,
  getApiKeyFromHelper: () => getApiKeyFromApiKeyHelper(true),
  env: () => process.env,
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

export function createAuthProxy(options: SSHAuthProxyOptions = {}): SSHAuthProxyHandle {
  const socketPath = options.socketPath ?? join(tmpdir(), `claude-ssh-${randomUUID()}.sock`)
  const upstreamBase = (options.upstreamBaseUrl ?? process.env.ANTHROPIC_BASE_URL ?? DEFAULT_UPSTREAM).replace(
    /\/+$/,
    '',
  )
  const resolveAuth = options.authHeaders ?? (() => resolveProxyAuthHeaders(realAuthDeps))

  // A stale socket from a crashed session would make serve() fail with EADDRINUSE.
  try {
    unlinkSync(socketPath)
  } catch {
    // ENOENT — nothing to clean up.
  }

  const server = Bun.serve({
    unix: socketPath,
    async fetch(req) {
      const { headers: auth, error } = await resolveAuth()
      if (error) return jsonResponse({ error }, 401)

      const incoming = new URL(req.url)
      const target = `${upstreamBase}${incoming.pathname}${incoming.search}`

      const headers = new Headers()
      for (const [key, value] of req.headers) {
        if (STRIPPED_HEADERS.has(key.toLowerCase())) continue
        headers.set(key, value)
      }
      for (const [key, value] of Object.entries(auth)) {
        headers.set(key, value)
      }
      const beta = mergeBetaHeaders(req.headers.get('anthropic-beta'), auth['anthropic-beta'])
      if (beta) headers.set('anthropic-beta', beta)

      const hasBody = req.method !== 'GET' && req.method !== 'HEAD'
      // Bun's fetch decodes the upstream body transparently, so forwarding a
      // compressed body while keeping its original content-encoding would make
      // the downstream decode it a second time (surfaces as ZstdDecompressionError).
      headers.set('accept-encoding', 'identity')
      try {
        const upstreamResponse = await fetch(target, {
          method: req.method,
          headers,
          body: hasBody ? req.body : undefined,
        })
        const responseHeaders = new Headers(upstreamResponse.headers)
        responseHeaders.delete('content-encoding')
        responseHeaders.delete('content-length')
        return new Response(upstreamResponse.body, {
          status: upstreamResponse.status,
          statusText: upstreamResponse.statusText,
          headers: responseHeaders,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return jsonResponse({ error: `Upstream request failed: ${message}` }, 502)
      }
    },
  })

  return {
    socketPath,
    stop() {
      void server.stop(true)
      try {
        unlinkSync(socketPath)
      } catch {
        // Already removed by the server shutdown.
      }
    },
  }
}
