/**
 * Agent definitions available in coordinator mode.
 *
 * When CLAUDE_CODE_COORDINATOR_MODE is on, the coordinator orchestrates
 * long-running "worker" agents instead of the default built-in set (see
 * getCoordinatorUserContext / getCoordinatorSystemPrompt in coordinatorMode.ts).
 * Workers get the async-agent tool pool minus the tools the coordinator keeps
 * for itself — the same subset the coordinator's system prompt advertises.
 */

import { ASYNC_AGENT_ALLOWED_TOOLS } from '../constants/tools.js'
import type { AgentDefinition, BuiltInAgentDefinition } from '../tools/AgentTool/loadAgentsDir.js'
import { SYNTHETIC_OUTPUT_TOOL_NAME } from '../tools/SyntheticOutputTool/SyntheticOutputTool.js'

/**
 * Tools that stay with the coordinator. Mirrors INTERNAL_WORKER_TOOLS in
 * coordinatorMode.ts; only SyntheticOutput is part of the async-agent pool.
 */
const COORDINATOR_ONLY_TOOLS = new Set([SYNTHETIC_OUTPUT_TOOL_NAME])

const WORKER_SYSTEM_PROMPT = `You are a worker agent spawned by a coordinator in Claude Code. Execute the task you are given directly and autonomously — do not ask the coordinator or the user questions.

Rules:
- Do not spawn sub-agents; you are the worker, so do the work yourself.
- Stay within the scope of your directive; mention related systems outside it in at most one sentence.
- If you modify files, run the relevant tests and commit your changes, then include the commit hash in your report.
- Report back once, concisely: what you did, the files you changed, and anything the coordinator should know. Do not narrate intermediate steps.`

/** The coordinator's worker agent: all async-agent tools except internal ones. */
const WORKER_AGENT: BuiltInAgentDefinition = {
  agentType: 'worker',
  whenToUse:
    'Delegate a self-contained research, implementation, or verification task to a worker. Workers run autonomously in the background and report their result back to the coordinator.',
  tools: [...ASYNC_AGENT_ALLOWED_TOOLS].filter((tool) => !COORDINATOR_ONLY_TOOLS.has(tool)),
  source: 'built-in',
  baseDir: 'built-in',
  getSystemPrompt: () => WORKER_SYSTEM_PROMPT,
}

export function getCoordinatorAgents(): AgentDefinition[] {
  return [WORKER_AGENT]
}
