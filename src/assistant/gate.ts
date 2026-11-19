import { checkGate_CACHED_OR_BLOCKING } from '../services/analytics/growthbook.js'

/**
 * GrowthBook gate that entitles an account to assistant (KAIROS) mode.
 * Same gate referenced by the KAIROS activation flow in main.tsx.
 */
const KAIROS_GATE = 'tengu_kairos'

/**
 * Blocking entitlement check for assistant mode.
 *
 * Fast path returns a cached `true` instantly; if the disk cache says
 * false/missing, this lazily initializes GrowthBook and fetches fresh
 * (bounded at ~5s). Callers run before the trust dialog, so a stale `true`
 * is acceptable — the trust check is enforced separately in main.tsx.
 */
export function isKairosEnabled(): Promise<boolean> {
  return checkGate_CACHED_OR_BLOCKING(KAIROS_GATE)
}
