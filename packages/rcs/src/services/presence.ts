/**
 * In-memory registry of web clients currently looking at a session.
 *
 * Used by the push notifier to stay quiet while its owner already has the
 * session on screen. Entries live only as long as the client's SSE connection:
 * `connectPresence` registers on stream open, the returned release runs on
 * stream close, and visibility is reported out-of-band by the page. That keeps
 * a stale "visible" claim from outliving the connection without a heartbeat.
 */

interface ClientPresence {
  connections: number
  visible: boolean
}

const sessions = new Map<string, Map<string, ClientPresence>>()

/**
 * Registers a client on a session's stream. The entry starts hidden: the page
 * reports its real visibility once the stream is open. Release is idempotent
 * and drops the entry when its last connection closes.
 */
export function connectPresence(sessionId: string, clientId: string): () => void {
  let clients = sessions.get(sessionId)
  if (!clients) {
    clients = new Map()
    sessions.set(sessionId, clients)
  }

  const entry = clients.get(clientId) ?? { connections: 0, visible: false }
  entry.connections += 1
  clients.set(clientId, entry)

  let released = false
  return () => {
    if (released) return
    released = true
    entry.connections -= 1
    if (entry.connections > 0) return
    const current = sessions.get(sessionId)
    if (!current || current.get(clientId) !== entry) return
    current.delete(clientId)
    if (current.size === 0) sessions.delete(sessionId)
  }
}

/**
 * Records whether a connected client can currently see its session. Unknown
 * clients (reports that race stream setup or outlive a close) are ignored.
 */
export function setPresenceVisible(sessionId: string, clientId: string, visible: boolean): boolean {
  const entry = sessions.get(sessionId)?.get(clientId)
  if (!entry) return false
  entry.visible = visible
  return true
}

/** True when at least one live client has the session visible. */
export function isSessionVisible(sessionId: string): boolean {
  const clients = sessions.get(sessionId)
  if (!clients) return false
  for (const entry of clients.values()) {
    if (entry.connections > 0 && entry.visible) return true
  }
  return false
}

export function resetPresenceForTests(): void {
  sessions.clear()
}
