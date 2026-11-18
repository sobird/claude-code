import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'

/**
 * GrowthBook config for cache-editing microcompact (ant-only).
 *
 * Cached MC doesn't rewrite local content — it queues `cache_edits` blocks
 * that tell the API to delete tool results server-side, preserving the cached
 * prefix. Model support is an allow-list because the beta only works on a
 * subset of models.
 *
 * The flag key is an approximation: the upstream name is not recoverable from
 * the bundle. The default disables the feature, so this tree behaves exactly
 * like today unless the flag is set.
 */
export type CachedMCConfig = {
  /** Master switch. When false, cached MC never runs. */
  enabled: boolean
  /** Whether the system prompt should suggest summaries for pruned results. */
  systemPromptSuggestSummaries: boolean
  /** Substrings matched against the model id. Empty means no model support. */
  supportedModels: string[]
  /** Keep this many most-recent tool groups before deleting older ones. */
  keepRecent: number
  /** Number of active tool groups that triggers a delete pass. */
  triggerThreshold: number
}

const CACHED_MC_CONFIG_DEFAULTS: CachedMCConfig = {
  enabled: false,
  systemPromptSuggestSummaries: false,
  supportedModels: [],
  keepRecent: 5,
  triggerThreshold: 20,
}

export function getCachedMCConfig(): CachedMCConfig {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_cached_microcompact_config', CACHED_MC_CONFIG_DEFAULTS)
}
