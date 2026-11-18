/**
 * Gate for the skill-search experiment (ant-only).
 *
 * The upstream build reads a GrowthBook flag in addition to the user type.
 * The exact flag name is not recoverable from the bundle, so this uses a
 * descriptive key; denying non-ant users is the load-bearing part of the
 * check regardless, since remote skill discovery is internal-only.
 */

import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'

export function isSkillSearchEnabled(): boolean {
  if (process.env.USER_TYPE !== 'ant') {
    return false
  }
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_skill_search', false)
}
