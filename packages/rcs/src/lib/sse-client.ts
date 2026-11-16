/**
 * Minimal Server-Sent Events parser over a `fetch` response body.
 *
 * We use `fetch` (not `EventSource`) so the browser can send the access token
 * as an `Authorization` header and resume with `Last-Event-ID` on reconnect.
 * Parsing follows the SSE framing rules we need: frames are separated by a
 * blank line, `:` lines are comments/keepalives, `data:` lines are joined with
 * `\n`, and frames without any `data:` field are ignored.
 */

export interface SseEvent {
  id?: string
  event?: string
  data: string
}

const FRAME_SEPARATOR = /\r?\n\r?\n/

function parseFrame(frame: string): SseEvent | null {
  const lines = frame.split(/\r?\n/)
  let id: string | undefined
  let event: string | undefined
  const data: string[] = []

  for (const line of lines) {
    if (line.length === 0 || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)

    if (field === 'id') id = value
    else if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }

  if (data.length === 0) return null
  return { id, event, data: data.join('\n') }
}

/**
 * Consume an SSE response, invoking `onEvent` for each complete frame.
 * Resolves when the stream ends or the signal aborts.
 */
export async function consumeSse(
  response: Response,
  onEvent: (event: SseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const body = response.body
  if (!body) return

  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const emit = (frame: string) => {
    const parsed = parseFrame(frame)
    if (parsed) onEvent(parsed)
  }

  try {
    while (!signal?.aborted) {
      const { done, value } = await reader.read()
      // A chunk can arrive after the caller aborted; drop it instead of emitting.
      if (signal?.aborted) return
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let match = FRAME_SEPARATOR.exec(buffer)
      while (match && match.index !== undefined) {
        const frame = buffer.slice(0, match.index)
        buffer = buffer.slice(match.index + match[0].length)
        if (frame.trim().length > 0) emit(frame)
        match = FRAME_SEPARATOR.exec(buffer)
      }
    }

    if (signal?.aborted) return

    // Flush any final frame that lacked a trailing blank line.
    buffer += decoder.decode()
    if (buffer.trim().length > 0) emit(buffer)
  } finally {
    if (signal?.aborted) {
      // Cancel (not just unlock) so the underlying fetch body is torn down.
      await reader.cancel().catch(() => {})
    } else {
      reader.releaseLock()
    }
  }
}
