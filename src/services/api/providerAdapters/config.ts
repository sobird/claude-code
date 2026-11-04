import { getCustomProviderKind } from '../../../utils/model/providers.js'
import type { ActiveProviderKind, ProviderConfig, ProviderModelTier } from './types.js'

export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1'
export const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

export const PROVIDER_DEFAULT_BASE_URL: Record<ActiveProviderKind, string> = {
  openai: OPENAI_DEFAULT_BASE_URL,
  gemini: GEMINI_DEFAULT_BASE_URL,
}

/**
 * Model used for each Claude tier when the user configures only a base URL and
 * API key. Without this the Anthropic model name would be forwarded verbatim to
 * the provider and rejected.
 */
export const PROVIDER_DEFAULT_MODELS: Record<ActiveProviderKind, Record<ProviderModelTier, string>> = {
  openai: { haiku: 'gpt-4o-mini', sonnet: 'gpt-4o', opus: 'o3' },
  gemini: { haiku: 'gemini-2.5-flash', sonnet: 'gemini-2.5-pro', opus: 'gemini-2.5-pro' },
}

/** Reads the provider selected by CLAUDE_CODE_API_PROVIDER and its env config. */
export function getProviderConfig(): ProviderConfig | null {
  const kind = getCustomProviderKind()
  if (kind === 'anthropic') {
    return null
  }
  if (kind === 'openai') {
    return {
      kind,
      baseUrl: process.env.OPENAI_BASE_URL?.trim() || OPENAI_DEFAULT_BASE_URL,
      apiKey: process.env.OPENAI_API_KEY?.trim() || '',
      models: {
        haiku: process.env.OPENAI_DEFAULT_HAIKU_MODEL?.trim() || '',
        sonnet: process.env.OPENAI_DEFAULT_SONNET_MODEL?.trim() || '',
        opus: process.env.OPENAI_DEFAULT_OPUS_MODEL?.trim() || '',
      },
    }
  }
  return {
    kind,
    baseUrl: process.env.GEMINI_BASE_URL?.trim() || GEMINI_DEFAULT_BASE_URL,
    apiKey: process.env.GEMINI_API_KEY?.trim() || '',
    models: {
      haiku: process.env.GEMINI_DEFAULT_HAIKU_MODEL?.trim() || '',
      sonnet: process.env.GEMINI_DEFAULT_SONNET_MODEL?.trim() || '',
      opus: process.env.GEMINI_DEFAULT_OPUS_MODEL?.trim() || '',
    },
  }
}

/**
 * Maps a Claude model id onto the provider's model for the same tier. Claude
 * Code picks models by Anthropic name (e.g. claude-*-haiku), so the adapter
 * swaps in, in priority order: the provider-wide override (OPENAI_MODEL /
 * GEMINI_MODEL), the tier model from settings, then the built-in tier default.
 */
export function resolveProviderModel(requested: string, config: ProviderConfig): string {
  const override = (config.kind === 'openai' ? process.env.OPENAI_MODEL : process.env.GEMINI_MODEL)?.trim()
  if (override) return override
  const lower = requested.toLowerCase()
  const tier: ProviderModelTier = lower.includes('haiku') ? 'haiku' : lower.includes('opus') ? 'opus' : 'sonnet'
  return config.models[tier] || PROVIDER_DEFAULT_MODELS[config.kind][tier]
}

export function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '')
}
