/**
 * Telemetry for remote skill loads.
 *
 * `logEvent` metadata only accepts booleans/numbers — strings would risk
 * leaking paths or content. The scheme and fetch method come from a closed
 * set produced by the loader, so they are safe to tag; the error text is
 * reduced to its presence and length.
 */

import { type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS, logEvent } from '../analytics/index.js'

/** Event name is an approximation — not recoverable from the bundle. */
const REMOTE_SKILL_EVENT = 'tengu_remote_skill_loaded'

export function logRemoteSkillLoaded(data: {
  slug: string
  cacheHit: boolean
  latencyMs: number
  urlScheme: string
  error?: string
  fileCount?: number
  totalBytes?: number
  fetchMethod?: string
}): void {
  logEvent(REMOTE_SKILL_EVENT, {
    cache_hit: data.cacheHit,
    latency_ms: data.latencyMs,
    url_scheme: data.urlScheme as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    had_error: data.error !== undefined,
    error_length: data.error?.length,
    ...(data.fileCount !== undefined && { file_count: data.fileCount }),
    ...(data.totalBytes !== undefined && { total_bytes: data.totalBytes }),
    ...(data.fetchMethod !== undefined && {
      fetch_method: data.fetchMethod as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
  })
}
