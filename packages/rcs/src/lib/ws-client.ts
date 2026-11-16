/**
 * WebSocket connector for the ACP relay (`GET /acp/relay/:agentId`).
 *
 * Session history and live events use SSE; WebSockets are only used to talk to
 * an ACP agent through the relay. The access token travels in the subprotocol
 * (`rcs.auth.<base64url(jwt)>`) — never in the URL or query string.
 */

export interface ConnectSessionSocketOptions {
  baseUrl: string
  sessionId: string
  token: string
}

function toBase64(input: string): string {
  if (typeof btoa === 'function') return btoa(input)
  return Buffer.from(input, 'binary').toString('base64')
}

/** Encode a token as unpadded base64url. */
export function encodeBase64Url(token: string): string {
  return toBase64(token).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * Build the relay WebSocket URL. `baseUrl` is the gateway HTTP base; an empty
 * value means same origin (resolved against `window.location` in the browser).
 */
export function buildRelayUrl(baseUrl: string, sessionId: string): string {
  const origin = baseUrl || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
  const url = new URL(`/acp/relay/${encodeURIComponent(sessionId)}`, origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

/**
 * Open a relay socket for `sessionId`, authenticating with the `rcs.auth.`
 * subprotocol. Returns the raw `WebSocket`.
 */
export function connectSessionSocket({ baseUrl, sessionId, token }: ConnectSessionSocketOptions): WebSocket {
  const url = buildRelayUrl(baseUrl, sessionId)
  return new WebSocket(url, [`rcs.auth.${encodeBase64Url(token)}`])
}
