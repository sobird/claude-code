/**
 * Public surface of the context-collapse experiment.
 *
 * The store and projection live in operations.ts; this module re-exports
 * them and owns the enable gate. `CLAUDE_CONTEXT_COLLAPSE` overrides the
 * GrowthBook flag so the experiment can be exercised locally without waiting
 * for an exposure (the flag key is an approximation — its name is not
 * recoverable from the bundle).
 */

import { isEnvTruthy } from '../../utils/envUtils.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'

export type { CollapseResult, ContextCollapseHealth, ContextCollapseStats, DrainResult } from './operations.js'

export {
  applyCollapsesIfNeeded,
  getStats,
  initContextCollapse,
  isWithheldPromptTooLong,
  recoverFromOverflow,
  resetContextCollapse,
  subscribe,
} from './operations.js'

export function isContextCollapseEnabled(): boolean {
  if (isEnvTruthy(process.env.CLAUDE_CONTEXT_COLLAPSE)) {
    return true
  }
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_marble_origami', false)
}
