import type { RateLimitTier, SubscriptionType } from '../../services/oauth/types.js'

export type SecureStorageUpdateResult = {
  success: boolean
  warning?: string
}

export type McpOAuthStorageEntry = {
  serverName: string
  serverUrl: string
  accessToken: string
  expiresAt: number
  refreshToken?: string
  scope?: string
  clientId?: string
  clientSecret?: string
  stepUpScope?: string
  discoveryState?: {
    authorizationServerUrl: string
    resourceMetadataUrl?: string
    // Legacy entries persisted the full metadata blobs before they were stripped (#30337).
    resourceMetadata?: unknown
    authorizationServerMetadata?: unknown
  }
  [key: string]: unknown
}

export type McpOAuthClientConfigEntry = {
  clientSecret?: string
  [key: string]: unknown
}

export type McpXaaIdpEntry = {
  idToken: string
  expiresAt: number
  [key: string]: unknown
}

export type McpXaaIdpConfigEntry = {
  clientSecret?: string
  [key: string]: unknown
}

/**
 * The only writer is `saveOAuthTokensIfNeeded`, which always persists all six
 * fields, so they are required here; `null` (not absence) marks unknown values
 * such as the subscription type of an externally-injected token.
 */
export type ClaudeAiOAuthStorageEntry = {
  accessToken: string
  refreshToken: string | null
  expiresAt: number | null
  scopes: string[]
  subscriptionType: SubscriptionType | null
  rateLimitTier: RateLimitTier | null
  [key: string]: unknown
}

export type SecureStorageData = {
  claudeAiOauth?: ClaudeAiOAuthStorageEntry
  pluginSecrets?: Record<string, Record<string, string>>
  mcpOAuth?: Record<string, McpOAuthStorageEntry>
  mcpOAuthClientConfig?: Record<string, McpOAuthClientConfigEntry>
  mcpXaaIdp?: Record<string, McpXaaIdpEntry>
  mcpXaaIdpConfig?: Record<string, McpXaaIdpConfigEntry>
  trustedDeviceToken?: string
  [key: string]: unknown
}

export interface SecureStorage {
  name: string
  read(): SecureStorageData | null
  readAsync(): Promise<SecureStorageData | null>
  update(data: SecureStorageData): SecureStorageUpdateResult
  delete(): boolean
}
