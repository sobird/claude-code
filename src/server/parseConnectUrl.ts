/**
 * Parses a `cc://` (TCP) or `cc+unix://` (unix-socket) direct-connect URL.
 *
 * Formats accepted:
 *   cc://<host>[:port][/path][?token=<token>]
 *   cc+unix://<abs-socket-path>[?token=<token>]
 *
 * `token` may also be supplied as `auth` / `authToken` query params, or as a
 * `#token=<token>` fragment. The returned `serverUrl` is what
 * `createDirectConnectSession` feeds to `fetch` — an `http://` origin for TCP
 * (plus any path prefix) or a `unix:<path>` identifier for sockets, matching
 * the value written by `writeServerLock`.
 */

export type ParsedConnectUrl = {
  serverUrl: string
  authToken: string
  protocol: 'http' | 'unix'
  host?: string
  port?: string
  unix?: string
  [key: string]: unknown
}

const TCP_PREFIX = 'cc://'
const UNIX_PREFIX = 'cc+unix://'

/** Splits `path?query#hash` into its parts without requiring a base URL. */
function splitPathQueryHash(input: string): { pathname: string; params: URLSearchParams } {
  let rest = input
  let hash = ''
  const hashIdx = rest.indexOf('#')
  if (hashIdx !== -1) {
    hash = rest.slice(hashIdx + 1)
    rest = rest.slice(0, hashIdx)
  }
  let query = ''
  const queryIdx = rest.indexOf('?')
  if (queryIdx !== -1) {
    query = rest.slice(queryIdx + 1)
    rest = rest.slice(0, queryIdx)
  }
  const params = new URLSearchParams(query)
  // A `#token=…` fragment is a legacy alternative to the query param.
  if (hash) {
    const hashParams = new URLSearchParams(hash)
    for (const [key, value] of hashParams) {
      if (!params.has(key)) params.set(key, value)
    }
  }
  return { pathname: rest, params }
}

function readToken(params: URLSearchParams): string {
  return params.get('token') ?? params.get('authToken') ?? params.get('auth') ?? ''
}

export function parseConnectUrl(url: string): ParsedConnectUrl {
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('Empty connect URL')
  }

  if (url.startsWith(UNIX_PREFIX)) {
    const { pathname, params } = splitPathQueryHash(url.slice(UNIX_PREFIX.length))
    const socketPath = decodeURIComponent(pathname)
    if (!socketPath) {
      throw new Error(`Invalid unix connect URL: ${url}`)
    }
    return {
      serverUrl: `unix:${socketPath}`,
      authToken: readToken(params),
      protocol: 'unix',
      unix: socketPath,
    }
  }

  if (url.startsWith(TCP_PREFIX)) {
    const { pathname, params } = splitPathQueryHash(url.slice(TCP_PREFIX.length))
    // `host[:port][/path]` — let the platform URL parser handle IPv6 brackets
    // and port validation by giving it a temporary http scheme.
    let parsed: URL
    try {
      parsed = new URL(`http://${pathname}`)
    } catch {
      throw new Error(`Invalid connect URL: ${url}`)
    }
    if (!parsed.hostname) {
      throw new Error(`Invalid connect URL (missing host): ${url}`)
    }
    const host = parsed.hostname
    const port = parsed.port
    const pathPrefix = parsed.pathname === '/' ? '' : parsed.pathname
    return {
      serverUrl: `http://${host}${port ? `:${port}` : ''}${pathPrefix}`,
      authToken: readToken(params),
      protocol: 'http',
      host,
      ...(port ? { port } : {}),
      ...(pathPrefix ? { pathPrefix } : {}),
    }
  }

  throw new Error(`Unsupported connect URL scheme (expected cc:// or cc+unix://): ${url}`)
}
