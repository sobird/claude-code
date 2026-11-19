/**
 * /fork — hand the current conversation to a background worker.
 *
 * Available when the fork-subagent experiment is on (see
 * tools/AgentTool/forkSubagent.ts). The worker inherits this conversation
 * (forkContextMessages) and the parent's exact system prompt and tool pool
 * (useExactTools) so its API request prefix is cache-identical, then runs the
 * given directive autonomously and reports back through a task notification.
 *
 * The launch sequence mirrors resumeAgent.ts: register the async task first,
 * then drive runAgent through runAsyncAgentLifecycle inside runWithAgentContext.
 */

import { getSystemPrompt } from '../../constants/prompts.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import { registerAsyncAgent } from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import { runAsyncAgentLifecycle } from '../../tools/AgentTool/agentToolUtils.js'
import { buildChildMessage, FORK_AGENT, isForkSubagentEnabled } from '../../tools/AgentTool/forkSubagent.js'
import { isBuiltInAgent } from '../../tools/AgentTool/loadAgentsDir.js'
import { runAgent } from '../../tools/AgentTool/runAgent.js'
import type { LocalJSXCommandCall, LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js'
import { asAgentId } from '../../types/ids.js'
import type { Message } from '../../types/message.js'
import { runWithAgentContext } from '../../utils/agentContext.js'
import { getLastCacheSafeParams } from '../../utils/forkedAgent.js'
import { createUserMessage } from '../../utils/messages.js'
import { getAgentModel } from '../../utils/model/agent.js'
import { getQuerySourceForAgent } from '../../utils/promptCategory.js'
import { buildEffectiveSystemPrompt } from '../../utils/systemPrompt.js'
import type { SystemPrompt } from '../../utils/systemPromptType.js'
import { getParentSessionId } from '../../utils/teammate.js'
import { createAgentId } from '../../utils/uuid.js'

const USAGE = 'Usage: /fork <directive>'
const NO_PERMISSION_HANDLER = 'Fork needs a permission handler, which this session does not provide.'
const UNAVAILABLE = 'Fork is not available in this session.'
const DESCRIPTION_MAX = 60

/** Trims the directive and returns null when the user gave none. */
export function parseForkDirective(args: string): string | null {
  const directive = args.trim()
  return directive.length > 0 ? directive : null
}

/** Short, single-line description for the task list. */
export function forkDescription(directive: string): string {
  if (directive.length <= DESCRIPTION_MAX) return directive
  return `${directive.slice(0, DESCRIPTION_MAX - 1)}…`
}

export function formatForkStarted(agentId: string, description: string): string {
  return `Forked worker ${agentId} started in the background — ${description}`
}

/** The worker's first message: fork boilerplate plus the user's directive. */
export function buildForkPromptMessages(directive: string): Message[] {
  return [createUserMessage({ content: [{ type: 'text' as const, text: buildChildMessage(directive) }] })]
}

/**
 * The parent system prompt the worker should reuse. Prefer the bytes the parent
 * actually sent (getLastCacheSafeParams → renderedSystemPrompt) so the fork's
 * prefix matches; only rebuild when neither is available.
 */
async function resolveForkSystemPrompt(context: LocalJSXCommandContext): Promise<SystemPrompt> {
  const saved = getLastCacheSafeParams()
  if (saved) return saved.systemPrompt
  if (context.renderedSystemPrompt) return context.renderedSystemPrompt

  const appState = context.getAppState()
  const mainThreadAgentDefinition = appState.agent
    ? appState.agentDefinitions.activeAgents.find((agent) => agent.agentType === appState.agent)
    : undefined
  const additionalWorkingDirectories = Array.from(appState.toolPermissionContext.additionalWorkingDirectories.keys())
  const defaultSystemPrompt = await getSystemPrompt(
    context.options.tools,
    context.options.mainLoopModel,
    additionalWorkingDirectories,
  )
  return buildEffectiveSystemPrompt({
    mainThreadAgentDefinition,
    toolUseContext: context,
    customSystemPrompt: context.options.customSystemPrompt,
    defaultSystemPrompt,
    appendSystemPrompt: context.options.appendSystemPrompt,
  })
}

/** Registers the async task and starts the worker; resolves to the new agent ID. */
async function startForkWorker(
  context: LocalJSXCommandContext,
  directive: string,
  canUseTool: CanUseToolFn,
): Promise<string> {
  const appState = context.getAppState()
  const rootSetAppState = context.setAppStateForTasks ?? context.setAppState
  const permissionMode = appState.toolPermissionContext.mode
  const systemPrompt = await resolveForkSystemPrompt(context)

  const agentId = createAgentId()
  const description = forkDescription(directive)
  const startTime = Date.now()
  const resolvedAgentModel = getAgentModel(FORK_AGENT.model, context.options.mainLoopModel, undefined, permissionMode)

  const task = registerAsyncAgent({
    agentId,
    description,
    prompt: directive,
    selectedAgent: FORK_AGENT,
    setAppState: rootSetAppState,
    toolUseId: context.toolUseId,
  })

  const metadata = {
    prompt: directive,
    resolvedAgentModel,
    isBuiltInAgent: isBuiltInAgent(FORK_AGENT),
    startTime,
    agentType: FORK_AGENT.agentType,
    isAsync: true,
  }

  const asyncAgentContext = {
    agentId,
    parentSessionId: getParentSessionId(),
    agentType: 'subagent' as const,
    subagentName: FORK_AGENT.agentType,
    isBuiltIn: isBuiltInAgent(FORK_AGENT),
    invocationKind: 'spawn' as const,
    invocationEmitted: false,
  }

  void runWithAgentContext(asyncAgentContext, () =>
    runAsyncAgentLifecycle({
      taskId: task.agentId,
      abortController: task.abortController!,
      makeStream: (onCacheSafeParams) =>
        runAgent({
          agentDefinition: FORK_AGENT,
          promptMessages: buildForkPromptMessages(directive),
          toolUseContext: context,
          canUseTool,
          isAsync: true,
          querySource: context.options.querySource ?? getQuerySourceForAgent(FORK_AGENT.agentType, true),
          model: undefined,
          override: {
            systemPrompt,
            agentId: asAgentId(task.agentId),
            abortController: task.abortController!,
          },
          availableTools: context.options.tools,
          forkContextMessages: context.messages,
          useExactTools: true,
          description,
          onCacheSafeParams,
        }),
      metadata,
      description,
      toolUseContext: context,
      rootSetAppState,
      agentIdForCleanup: agentId,
      enableSummarization: isForkSubagentEnabled(),
      getWorktreeResult: async () => ({}),
    }),
  )

  return agentId
}

export const call: LocalJSXCommandCall = async (onDone: LocalJSXCommandOnDone, context, args) => {
  const directive = parseForkDirective(args)
  if (!directive) {
    onDone(USAGE, { display: 'system' })
    return null
  }
  const canUseTool = context.canUseTool
  if (!canUseTool) {
    onDone(NO_PERMISSION_HANDLER, { display: 'system' })
    return null
  }
  if (!isForkSubagentEnabled()) {
    onDone(UNAVAILABLE, { display: 'system' })
    return null
  }

  const agentId = await startForkWorker(context, directive, canUseTool)
  onDone(formatForkStarted(agentId, forkDescription(directive)), { display: 'system' })
  return null
}
