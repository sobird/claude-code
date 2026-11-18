/**
 * Client side of the session presence channel.
 *
 * The gateway keeps a presence entry for each open session stream; the page
 * reports whether its window can see the session, which the push notifier uses
 * to stay quiet while the user is already looking. The stream URL carries the
 * same client id so the report can be matched to its connection.
 */

export interface PresenceApi {
  post(path: string, body?: unknown): Promise<unknown>
}

/** SSE URL for a session, tagged with the presence client id. */
export function buildSessionEventsUrl(baseUrl: string, sessionId: string, clientId: string): string {
  const path = `/web/sessions/${encodeURIComponent(sessionId)}/events`
  return `${baseUrl}${path}?client_id=${encodeURIComponent(clientId)}`
}

/** Fire-and-forget visibility report; failures never surface to the caller. */
export function createPresenceReporter(
  api: PresenceApi,
  sessionId: string,
  clientId: string,
): (visible: boolean) => void {
  const path = `/web/sessions/${encodeURIComponent(sessionId)}/presence`
  return (visible) => {
    void api.post(path, { client_id: clientId, visible }).catch(() => {})
  }
}
