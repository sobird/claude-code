import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'

/**
 * Runtime gate for /ultraplan. Upstream's `wc()` reads GrowthBook's
 * `tengu_ultraplan_config.enabled` and defaults to disabled; this fork keeps
 * `{ enabled: true }` as the default so the feature stays usable offline.
 * Callers combine this with the build-time `feature('ULTRAPLAN')` flag, which
 * keeps the command out of external builds.
 */
export function isUltraplanEnabled(): boolean {
  return (
    getFeatureValue_CACHED_MAY_BE_STALE<{ enabled: boolean } | null>('tengu_ultraplan_config', { enabled: true })
      ?.enabled === true
  )
}
