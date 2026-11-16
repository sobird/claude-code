/**
 * Per-environment in-process poll notifier.
 *
 * `POST` handlers enqueue a work item and call `notifyWorkAvailable` so a long-polling
 * environment wakes immediately instead of waiting for the next poll interval. The
 * session event bus lives in `src/transport/event-bus.ts`; this module only coordinates
 * pollers.
 */

type Waiter = () => void

const waiters = new Map<string, Set<Waiter>>()

/** Wake every poller currently waiting on the environment. */
export function notifyWorkAvailable(environmentId: string): void {
  const pending = waiters.get(environmentId)
  if (!pending) return
  waiters.delete(environmentId)
  for (const waiter of pending) {
    waiter()
  }
}

/**
 * Resolve when the environment is notified or `timeoutMs` elapses, whichever comes
 * first. Callers re-check the repository after waking.
 */
export function waitForWorkAvailable(environmentId: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout>

    let pending = waiters.get(environmentId)
    if (!pending) {
      pending = new Set<Waiter>()
      waiters.set(environmentId, pending)
    }
    const group = pending

    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      group.delete(finish)
      if (group.size === 0 && waiters.get(environmentId) === group) {
        waiters.delete(environmentId)
      }
      // oxlint-disable-next-line promise/no-multiple-resolved -- `settled` guards double resolution
      resolve()
    }

    group.add(finish)
    timer = setTimeout(finish, Math.max(0, timeoutMs))
  })
}
