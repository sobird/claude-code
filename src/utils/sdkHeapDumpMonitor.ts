import { logForDebugging } from './debug.js'
import { performHeapDump } from './heapDumpService.js'

/** Threshold in bytes that triggers an automatic dump (1.5 GB). */
const AUTO_DUMP_THRESHOLD_BYTES = 1.5 * 1024 * 1024 * 1024
/** How often heap usage is sampled. */
const CHECK_INTERVAL_MS = 60_000
/** Cap per process so a genuine leak can't fill the disk with snapshots. */
const MAX_AUTO_DUMPS = 3

/**
 * Watches heap usage in SDK (headless) sessions and captures a heap snapshot
 * the first few times it crosses 1.5 GB. Dumps are numbered so a session that
 * leaks repeatedly produces an ordered series to diff.
 */
export function startSdkMemoryMonitor(): void {
  let dumpCount = 0
  let dumping = false
  const timer = setInterval(() => {
    if (dumping || dumpCount >= MAX_AUTO_DUMPS) {
      return
    }
    const { heapUsed } = process.memoryUsage()
    if (heapUsed < AUTO_DUMP_THRESHOLD_BYTES) {
      return
    }
    dumping = true
    dumpCount += 1
    const dumpNumber = dumpCount
    logForDebugging(
      `[HeapDump] heapUsed ${(heapUsed / 1024 / 1024).toFixed(0)}MB exceeds 1.5GB, dumping (#${dumpNumber})`,
    )
    void performHeapDump('auto-1.5GB', dumpNumber)
      .catch((error: unknown) => {
        logForDebugging(`[HeapDump] auto dump failed: ${String(error)}`, { level: 'error' })
      })
      .finally(() => {
        dumping = false
      })
  }, CHECK_INTERVAL_MS)
  timer.unref()
}
