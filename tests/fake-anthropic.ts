/**
 * A scripted stand-in for the Anthropic Messages API.
 *
 * E2E tests point the real CLI at this server via ANTHROPIC_BASE_URL so the
 * whole request pipeline (SDK streaming, tool execution, permissions, session
 * persistence) runs for real, while the "model" answers deterministically.
 *
 * The reply builders below cover the message shapes the CLI has to handle:
 * streamed text, single and parallel tool calls, split tool arguments,
 * extended thinking, redacted thinking, server-side tools, non-standard stop
 * reasons, and API errors.
 */

export type JsonObject = Record<string, unknown>

export type FakeToolCall = {
  name: string
  input: JsonObject
  /** Split the JSON input across several input_json_delta events. */
  split?: boolean
}

export type FakeReply =
  | { kind: 'text'; text: string; chunks?: string[]; stopReason?: 'end_turn' }
  | { kind: 'toolUse'; calls: FakeToolCall[] }
  | { kind: 'thinking'; thinking: string; signature: string; text: string }
  | { kind: 'redactedThinking'; data: string; text: string }
  | { kind: 'serverTool'; query: string; text: string }
  | { kind: 'stop'; stopReason: 'max_tokens' | 'refusal'; text: string }
  | {
      kind: 'error'
      status: number
      errorType: string
      message: string
      retryAfterSeconds?: number
    }

export function textReply(text: string, options: { chunks?: string[]; stopReason?: 'end_turn' } = {}): FakeReply {
  return { kind: 'text', text, ...options }
}

export function toolUseReply(calls: FakeToolCall[]): FakeReply {
  return { kind: 'toolUse', calls }
}

export function thinkingReply(thinking: string, text: string): FakeReply {
  return { kind: 'thinking', thinking, signature: 'fake-signature', text }
}

export function redactedThinkingReply(text: string): FakeReply {
  return { kind: 'redactedThinking', data: 'fake-redacted-data', text }
}

export function serverToolReply(query: string, text: string): FakeReply {
  return { kind: 'serverTool', query, text }
}

export function stopReply(stopReason: 'max_tokens' | 'refusal', text: string): FakeReply {
  return { kind: 'stop', stopReason, text }
}

export function errorReply(status: number, errorType: string, message: string, retryAfterSeconds?: number): FakeReply {
  return { kind: 'error', status, errorType, message, retryAfterSeconds }
}

export type RecordedRequest = {
  index: number
  method: string
  path: string
  search: string
  headers: Record<string, string>
  text: string
  body: JsonObject | null
}

export type FakeAnthropic = {
  url: string
  requests: RecordedRequest[]
  stop(): void
}

export type FakeScript = FakeReply | FakeReply[] | ((request: RecordedRequest) => FakeReply | Promise<FakeReply>)

/**
 * Starts the fake server on a random port and returns its base URL.
 *
 * An array script is consumed one entry per /v1/messages call; once exhausted
 * the last entry repeats, which makes runaway loops (e.g. --max-turns) easy to
 * script. A function script decides per request and can inspect the history.
 */
