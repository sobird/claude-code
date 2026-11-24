// In production Caddy serves the UI and the gateway from one origin. In dev the
// client calls the gateway directly: Next's dev rewrite proxy buffers SSE until
// the response ends. The client derives the gateway host from the page host, so
// localhost and LAN addresses both work.
import { networkInterfaces } from 'node:os'

import { GATEWAY_PORT, resolveDevTls, UI_PORT } from './dev-net'

// HTTPS in dev: both the Next UI and the gateway must speak TLS, because the
// client derives the gateway URL from the page protocol (`https://host:4000`).
// Certificate discovery is shared with `dev-remote-control.ts`.
const tls = resolveDevTls()
const uiProtocol = tls ? 'https' : 'http'

function localUiOrigins(): string[] {
  const hosts = ['localhost', '127.0.0.1']
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) hosts.push(info.address)
    }
  }
  // Allow both schemes so the gateway keeps working if TLS certs disappear.
  return hosts.flatMap((host) => [`http://${host}:${UI_PORT}`, `https://${host}:${UI_PORT}`])
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

if (tls) {
  // The gateway reads these in server/index.ts and serves HTTPS on the same port
  // (Bun runs plain HTTP + WebSocket upgrades over TLS together).
  process.env.RCS_TLS_CERT = tls.cert
  process.env.RCS_TLS_KEY = tls.key
  // CLI-facing work secrets embed this origin; keep it in step with the gateway.
  process.env.RCS_BASE_URL ||= tls.origin
}

// Pairing links (`<webUrl>/device`) point at the UI. In dev the UI and gateway
// are on different ports, so without this they would fall back to the gateway
// origin and the short code page would 404.
process.env.RCS_WEB_URL ||= `${uiProtocol}://localhost:${UI_PORT}`

const webCmd = ['bunx', 'next', 'dev', '--port', String(UI_PORT)]
if (tls) {
  webCmd.push('--experimental-https', '--experimental-https-key', tls.key, '--experimental-https-cert', tls.cert)
}

const specs: { label: string; cmd: string[] }[] = [
  { label: 'web', cmd: webCmd },
  { label: 'gateway', cmd: ['bun', '--watch', 'server/index.ts'] },
]

console.log(
  tls
    ? `[dev] HTTPS enabled for ${uiProtocol}://localhost:${UI_PORT} and gateway :${GATEWAY_PORT} (${tls.cert})`
    : '[dev] No TLS certs found (RCS_DEV_TLS_CERT/RCS_DEV_TLS_KEY or ~/certificates); serving plain HTTP',
)

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
  // process start, so the `RCS_TLS_CERT` / `RCS_TLS_KEY` assignments above would
  // not reach the children otherwise.
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
