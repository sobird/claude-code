/**
 * Shared local-dev network/TLS discovery for the dev launcher scripts.
 *
 * `dev.ts` (Next UI + gateway) and `dev-remote-control.ts` (CLI bridge) must
 * agree on whether the gateway speaks HTTPS: a mismatch sends the bridge to the
 * wrong scheme. Production does not use this — Caddy terminates TLS in the
 * container stack and `RCS_TLS_*` stays unset.
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const UI_PORT = 3000
export const GATEWAY_PORT = process.env.RCS_PORT?.trim() || '4000'

export interface DevTls {
  cert: string
  key: string
  /** Gateway origin clients (browser + CLI) should use, e.g. https://localhost:4000. */
  origin: string
}

function firstExisting(paths: string[]): string | null {
  for (const path of paths) {
    if (path && existsSync(path)) return path
  }
  return null
}

/**
 * Certificate pair discovery: explicit `RCS_DEV_TLS_CERT`/`RCS_DEV_TLS_KEY`,
 * then the `RCS_DEV_CERTS_DIR` (default `~/certificates`) candidates. Returns
 * null when either half is missing, so callers fall back to plain HTTP.
 */
export function resolveDevTls(): DevTls | null {
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
  if (!cert || !key) return null
  return { cert, key, origin: `https://localhost:${GATEWAY_PORT}` }
}

/** Gateway origin the browser and CLI should target. */
export function devGatewayOrigin(tls: DevTls | null = resolveDevTls()): string {
  return tls?.origin ?? `http://localhost:${GATEWAY_PORT}`
}

/** mkcert's root CA, when installed, so Node trusts the dev TLS certificate. */
export function mkcertRoot(): string | null {
  return firstExisting([
    join(homedir(), 'Library/Application Support/mkcert/rootCA.pem'),
    join(homedir(), '.local/share/mkcert/rootCA.pem'),
  ])
}

/** Loopback is the only place the local dev CA should be trusted. */
export function isLoopback(origin: string): boolean {
  try {
    const { hostname } = new URL(origin)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  } catch {
    return false
  }
}
