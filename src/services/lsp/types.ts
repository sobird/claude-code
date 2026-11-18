import type { z } from 'zod/v4'

import type { LspServerConfigSchema } from '../../utils/plugins/schemas.js'
import type { ConfigScope } from '../mcp/types.js'

/** Plugin-declared LSP server configuration (see `LspServerConfigSchema`). */
export type LspServerConfig = z.infer<ReturnType<typeof LspServerConfigSchema>>

/** LSP server config after plugin scoping adds `scope` and `source`. */
export type ScopedLspServerConfig = LspServerConfig & {
  scope: ConfigScope
  source: string
}

/** Lifecycle state of a single LSP server instance. */
export type LspServerState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error'
