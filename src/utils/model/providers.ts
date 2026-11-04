import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { isEnvTruthy } from '../envUtils.js'

export type APIProvider = 'firstParty' | 'bedrock' | 'vertex' | 'foundry'

export type CustomProviderKind = 'anthropic' | 'openai' | 'gemini'

/**
 * Provider selected through the platform setup screen (or set directly via
 * CLAUDE_CODE_API_PROVIDER). `openai` and `gemini` requests are translated by
 * src/services/api/providerAdapters; `anthropic` means a plain
 * Anthropic-compatible endpoint configured through ANTHROPIC_BASE_URL.
 */
export function getCustomProviderKind(): CustomProviderKind {
  const raw = (process.env.CLAUDE_CODE_API_PROVIDER ?? '').trim().toLowerCase()
  if (raw === 'openai' || raw === 'gemini') {
    return raw
  }
  return 'anthropic'
}

export function getAPIProvider(): APIProvider {
  return isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK)
    ? 'bedrock'
    : isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX)
      ? 'vertex'
      : isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY)
        ? 'foundry'
        : 'firstParty'
}

export function getAPIProviderForStatsig(): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/**
 * Check if ANTHROPIC_BASE_URL is a first-party Anthropic API URL.
 * Returns true if not set (default API) or points to api.anthropic.com
 * (or api-staging.anthropic.com for ant users).
 */
export function isFirstPartyAnthropicBaseUrl(): boolean {
  // Requests for openai/gemini providers are translated in-process and never
  // reach api.anthropic.com, so none of the Anthropic-only features apply.
  if (getCustomProviderKind() !== 'anthropic') {
    return false
  }
  const baseUrl = process.env.ANTHROPIC_BASE_URL
  if (!baseUrl) {
    return true
  }
  try {
    const host = new URL(baseUrl).host
    const allowedHosts = ['api.anthropic.com']
    if (process.env.USER_TYPE === 'ant') {
      allowedHosts.push('api-staging.anthropic.com')
    }
    return allowedHosts.includes(host)
  } catch {
    return false
  }
}
