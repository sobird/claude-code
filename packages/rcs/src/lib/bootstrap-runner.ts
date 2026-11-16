/**
 * Node-only bootstrap runner.
 *
 * Kept separate from `bootstrap.ts` so the pure provisioning logic (and its
 * in-memory tests) never pulls in the Postgres driver. Imported dynamically by
 * `src/instrumentation.ts` and by the auth path, which awaits the memoized
 * promise before a login lookup.
 */

import { ensureBootstrapAdmin } from './bootstrap'
import { getRepositories } from './repos'

let bootstrapPromise: Promise<void> | null = null

/**
 * Runs bootstrap at most once per process. The promise never rejects: failures
 * are logged and the memo is reset so a later login can retry after a
 * transient DB outage. Awaiting this is always safe.
 */
export function ensureBootstrapAdminOnce(): Promise<void> {
  if (bootstrapPromise) return bootstrapPromise

  bootstrapPromise = (async () => {
    await ensureBootstrapAdmin(getRepositories())
  })().catch((error: unknown) => {
    bootstrapPromise = null
    console.error('[rcs] bootstrap admin provisioning failed:', error)
  })

  return bootstrapPromise
}

/** Instrumentation entrypoint: ensure the bootstrap admin exists. */
export async function runBootstrap(): Promise<void> {
  await ensureBootstrapAdminOnce()
}