export async function startFakeAnthropic(script: FakeScript, options: { model?: string } = {}): Promise<FakeAnthropic> {
  const requests: RecordedRequest[] = []
  const model = options.model ?? 'claude-test'
  let replyCount = 0
  let toolId = 0

  function render(reply: Exclude<FakeReply, { kind: 'error' }>): string {
    const events: string[] = []
    let blockIndex = 0
    let messageId = ''

    const push = (event: string, data: JsonObject) => {
      events.push(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }

    const textBlock = (text: string, chunks?: string[]) => {
      push('content_block_start', {
        type: 'content_block_start',
        index: blockIndex,
        content_block: { type: 'text', text: '' },
      })
      for (const chunk of chunks ?? [text]) {
        push('content_block_delta', {
          type: 'content_block_delta',
          index: blockIndex,
          delta: { type: 'text_delta', text: chunk },
        })
      }
      push('content_block_stop', { type: 'content_block_stop', index: blockIndex })
      blockIndex += 1
    }

    const toolBlock = (call: FakeToolCall) => {
      const id = `toolu_${toolId++}`
      push('content_block_start', {
        type: 'content_block_start',
        index: blockIndex,
        content_block: { type: 'tool_use', id, name: call.name, input: {} },
      })
      const json = JSON.stringify(call.input)
      const limit = call.split && json.length > 1 ? Math.floor(json.length / 2) : json.length
      for (const part of [json.slice(0, limit), json.slice(limit)].filter(Boolean)) {
        push('content_block_delta', {
          type: 'content_block_delta',
          index: blockIndex,
          delta: { type: 'input_json_delta', partial_json: part },
        })
      }
      push('content_block_stop', { type: 'content_block_stop', index: blockIndex })
      blockIndex += 1
    }

    const thinkingBlock = (thinking: string, signature: string) => {
      push('content_block_start', {
        type: 'content_block_start',
        index: blockIndex,
        content_block: { type: 'thinking', thinking: '' },
      })
      push('content_block_delta', {
        type: 'content_block_delta',
        index: blockIndex,
        delta: { type: 'thinking_delta', thinking },
      })
      push('content_block_delta', {
        type: 'content_block_delta',
        index: blockIndex,
        delta: { type: 'signature_delta', signature },
      })
      push('content_block_stop', { type: 'content_block_stop', index: blockIndex })
      blockIndex += 1
    }

    const redactedBlock = (data: string) => {
      push('content_block_start', {
        type: 'content_block_start',
        index: blockIndex,
        content_block: { type: 'redacted_thinking', data },
      })
      push('content_block_stop', { type: 'content_block_stop', index: blockIndex })
      blockIndex += 1
    }

    const serverToolBlock = (query: string) => {
      const id = `srvtoolu_${toolId++}`
      push('content_block_start', {
        type: 'content_block_start',
        index: blockIndex,
        content_block: { type: 'server_tool_use', id, name: 'web_search', input: {} },
      })
      push('content_block_delta', {
        type: 'content_block_delta',
        index: blockIndex,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify({ query }) },
      })
      push('content_block_stop', { type: 'content_block_stop', index: blockIndex })
      blockIndex += 1
      push('content_block_start', {
        type: 'content_block_start',
        index: blockIndex,
        content_block: {
          type: 'web_search_tool_result',
          tool_use_id: id,
          content: [
            {
              type: 'web_search_result',
              title: 'Fake result',
              url: 'https://example.com/fake',
              encrypted_content: 'fake-encrypted',
              page_age: null,
            },
          ],
        },
      })
      push('content_block_stop', { type: 'content_block_stop', index: blockIndex })
      blockIndex += 1
    }

    const finish = (stopReason: string) => {
      push('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { output_tokens: 5 },
      })
      push('message_stop', { type: 'message_stop' })
    }

    messageId = `msg_${replyCount}`
    push('message_start', {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 1 },
      },
    })

    switch (reply.kind) {
      case 'text':
        textBlock(reply.text, reply.chunks)
        finish(reply.stopReason ?? 'end_turn')
        break
      case 'toolUse':
        for (const call of reply.calls) toolBlock(call)
        finish('tool_use')
        break
      case 'thinking':
        thinkingBlock(reply.thinking, reply.signature)
        textBlock(reply.text)
        finish('end_turn')
        break
      case 'redactedThinking':
        redactedBlock(reply.data)
        textBlock(reply.text)
        finish('end_turn')
        break
      case 'serverTool':
        serverToolBlock(reply.query)
        textBlock(reply.text)
        finish('end_turn')
        break
      case 'stop':
        textBlock(reply.text)
        finish(reply.stopReason)
        break
    }

    return events.join('')
  }

  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      if (request.method !== 'POST') return new Response('ok')

      const url = new URL(request.url)
      const text = await request.text()
      let body: JsonObject | null = null
      try {
        body = JSON.parse(text) as JsonObject
      } catch {
        body = null
      }
      const recorded: RecordedRequest = {
        index: requests.length,
        method: request.method,
        path: url.pathname,
        search: url.search,
        headers: Object.fromEntries(request.headers),
        text,
        body,
      }
      requests.push(recorded)

      if (url.pathname.endsWith('/v1/messages/count_tokens')) {
        return Response.json({ input_tokens: 42 })
      }
      if (!url.pathname.endsWith('/v1/messages')) {
        return new Response('not found', { status: 404 })
      }

      let reply: FakeReply
      if (typeof script === 'function') {
        reply = await script(recorded)
      } else {
        const replies = Array.isArray(script) ? script : [script]
        const chosen = replies[Math.min(replyCount, replies.length - 1)]
        if (!chosen) throw new Error('fake script produced no reply')
        reply = chosen
      }
      replyCount += 1

      if (reply.kind === 'error') {
        const headers: Record<string, string> = { 'content-type': 'application/json' }
        if (reply.retryAfterSeconds !== undefined) headers['retry-after'] = String(reply.retryAfterSeconds)
        return Response.json(
          { type: 'error', error: { type: reply.errorType, message: reply.message } },
          { status: reply.status, headers },
        )
      }

      return new Response(render(reply), { headers: { 'content-type': 'text/event-stream' } })
    },
  })

  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    stop: () => server.stop(true),
  }
}
