/**
 * Character-reveal pacing for streamed assistant text.
 *
 * The bridge batches stream deltas in ~100ms bursts, so appending each burst
 * verbatim reads as jumps. Reveal the text progressively instead: each frame
 * advances a fractional character position toward the target with a floor rate
 * plus a catch-up term proportional to the backlog. This is framerate
 * independent and settles to a small, steady lead behind the newest delta.
 */

/** Floor reveal rate — below this the text visibly lags behind generation. */
const MIN_CHARS_PER_SECOND = 55
/** Time constant for draining the backlog. */
const CATCH_UP_SECONDS = 0.3
/** Clamp one frame's elapsed time so a resumed tab catches up gradually. */
const MAX_STEP_MS = 100

/**
 * Advance a fractional reveal position toward `target` (a character count) by
 * `elapsedMs` of animation. Never passes `target`; snaps to it when the target
 * shrank (a reset), and never rewinds.
 */
export function advanceReveal(position: number, target: number, elapsedMs: number): number {
  if (!(target > position)) return target
  const seconds = Math.min(Math.max(elapsedMs, 0), MAX_STEP_MS) / 1000
  const revealed = position + MIN_CHARS_PER_SECOND * seconds + (target - position) * (seconds / CATCH_UP_SECONDS)
  return Math.min(target, revealed)
}
