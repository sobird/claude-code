// Progress data types for tool execution monitoring and UI feedback

/**
 * Common base interface for all progress types
 */
interface BaseProgress {
  type: string
}

/**
 * Hook event types (common hook events)
 */
export type HookEvent =
  | 'pre_command'
  | 'post_command'
  | 'pre_tool_use'
  | 'post_tool_use'
  | 'pre_file_write'
  | 'post_file_write'
  | 'pre_bash'
  | 'post_bash';

/**
 * Bash command execution progress
 */
export interface BashProgress extends BaseProgress {
  type: 'bash_progress'
  output: string
  fullOutput: string
  elapsedTimeSeconds: number
  totalLines: number
  totalBytes?: number
  taskId?: string
  timeoutMs?: number
}

/**
 * PowerShell command execution progress
 */
export interface PowerShellProgress extends BaseProgress {
  type: 'powershell_progress'
  output: string
  fullOutput: string
  elapsedTimeSeconds: number
  totalLines: number
  totalBytes: number
}

/**
 * MCP (Model Context Protocol) tool execution progress
 */
export interface MCPProgress extends BaseProgress {
  type: 'mcp_progress'
  status: 'started' | 'progress' | 'completed' | 'failed'
  serverName: string
  toolName: string
  elapsedTimeMs?: number
  progress?: number
  total?: number
}

/**
 * Skill tool execution progress
 */
export interface SkillToolProgress extends BaseProgress {
  type: 'skill_progress'
  prompt: string
  agentId?: string
}

/**
 * Agent tool execution progress
 */
export interface AgentToolProgress extends BaseProgress {
  type: 'agent_progress'
  message?: object
  prompt: string
  agentId?: string
}

/**
 * Hook execution progress
 */
export interface HookProgress extends BaseProgress {
  type: 'hook_progress'
  hookEvent: HookEvent
  hookName: string
  command: string
  promptText?: string
  statusMessage?: string
  stdout?: string
  stderr?: string
}

/**
 * Web search progress
 */
export interface WebSearchProgress extends BaseProgress {
  type: 'web_search_progress'
  query: string
  resultsCount?: number
  currentPage?: number
  totalPages?: number
}

/**
 * REPL tool execution progress
 */
export interface REPLToolProgress extends BaseProgress {
  type: 'repl_progress'
  sessionId: string
  prompt: string
  input?: string
  output?: string
  history?: Array<{ input: string; output: string }>
}

/**
 * Task output progress
 */
export interface TaskOutputProgress extends BaseProgress {
  type: 'task_output_progress'
  taskId: string
  description: string
  usage?: {
    total_tokens: number
  }
}

/**
 * SDK workflow progress
 */
export interface SdkWorkflowProgress extends BaseProgress {
  type: 'sdk_workflow_progress'
  workflowType: string
  step: number
  totalSteps: number
  currentStepDescription: string
}

/**
 * Union type of all possible progress data types
 */
export type ToolProgressData =
  | BashProgress
  | PowerShellProgress
  | MCPProgress
  | REPLToolProgress
  | SkillToolProgress
  | AgentToolProgress
  | HookProgress
  | WebSearchProgress
  | TaskOutputProgress
  | SdkWorkflowProgress
