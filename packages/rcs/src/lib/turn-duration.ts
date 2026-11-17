/**
 * Seconds label for a finished turn. One decimal under ten seconds is useful
 * for quick replies; past that, whole seconds keep the line calm.
 */
export function formatTurnSeconds(ms: number): string {
  const seconds = Math.max(0, ms) / 1000
  const rounded = Math.round(seconds * 10) / 10
  return rounded < 10 ? rounded.toFixed(1) : String(Math.round(seconds))
}
