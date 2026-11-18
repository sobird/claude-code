import { registerCleanup } from './cleanupRegistry.js'
import { logForDebugging } from './debug.js'

/** How often the detector samples the loop. */
const CHECK_INTERVAL_MS = 1000
/** A tick later than expected by more than this means the loop was blocked. */
const STALL_THRESHOLD_MS = 500

/**
 * Samples the main thread once a second and logs whenever a timer fires later
 * than expected — i.e. the event loop was blocked (>500ms). Cheap enough to
 * leave running for a whole session; the timer is unref'd so it never keeps
 * the process alive.
 */
export function startEventLoopStallDetector(): void {
  let lastTick = Date.now()
  const timer = setInterval(() => {
    const now = Date.now()
    const drift = now - lastTick - CHECK_INTERVAL_MS
    lastTick = now
    if (drift > STALL_THRESHOLD_MS) {
      logForDebugging(`[EventLoop] main thread blocked for ${drift}ms`, { level: 'warn' })
    }
  }, CHECK_INTERVAL_MS)
  timer.unref()
  registerCleanup(async () => {
    clearInterval(timer)
  })
}
