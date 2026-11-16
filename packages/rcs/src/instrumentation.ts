/**
 * Next.js instrumentation hook.
 *
 * Runs once when the Node server starts and provisions the bootstrap admin on
 * an empty database. The runner is imported dynamically so the Edge runtime
 * (and the build) never loads the Postgres driver. Because some Next versions
 * do not invoke this under `next start`, the auth path also awaits the same
 * memoized bootstrap promise; this is best-effort.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  try {
    const { runBootstrap } = await import('./lib/bootstrap-runner')
    await runBootstrap()
  } catch (error) {
    console.error('[rcs] instrumentation bootstrap failed:', error)
  }
}
