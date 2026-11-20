/**
 * Minimal stdio MCP server for the E2E suite: handles the handshake and
 * exposes a single `echo` tool. Newline-delimited JSON-RPC over stdin/stdout,
 * which is the transport the CLI speaks for `type: 'stdio'` servers.
 */

type RpcMessage = {
  jsonrpc: '2.0'
  id?: string | number
  method?: string
  params?: Record<string, unknown>
}

function send(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function respond(id: string | number, result: Record<string, unknown>): void {
  send({ jsonrpc: '2.0', id, result })
}

function handle(message: RpcMessage): void {
  const { id, method, params } = message
  if (method === undefined) return // a notification (e.g. notifications/initialized)

  switch (method) {
    case 'initialize':
      respond(id!, {
        protocolVersion: (params?.protocolVersion as string | undefined) ?? '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'fixture', version: '0.0.1' },
      })
      return
    case 'tools/list':
      respond(id!, {
        tools: [
          {
            name: 'echo',
            description: 'Echo the provided text back',
            inputSchema: {
              type: 'object',
              properties: { text: { type: 'string' } },
              required: ['text'],
            },
          },
        ],
      })
      return
    case 'tools/call': {
      const text = (params?.arguments as { text?: string } | undefined)?.text ?? ''
      respond(id!, { content: [{ type: 'text', text: `ECHO:${text}` }] })
      return
    }
    case 'resources/list':
      respond(id!, { resources: [] })
      return
    case 'resources/templates/list':
      respond(id!, { resourceTemplates: [] })
      return
    case 'prompts/list':
      respond(id!, { prompts: [] })
      return
    default:
      respond(id!, {})
  }
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk: string) => {
  buffer += chunk
  let newline = buffer.indexOf('\n')
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim()
    buffer = buffer.slice(newline + 1)
    if (line) {
      try {
        handle(JSON.parse(line) as RpcMessage)
      } catch {
        // Ignore malformed lines; the CLI never sends them.
      }
    }
    newline = buffer.indexOf('\n')
  }
})
