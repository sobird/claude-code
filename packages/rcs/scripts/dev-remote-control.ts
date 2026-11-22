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
import { resolve } from 'node:path'

import { devGatewayOrigin, isLoopback, mkcertRoot } from './dev-net'

const PACKAGE_DIR = resolve(import.meta.dir, '..')
const REPO_ROOT = resolve(PACKAGE_DIR, '../..')

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
  // Node does not read the macOS keychain, so point it at mkcert's root CA for a
  // loopback dev gateway. Never widen trust for a remote deployment.
  if (baseUrl.startsWith('https://') && isLoopback(baseUrl)) {
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
