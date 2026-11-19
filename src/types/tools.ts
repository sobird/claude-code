// Progress data types for tool execution monitoring and UI feedback

import type { HookProgress as CanonicalHookProgress } from './hooks.js'
import type { AssistantMessage, NormalizedAssistantMessage, NormalizedUserMessage } from './message.js'

export type { HookEvent } from '../entrypoints/agentSdkTypes.js'

/**
 * Common base interface for all progress types
 */
interface BaseProgress {
  type: string
}

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
  taskId?: string
  timeoutMs?: number
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
  /** Human-readable label for the current `progress` tick, when the server sends one. */
  progressMessage?: string
}

/**
 * Skill tool execution progress
 */
export interface SkillToolProgress extends BaseProgress {
  type: 'skill_progress'
  /** The normalized sub-agent message this tick is reporting. */
  message: NormalizedAssistantMessage | NormalizedUserMessage
  prompt: string
  agentId?: string
}

/**
 * Agent tool execution progress
 */
export interface AgentToolProgress extends BaseProgress {
  type: 'agent_progress'
  message: AssistantMessage | NormalizedUserMessage
  prompt: string
  agentId?: string
}

/**
 * Hook execution progress. The canonical shape lives in `types/hooks.ts`
 * (it is what `runHooks` actually yields), so alias it rather than
 * redeclaring a divergent copy.
 */
export type HookProgress = CanonicalHookProgress

/**
 * Web search progress. The tool emits a `query_update` tick once it knows the
 * query, then a `search_results_received` tick per completed search, so the
 * progress stream is a union rather than a single shape.
 */
export interface WebSearchQueryUpdateProgress extends BaseProgress {
  type: 'query_update'
  query: string
}

export interface WebSearchResultsReceivedProgress extends BaseProgress {
  type: 'search_results_received'
  query: string
  resultCount: number
}

export type WebSearchProgress =
  | (BaseProgress & {
      type: 'web_search_progress'
      query: string
      resultsCount?: number
      currentPage?: number
      totalPages?: number
    })
  | WebSearchQueryUpdateProgress
  | WebSearchResultsReceivedProgress

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
 * Progress tick for a single inner tool call made from inside the REPL. Emitted
 * while the REPL driver is about to run (phase `start`) or has finished one of
 * the sandbox calls, so the collapsed read/search group can show a live hint.
 */
export interface REPLToolCallProgress extends BaseProgress {
  type: 'repl_tool_call'
  phase: 'start' | 'end'
  toolName: string
  toolInput?: unknown
}

/**
 * Task output progress. Blocking `task_output` calls emit `waiting_for_task`
 * while the target task is still running, then report the task itself via the
 * regular progress shape once output is available.
 */
export interface TaskOutputWaitingProgress extends BaseProgress {
  type: 'waiting_for_task'
  taskDescription: string
  taskType: string
}

export type TaskOutputProgress =
  | (BaseProgress & {
      type: 'task_output_progress'
      taskId: string
      description: string
      usage?: {
        total_tokens: number
      }
    })
  | TaskOutputWaitingProgress

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
  | REPLToolCallProgress
  | SkillToolProgress
  | AgentToolProgress
  | HookProgress
  | WebSearchProgress
  | TaskOutputProgress
  | SdkWorkflowProgress
