/**
 * Interactive-REPL tick scheduler for proactive mode.
 *
 * Headless mode schedules ticks in print.ts; the REPL delegates here. A tick
 * is a hidden user message (`isMeta`) holding the current local time, which
 * keeps the model alive between turns — see getProactiveSection() in
 * constants/prompts.ts for what the model is told to do with it.
 *
 * A tick is only scheduled when the REPL is quiet: proactive mode is on, not
 * paused (Esc), not context-blocked (API error), no turn is streaming, the
 * command queue is empty, no local-JSX UI is open, and the user is not in plan
 * mode. Wake-up pacing is the model's job (SleepTool); this hook only adds a
 * small settle delay so user input and UI transitions win the race.
 */

import { useEffect, useRef, useSyncExternalStore } from 'react'

import { TICK_TAG } from '../constants/xml.js'
import {
  getProactiveState,
  isContextBlocked,
  isProactiveActive,
  isProactivePaused,
  setNextTickAt,
  subscribeToProactiveChanges,
} from './index.js'

/** Quiet period between the REPL going idle and the next autonomous tick. */
const TICK_DELAY_MS = 5_000

type UseProactiveOptions = {
  /** A query is streaming — never tick into a running turn. */
  isLoading: boolean
  /** Prompts are queued — let them drain first. */
  queuedCommandsLength: number
  /** A local-JSX command (e.g. a dialog) owns the UI. */
  hasActiveLocalJsxUI: boolean
  /** Plan mode is waiting on the user; don't self-drive through it. */
  isInPlanMode: boolean
  /** Idle: start a tick turn immediately. */
  onSubmitTick: (prompt: string) => void
  /** A turn started while the timer was pending: queue the tick behind it. */
  onQueueTick: (prompt: string) => void
}

function makeTickPrompt(): string {
  return `<${TICK_TAG}>${new Date().toLocaleTimeString()}</${TICK_TAG}>`
}

export function useProactive({
  isLoading,
  queuedCommandsLength,
  hasActiveLocalJsxUI,
  isInPlanMode,
  onSubmitTick,
  onQueueTick,
}: UseProactiveOptions): void {
  const { active, paused, contextBlocked } = useSyncExternalStore(
    subscribeToProactiveChanges,
    getProactiveState,
    getProactiveState,
  )

  // The callbacks are inline closures at the call site, so keep the latest
  // pair in a ref rather than restarting the timer on every REPL render.
  const callbacksRef = useRef({ onSubmitTick, onQueueTick })
  useEffect(() => {
    callbacksRef.current = { onSubmitTick, onQueueTick }
  }, [onSubmitTick, onQueueTick])

  const idle = !isLoading && queuedCommandsLength === 0 && !hasActiveLocalJsxUI && !isInPlanMode
  const shouldTick = active && !paused && !contextBlocked && idle

  useEffect(() => {
    if (!shouldTick) {
      setNextTickAt(null)
      return undefined
    }

    setNextTickAt(Date.now() + TICK_DELAY_MS)
    const timer = setTimeout(() => {
      setNextTickAt(null)
      // Re-check state at fire time; the props closed over here were current
      // as of the effect run, and the store is re-read live.
      if (!isProactiveActive() || isProactivePaused() || isContextBlocked()) {
        return
      }
      const { onSubmitTick: submit, onQueueTick: queue } = callbacksRef.current
      if (isLoading) {
        queue(makeTickPrompt())
        return
      }
      submit(makeTickPrompt())
    }, TICK_DELAY_MS)

    return () => {
      clearTimeout(timer)
    }
  }, [shouldTick, isLoading, queuedCommandsLength, hasActiveLocalJsxUI, isInPlanMode])
}
