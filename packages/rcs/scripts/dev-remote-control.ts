/**
 * Launch the repository CLI in `remote-control` (bridge) mode against the local
 * dev gateway started by `bun run dev`.
 *
 * The published npm binary lacks the self-hosted `CLAUDE_BRIDGE_*` overrides, so
 * this spawns the CLI from source (`scripts/dev.ts` at the repo root) rather
 * than a global `claude`.
 *
 * Usage (from packages/rcs, with `bun run dev` already running):
 *   CLAUDE_BRIDGE_OAUTH_TOKEN=rcs_... bun run dev:remote-control
 *
 * The token is a per-user API key created at /settings; `RCS_DEV_API_KEY` is
 * accepted as an alias. Set `CLAUDE_BRIDGE_BASE_URL` to override the detected
 * gateway origin. Arguments after `--` are forwarded to the CLI.
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const PACKAGE_DIR = resolve(import.meta.dir, '..')
const REPO_ROOT = resolve(PACKAGE_DIR, '../..')
const GATEWAY_PORT = process.env.RCS_PORT?.trim() || '4000'

function firstExisting(paths: string[]): string | null {
  for (const path of paths) {
    if (path && existsSync(path)) return path
  }
  return null
}

/** Mirror `scripts/dev.ts`: TLS is on when the local dev certs exist. */
function devGatewayOrigin(): string {
  const certsDir = process.env.RCS_DEV_CERTS_DIR?.trim() || join(homedir(), 'certificates')
  const cert = firstExisting([
    process.env.RCS_DEV_TLS_CERT?.trim() ?? '',
    join(certsDir, 'localhost+3.pem'),
    join(certsDir, 'cert.pem'),
  ])
  const key = firstExisting([
    process.env.RCS_DEV_TLS_KEY?.trim() ?? '',
    join(certsDir, 'localhost+3-key.pem'),
    join(certsDir, 'key.pem'),
  ])
  return `${cert && key ? 'https' : 'http'}://localhost:${GATEWAY_PORT}`
}

/** mkcert's root CA, when installed, so the bridge trusts the dev TLS cert. */
function mkcertRoot(): string | null {
  return firstExisting([
    join(homedir(), 'Library/Application Support/mkcert/rootCA.pem'),
    join(homedir(), '.local/share/mkcert/rootCA.pem'),
  ])
}

function fail(message: string): never {
  console.error(`[dev:remote-control] ${message}`)
  process.exit(1)
}

async function main(): Promise<never> {
  const apiKey = (process.env.CLAUDE_BRIDGE_OAUTH_TOKEN ?? process.env.RCS_DEV_API_KEY ?? '').trim()
  if (!apiKey) {
    fail(
      'missing API key: create one at /settings, then set CLAUDE_BRIDGE_OAUTH_TOKEN (or RCS_DEV_API_KEY) in packages/rcs/.env',
    )
  }

  const baseUrl = process.env.CLAUDE_BRIDGE_BASE_URL?.trim() || devGatewayOrigin()
  const env: Record<string, string | undefined> = {
    ...process.env,
    USER_TYPE: 'ant',
    CLAUDE_BRIDGE_BASE_URL: baseUrl,
    CLAUDE_BRIDGE_OAUTH_TOKEN: apiKey,
    CLAUDE_CODE_INCLUDE_PARTIAL_MESSAGES: process.env.CLAUDE_CODE_INCLUDE_PARTIAL_MESSAGES ?? '1',
  }
  // Node does not read the macOS keychain, so point it at mkcert's root CA when
  // the dev gateway serves the self-signed localhost certificate.
  if (baseUrl.startsWith('https://')) {
    const root = process.env.NODE_EXTRA_CA_CERTS || mkcertRoot()
    if (root) env.NODE_EXTRA_CA_CERTS = root
  }

  // `bun run dev:remote-control -- --flag` arrives with a literal `--` first.
  const forwarded = process.argv.slice(2)
  if (forwarded[0] === '--') forwarded.shift()

  console.log(`[dev:remote-control] ${baseUrl} → bun scripts/dev.ts remote-control`)
  const child = Bun.spawn(['bun', 'scripts/dev.ts', 'remote-control', ...forwarded], {
    cwd: REPO_ROOT,
    env,
    stdio: ['inherit', 'inherit', 'inherit'],
  })
  process.exit(await child.exited)
}

void main()
