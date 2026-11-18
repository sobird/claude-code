import type { LocalJSXCommandOnDone } from '../../types/command.js'

/**
 * Parent `/plugin` view state. Child screens own their own private views
 * (e.g. ManagePlugins' `mcp-detail`) and signal navigation upward by calling
 * `setViewState` with one of these. Each child reads only the fields it cares
 * about; hence the optional `target*` fields.
 */
export type ViewState =
  | { type: 'menu' }
  | { type: 'help' }
  | { type: 'validate'; path?: string }
  | { type: 'browse-marketplace'; targetMarketplace?: string; targetPlugin?: string }
  | { type: 'discover-plugins'; targetPlugin?: string }
  | {
      type: 'manage-plugins'
      targetPlugin?: string
      targetMarketplace?: string
      action?: 'enable' | 'disable' | 'uninstall'
    }
  | { type: 'manage-marketplaces'; targetMarketplace?: string; action?: 'update' | 'remove' }
  | { type: 'marketplace-list' }
  | { type: 'add-marketplace'; initialValue?: string }
  | { type: 'marketplace-menu' }

export type PluginSettingsProps = {
  onComplete: LocalJSXCommandOnDone
  args?: string
  showMcpRedirectMessage?: boolean
}
