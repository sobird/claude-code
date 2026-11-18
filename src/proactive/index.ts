/**
 * Shared state for proactive (autonomous loop) mode.
 *
 * Proactive mode keeps the model working between turns by injecting periodic
 * `<tick>` prompts. The schedulers live outside this module — useProactive in
 * the interactive REPL, print.ts in headless mode — and gate on the state here:
 *
 *  - active:         mode is on (--proactive / CLAUDE_CODE_PROACTIVE /
 *                    the set_proactive control request)
 *  - paused:         user pressed Esc to take control; ticks stay off until
 *                    the next submit resumes them
 *  - contextBlocked: an API error occurred; ticks are suppressed until a
 *                    successful assistant message or compaction clears it, so
 *                    tick → error → tick cannot run away
 *  - nextTickAt:     epoch ms of the next scheduled tick (footer countdown),
 *                    or null when nothing is scheduled
 *
 * The state object is replaced, never mutated, so it can be used directly as a
 * useSyncExternalStore snapshot. Listeners are notified on every change.
 */

type ProactiveListener = () => void

export type ProactiveState = {
  active: boolean
  paused: boolean
  contextBlocked: boolean
  nextTickAt: number | null
}

let state: ProactiveState = {
  active: false,
  paused: false,
  contextBlocked: false,
  nextTickAt: null,
}

const listeners = new Set<ProactiveListener>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

function setState(next: ProactiveState): void {
  if (
    state.active === next.active &&
    state.paused === next.paused &&
    state.contextBlocked === next.contextBlocked &&
    state.nextTickAt === next.nextTickAt
  ) {
    return
  }
  state = next
  emit()
}

/**
 * Turn proactive mode on. Resets pause/blocked state — an explicit activation
 * is a fresh start. `source` is kept for call-site clarity (e.g. 'command').
 */
export function activateProactive(_source?: string): void {
  if (state.active && !state.paused && !state.contextBlocked) {
    return
  }
  setState({ active: true, paused: false, contextBlocked: false, nextTickAt: null })
}

/** Turn proactive mode off and drop any scheduled tick. */
export function deactivateProactive(): void {
  if (!state.active) {
    return
  }
  setState({ active: false, paused: false, contextBlocked: false, nextTickAt: null })
}

/**
 * Pause ticking without leaving the mode (Esc during a turn). SleepTool and
 * the autonomous system prompt remain available; only scheduling stops.
 */
export function pauseProactive(): void {
  if (!state.active || state.paused) {
    return
  }
  setState({ ...state, paused: true, nextTickAt: null })
}

/** Resume after a pause. Called on submit; a no-op when mode is inactive. */
export function resumeProactive(): void {
  if (!state.active || !state.paused) {
    return
  }
  setState({ ...state, paused: false })
}

/**
 * Gate ticks on an API error (or clear the gate once the API recovers or the
 * transcript is compacted). Blocking drops any scheduled tick.
 */
export function setContextBlocked(blocked: boolean): void {
  if (state.contextBlocked === blocked) {
    return
  }
  if (blocked) {
    setState({ ...state, contextBlocked: true, nextTickAt: null })
    return
  }
  setState({ ...state, contextBlocked: false })
}

/**
 * Record when the scheduler will next tick, for the footer countdown.
 * Pass null when no tick is scheduled.
 */
export function setNextTickAt(nextTickAt: number | null): void {
  if (state.nextTickAt === nextTickAt) {
    return
  }
  setState({ ...state, nextTickAt })
}

export function isProactiveActive(): boolean {
  return state.active
}

export function isProactivePaused(): boolean {
  return state.paused
}

export function isContextBlocked(): boolean {
  return state.contextBlocked
}

export function getNextTickAt(): number | null {
  return state.nextTickAt
}

/** Stable useSyncExternalStore snapshot; identity changes only on updates. */
export function getProactiveState(): ProactiveState {
  return state
}

export function subscribeToProactiveChanges(callback: ProactiveListener): () => void {
  listeners.add(callback)
  return () => {
    listeners.delete(callback)
  }
}
