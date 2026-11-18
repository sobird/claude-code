import type { Dispatch, SetStateAction } from 'react'

import { oscColor, type TerminalQuerier } from '../ink/terminal-querier.js'
import { setCachedSystemTheme, type SystemTheme, themeFromOscColor } from './systemTheme.js'

/** Poll cadence. Theme changes are rare; a slow poll keeps the cost negligible. */
const POLL_INTERVAL_MS = 10_000

/**
 * Polls the terminal's background color with OSC 11 while the 'auto' theme is
 * active, updating both React state and the module-level cache when it
 * changes. `flush()` is paired with the query so an unsupported terminal
 * resolves the query with `undefined` instead of hanging it forever.
 *
 * Returns a stop function for the effect cleanup.
 */
export function watchSystemTheme(
  querier: TerminalQuerier,
  setTheme: Dispatch<SetStateAction<SystemTheme>>,
): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | null = null

  async function poll(): Promise<void> {
    if (stopped) return
    try {
      const [response] = await Promise.all([querier.send(oscColor(11)), querier.flush()])
      if (stopped) return
      if (response?.type === 'osc') {
        const theme = themeFromOscColor(response.data)
        if (theme !== undefined) {
          setCachedSystemTheme(theme)
          setTheme(theme)
        }
      }
    } catch {
      // The querier never rejects; guard regardless so one bad poll doesn't
      // kill the watcher.
    } finally {
      if (!stopped) {
        timer = setTimeout(poll, POLL_INTERVAL_MS)
      }
    }
  }

  void poll()

  return () => {
    stopped = true
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }
}
