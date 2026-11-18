import type {
  ConfigScope,
  MCPServerConnection,
  McpClaudeAIProxyServerConfig,
  McpHTTPServerConfig,
  McpSSEServerConfig,
  McpStdioServerConfig,
} from '../../services/mcp/types.js'

type ServerInfoBase = {
  name: string
  client: MCPServerConnection
  scope: ConfigScope
}

export type StdioServerInfo = ServerInfoBase & {
  transport: 'stdio'
  config: McpStdioServerConfig
}

export type SSEServerInfo = ServerInfoBase & {
  transport: 'sse'
  config: McpSSEServerConfig
  isAuthenticated: boolean | undefined
}

export type HTTPServerInfo = ServerInfoBase & {
  transport: 'http'
  config: McpHTTPServerConfig
  isAuthenticated: boolean | undefined
}

export type ClaudeAIServerInfo = ServerInfoBase & {
  transport: 'claudeai-proxy'
  config: McpClaudeAIProxyServerConfig
  isAuthenticated: boolean | undefined
}

export type ServerInfo = StdioServerInfo | SSEServerInfo | HTTPServerInfo | ClaudeAIServerInfo

// Agent-frontmatter MCP servers are display-only: the config is flattened
// because only one transport's fields apply, and callers read `url`/`command`
// without narrowing on `transport`.
export type AgentMcpServerInfo = {
  name: string
  sourceAgents: string[]
  transport: 'stdio' | 'sse' | 'http' | 'ws'
  command?: string
  url?: string
  needsAuth: boolean
  isAuthenticated?: boolean
}

export type MCPViewState =
  | { type: 'list'; defaultTab?: string }
  | { type: 'server-menu'; server: ServerInfo }
  | { type: 'server-tools'; server: ServerInfo }
  | { type: 'server-tool-detail'; server: ServerInfo; toolIndex: number }
  | { type: 'agent-server-menu'; agentServer: AgentMcpServerInfo }
