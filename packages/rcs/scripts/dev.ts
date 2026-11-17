// In production Caddy serves the UI and the gateway from one origin. In dev the
// client calls the gateway directly: Next's dev rewrite proxy buffers SSE until
// the response ends. The client derives the gateway host from the page host, so
// localhost and LAN addresses both work.
import { networkInterfaces } from 'node:os'

const UI_PORT = 3000

function localUiOrigins(): string[] {
  const hosts = ['localhost', '127.0.0.1']
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) hosts.push(info.address)
    }
  }
  return hosts.map((host) => `http://${host}:${UI_PORT}`)
}

// Direct gateway calls are cross-origin, so seed the allowlist with every local
// UI origin while keeping whatever the caller configured explicitly.
process.env.RCS_WEB_CORS_ORIGINS = [
  ...new Set(
    [process.env.RCS_WEB_CORS_ORIGINS ?? '', ...localUiOrigins()]
      .flatMap((entry) => entry.split(','))
      .map((entry) => entry.trim())
      .filter(Boolean),
  ),
].join(',')

const specs: { label: string; cmd: string[] }[] = [
  { label: 'web', cmd: ['bunx', 'next', 'dev', '--port', '3000'] },
  { label: 'gateway', cmd: ['bun', '--watch', 'server/index.ts'] },
]

async function pipeWithPrefix(stream: ReadableStream<Uint8Array>, label: string) {
  const decoder = new TextDecoder()
  const reader = stream.getReader()
  let pending = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    pending += decoder.decode(value, { stream: true })
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) console.log(`[${label}] ${line}`)
  }
  if (pending) console.log(`[${label}] ${pending}`)
}

const children = specs.map(({ label, cmd }) => {
  // Pass `env` explicitly: Bun.spawn only inherits the environment captured at
  // process start, so the `NEXT_PUBLIC_RCS_API_URL` assignment above would not
  // reach the children otherwise.
  const child = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe', env: process.env })
  void pipeWithPrefix(child.stdout, label)
  void pipeWithPrefix(child.stderr, label)
  return child
})

let shuttingDown = false

function shutdown(code: number): never {
  if (!shuttingDown) {
    shuttingDown = true
    for (const child of children) child.kill()
  }
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

async function main() {
  const exits = await Promise.all(children.map((child) => child.exited))
  shutdown(exits.some((code) => code !== 0) ? 1 : 0)
}

void main()
