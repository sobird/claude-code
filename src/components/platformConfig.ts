const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

export type PlatformKind = 'anthropic' | 'openai' | 'gemini'

export type PlatformFormValues = {
  baseUrl: string
  apiKey: string
  haikuModel: string
  sonnetModel: string
  opusModel: string
}

export type PlatformDefinition = {
  title: string
  requiresBaseUrl: boolean
  baseUrlPlaceholder: string
  env: {
    baseUrl: string
    apiKey: string
    haikuModel: string
    sonnetModel: string
    opusModel: string
  }
}

export const PLATFORM_DEFINITIONS: Record<PlatformKind, PlatformDefinition> = {
  anthropic: {
    title: 'Anthropic Compatible Setup',
    requiresBaseUrl: true,
    baseUrlPlaceholder: 'https://api.example.com',
    env: {
      baseUrl: 'ANTHROPIC_BASE_URL',
      apiKey: 'ANTHROPIC_AUTH_TOKEN',
      haikuModel: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      sonnetModel: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
      opusModel: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
    },
  },
  openai: {
    title: 'OpenAI Compatible Setup',
    requiresBaseUrl: false,
    baseUrlPlaceholder: OPENAI_DEFAULT_BASE_URL,
    env: {
      baseUrl: 'OPENAI_BASE_URL',
      apiKey: 'OPENAI_API_KEY',
      haikuModel: 'OPENAI_DEFAULT_HAIKU_MODEL',
      sonnetModel: 'OPENAI_DEFAULT_SONNET_MODEL',
      opusModel: 'OPENAI_DEFAULT_OPUS_MODEL',
    },
  },
  gemini: {
    title: 'Gemini API Setup',
    requiresBaseUrl: false,
    baseUrlPlaceholder: GEMINI_DEFAULT_BASE_URL,
    env: {
      baseUrl: 'GEMINI_BASE_URL',
      apiKey: 'GEMINI_API_KEY',
      haikuModel: 'GEMINI_DEFAULT_HAIKU_MODEL',
      sonnetModel: 'GEMINI_DEFAULT_SONNET_MODEL',
      opusModel: 'GEMINI_DEFAULT_OPUS_MODEL',
    },
  },
}

export function readPlatformFromEnv(platform: PlatformKind): PlatformFormValues {
  const env = PLATFORM_DEFINITIONS[platform].env
  return {
    baseUrl: process.env[env.baseUrl] ?? '',
    apiKey: process.env[env.apiKey] ?? '',
    haikuModel: process.env[env.haikuModel] ?? '',
    sonnetModel: process.env[env.sonnetModel] ?? '',
    opusModel: process.env[env.opusModel] ?? '',
  }
}

/** Returns a user-facing validation message, or null when the values are valid. */
export function validatePlatformValues(platform: PlatformKind, values: PlatformFormValues): string | null {
  const baseUrl = values.baseUrl.trim()
  if (!baseUrl) {
    return PLATFORM_DEFINITIONS[platform].requiresBaseUrl
      ? 'Base URL is required. Enter a full URL including protocol (e.g., https://api.example.com).'
      : null
  }
  try {
    // oxlint-disable-next-line no-new
    new URL(baseUrl)
  } catch {
    return 'Invalid base URL: enter a full URL including protocol (e.g., https://api.example.com).'
  }
  return null
}

/** Env vars persisted to user settings; empty fields are left untouched. */
export function buildPlatformEnv(platform: PlatformKind, values: PlatformFormValues): Record<string, string> {
  const env = PLATFORM_DEFINITIONS[platform].env
  const entries: [string, string][] = [
    [env.baseUrl, values.baseUrl.trim()],
    [env.apiKey, values.apiKey.trim()],
    [env.haikuModel, values.haikuModel.trim()],
    [env.sonnetModel, values.sonnetModel.trim()],
    [env.opusModel, values.opusModel.trim()],
  ]
  const result: Record<string, string> = { CLAUDE_CODE_API_PROVIDER: platform }
  for (const [key, value] of entries) {
    if (value) result[key] = value
  }
  return result
}
