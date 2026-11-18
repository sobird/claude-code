import type { ConfigScope, MCPServerConnection } from '../../services/mcp/types.js'
import type { LoadedPlugin, PluginError } from '../../types/plugin.js'
import type { PersistablePluginScope } from '../../utils/plugins/pluginIdentifier.js'

type UnifiedInstalledItemBase = {
  id: string
  name: string
  description?: string
}

/** Successfully loaded plugin. */
type UnifiedPluginItem = UnifiedInstalledItemBase & {
  type: 'plugin'
  marketplace: string
  scope: PersistablePluginScope | 'builtin'
  isEnabled: boolean
  errorCount: number
  errors: PluginError[]
  plugin: LoadedPlugin
  pendingEnable?: boolean
  pendingUpdate?: boolean
  pendingToggle?: 'will-enable' | 'will-disable'
}

/** Plugin that failed to load and only exists as errors. */
type UnifiedFailedPluginItem = UnifiedInstalledItemBase & {
  type: 'failed-plugin'
  marketplace: string
  scope: PersistablePluginScope
  errorCount: number
  errors: PluginError[]
}

/** Plugin flagged as removed/delisted from its marketplace. */
type UnifiedFlaggedPluginItem = UnifiedInstalledItemBase & {
  type: 'flagged-plugin'
  marketplace: string
  scope: 'flagged'
  reason: string
  text: string
  flaggedAt: string
}

/** MCP server, either standalone or nested under a plugin. */
type UnifiedMcpItem = UnifiedInstalledItemBase & {
  type: 'mcp'
  scope: ConfigScope
  status: 'connected' | 'disabled' | 'pending' | 'needs-auth' | 'failed'
  client: MCPServerConnection
  indented?: boolean
}

export type UnifiedInstalledItem =
  | UnifiedPluginItem
  | UnifiedFailedPluginItem
  | UnifiedFlaggedPluginItem
  | UnifiedMcpItem
