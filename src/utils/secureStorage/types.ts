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

export type ClaudeAiOAuthStorageEntry = {
  accessToken: string
  refreshToken?: string | null
  expiresAt?: number | null
  scopes?: string[]
  subscriptionType?: string | null
  rateLimitTier?: string | null
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
