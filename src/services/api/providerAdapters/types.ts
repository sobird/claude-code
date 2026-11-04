export type ProviderKind = 'anthropic' | 'openai' | 'gemini'

/** Providers that need request/response translation (everything but Anthropic). */
export type ActiveProviderKind = Exclude<ProviderKind, 'anthropic'>

export type ProviderModelTier = 'haiku' | 'sonnet' | 'opus'

export type ProviderConfig = {
  kind: ActiveProviderKind
  baseUrl: string
  apiKey: string
  models: Record<ProviderModelTier, string>
}

export type JsonObject = Record<string, unknown>

export type AnthropicStreamEvent = JsonObject & { type: string }
