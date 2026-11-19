/**
 * NDJSON framing for the `claude ssh` session transport.
 *
 * The remote CLI runs in print/stream-json mode with
 * `--permission-prompt-tool stdio`, so both directions are newline-delimited
 * JSON: `StdinMessage` frames go up, `StdoutMessage` frames come back. These
 * helpers are pure so the wire format can be tested without a process.
 */

import type { StdoutMessage } from '../entrypoints/sdk/controlTypes.js'
import type { RemoteMessageContent } from '../utils/teleport/api.js'

export type SSHPermissionResponse = {
  behavior: string
  message?: string
  updatedInput?: unknown
}

/** Marshal a user turn onto the remote CLI's stdin. */
export function encodeUserMessage(content: RemoteMessageContent, sessionId?: string): string {
  return `${JSON.stringify({
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
    ...(sessionId ? { session_id: sessionId } : {}),
  })}\n`
}

/** Ask the remote CLI to abort the in-flight turn. */
export function encodeInterrupt(requestId: string): string {
  return `${JSON.stringify({
    type: 'control_request',
    request_id: requestId,
    request: { subtype: 'interrupt' },
  })}\n`
}

/** Answer a `can_use_tool` control request. */
export function encodePermissionResponse(requestId: string, response: SSHPermissionResponse): string {
  return `${JSON.stringify({
    type: 'control_response',
    response: {
      subtype: 'success',
      request_id: requestId,
      response:
        response.behavior === 'allow'
          ? { behavior: response.behavior, updatedInput: response.updatedInput }
          : { behavior: response.behavior, message: response.message },
    },
  })}\n`
}

/**
 * Parse one stdout line. Returns null for blank/malformed lines so a stray
 * debug print never tears down the session.
 */
export function parseStdoutLine(line: string): StdoutMessage | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as StdoutMessage
  } catch {
    return null
  }
}

/** Incremental newline splitter for a chunked stdout stream. */
export class LineDecoder {
  private buffer = ''

  push(chunk: string): string[] {
    this.buffer += chunk
    const lines: string[] = []
    let newline = this.buffer.indexOf('\n')
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, '')
      if (line) lines.push(line)
      this.buffer = this.buffer.slice(newline + 1)
      newline = this.buffer.indexOf('\n')
    }
    return lines
  }

  flush(): string {
    const remainder = this.buffer
    this.buffer = ''
    return remainder
  }
}

/** Bounded ring of remote stderr, surfaced on disconnect. */
export class StderrTail {
  private text = ''

  constructor(private readonly maxLength = 4096) {}

  push(chunk: string): void {
    this.text += chunk
    if (this.text.length > this.maxLength) {
      this.text = this.text.slice(this.text.length - this.maxLength)
    }
  }

  get(): string {
    return this.text
  }
}
