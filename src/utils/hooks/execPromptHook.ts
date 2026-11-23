import { randomUUID } from 'node:crypto'

import type { HookEvent } from 'src/entrypoints/agentSdkTypes.js'

import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { queryModelWithoutStreaming } from '../../services/api/claude.js'
import { roughTokenCountEstimationForMessage } from '../../services/tokenEstimation.js'
import type { ToolUseContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import { createAttachmentMessage } from '../attachments.js'
import { createCombinedAbortSignal } from '../combinedAbortSignal.js'
import { has1mContext, MODEL_CONTEXT_WINDOW_DEFAULT } from '../context.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import type { HookResult } from '../hooks.js'
import { safeParseJSON } from '../json.js'
import { createUserMessage, extractTextContent } from '../messages.js'
import { getSmallFastModel } from '../model/model.js'
import type { PromptHook } from '../settings/types.js'
import { jsonStringify } from '../slowOperations.js'
import { asSystemPrompt } from '../systemPromptType.js'
import { tokenCountFromLastAPIResponse } from '../tokens.js'
import { addArgumentsToPrompt, hookResponseSchema } from './hookHelpers.js'

/** Fraction of the evaluator's context window we allow the Stop transcript to fill. */
const STOP_HOOK_TRUNCATION_FRACTION = 0.7

/**
 * Split a transcript into turns at assistant-message boundaries: a fresh
 * assistant message id starts a new turn (when the current one is non-empty),
 * while everything else (tool results, attachments, progress) stays with the
 * turn it follows. Truncation then drops whole turns instead of cutting one
 * mid-stream.
 */
function groupMessagesByTurn(messages: Message[]): Message[][] {
  const turns: Message[][] = []
  let current: Message[] = []
  let lastAssistantId: string | undefined
  for (const message of messages) {
    if (message.type === 'assistant' && message.message.id !== lastAssistantId && current.length > 0) {
      turns.push(current)
      current = [message]
    } else {
      current.push(message)
    }
    if (message.type === 'assistant') {
      lastAssistantId = message.message.id
    }
  }
  if (current.length > 0) {
    turns.push(current)
  }
  return turns
}

function estimateTurnTokens(turn: Message[]): number {
  let total = 0
  for (const message of turn) {
    total +=
      message.type === 'assistant' || message.type === 'user'
        ? roughTokenCountEstimationForMessage(message)
        : jsonStringify(message).length / 4
  }
  return Math.ceil(total)
}

/**
 * Keep the most recent whole turns that fit the Stop-hook evaluator's context
 * budget, prepending a notice when older turns are dropped (2.1.100 #21/#87).
 * Long sessions otherwise overflow the evaluator's window and the hook errors
 * out instead of judging the transcript.
 */
function truncateStopHookTranscript(messages: Message[], model: string): Message[] {
  const contextWindow = has1mContext(model) ? 1_000_000 : MODEL_CONTEXT_WINDOW_DEFAULT
  const budget = Math.floor(contextWindow * STOP_HOOK_TRUNCATION_FRACTION)
  if (tokenCountFromLastAPIResponse(messages) <= budget) {
    return messages
  }

  const turns = groupMessagesByTurn(messages)
  let keptTokens = 0
  let startIndex = turns.length
  for (let i = turns.length - 1; i >= 0; i--) {
    const turnTokens = estimateTurnTokens(turns[i])
    // Always keep at least the most recent turn, even if it alone exceeds the
    // budget; older turns are dropped once adding them would overflow.
    if (startIndex < turns.length && keptTokens + turnTokens > budget) {
      break
    }
    keptTokens += turnTokens
    startIndex = i
  }

  const kept = turns.slice(startIndex).flat()
  const dropped = messages.length - kept.length
  if (dropped <= 0) {
    return messages
  }

  logForDebugging(
    `Hooks: truncated Stop transcript ${messages.length}→${kept.length} msgs (budget ${budget}, model ${model})`,
  )
  logEvent('tengu_hook_prompt_transcript_truncated', {
    droppedMessages: dropped,
    keptMessages: kept.length,
    budget,
    evaluatorModel: model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  return [
    createUserMessage({
      content: `[Earlier conversation truncated to fit the hook evaluator's context window — ${dropped} earlier messages omitted. Evaluate the condition against the recent transcript below; if the required evidence may be in the omitted prefix, return {"ok": false, "reason": "insufficient evidence in transcript"}.]`,
    }),
    ...kept,
  ]
}

/**
 * Execute a prompt-based hook using an LLM
 */
export async function execPromptHook(
  hook: PromptHook,
  hookName: string,
  hookEvent: HookEvent,
  jsonInput: string,
  signal: AbortSignal,
  toolUseContext: ToolUseContext,
  messages?: Message[],
  toolUseID?: string,
): Promise<HookResult> {
  // Use provided toolUseID or generate a new one
  const effectiveToolUseID = toolUseID || `hook-${randomUUID()}`
  // Stop-class hooks judge the transcript after the fact; their default prompt
  // ("did the task finish?") is useless without pointing the model at it.
  const isStopHook = hookEvent === 'Stop' || hookEvent === 'SubagentStop'
  try {
    // Replace $ARGUMENTS with the JSON input
    const promptText = isStopHook
      ? `Based on the conversation transcript above, has the following stopping condition been satisfied? Answer based on transcript evidence only.\n\nCondition: ${hook.prompt}`
      : hook.prompt
    const processedPrompt = addArgumentsToPrompt(promptText, jsonInput)
    logForDebugging(`Hooks: Processing prompt hook with prompt: ${processedPrompt}`)

    // Create user message directly - no need for processUserInput which would
    // trigger UserPromptSubmit hooks and cause infinite recursion
    const userMessage = createUserMessage({ content: processedPrompt })
    const hookModel = hook.model ?? getSmallFastModel()

    // Prepend conversation history if provided. Long sessions are trimmed to
    // the evaluator's context budget so the Stop hook doesn't overflow the
    // small/fast model and error out (2.1.100 #21/#87).
    const messagesToQuery =
      messages && messages.length > 0
        ? [...truncateStopHookTranscript(messages, hookModel), userMessage]
        : [userMessage]

    logForDebugging(`Hooks: Querying model with ${messagesToQuery.length} messages`)

    // Query the model with Haiku
    const hookTimeoutMs = hook.timeout ? hook.timeout * 1000 : 30000

    // Combined signal: aborts if either the hook signal or timeout triggers
    const { signal: combinedSignal, cleanup: cleanupSignal } = createCombinedAbortSignal(signal, {
      timeoutMs: hookTimeoutMs,
    })

    try {
      const response = await queryModelWithoutStreaming({
        messages: messagesToQuery,
        systemPrompt: asSystemPrompt([
          isStopHook
            ? `You are evaluating a stop-condition hook in Claude Code. Read the conversation transcript carefully, then judge whether the user-provided condition is satisfied.

Your response must be a JSON object with one of these shapes:
- {"ok": true, "reason": "<quote evidence from the transcript that satisfies the condition>"}
- {"ok": false, "reason": "<quote what is missing or what blocks the condition>"}

Always include a "reason" field, quoting specific text from the transcript whenever possible. If the transcript does not contain clear evidence that the condition is satisfied, return {"ok": false, "reason": "insufficient evidence in transcript"}.`
            : `You are evaluating a hook condition in Claude Code. Judge whether the user-provided condition is met.

Your response must be a JSON object with one of these shapes:
- {"ok": true, "reason": "<reason the condition is met>"}
- {"ok": false, "reason": "<reason the condition is not met>"}

Always include a "reason" field.`,
        ]),
        thinkingConfig: { type: 'disabled' as const },
        tools: [],
        signal: combinedSignal,
        options: {
          async getToolPermissionContext() {
            const appState = toolUseContext.getAppState()
            return appState.toolPermissionContext
          },
          model: hookModel,
          toolChoice: undefined,
          isNonInteractiveSession: true,
          hasAppendSystemPrompt: false,
          agents: [],
          querySource: 'hook_prompt',
          mcpTools: [],
          agentId: toolUseContext.agentId,
          outputFormat: {
            type: 'json_schema',
            schema: {
              type: 'object',
              properties: {
                ok: { type: 'boolean' },
                reason: { type: 'string' },
              },
              required: ['ok', 'reason'],
              additionalProperties: false,
            },
          },
        },
      })

      cleanupSignal()

      // The evaluator itself can fail (e.g. context overflow) and come back as
      // an API-error message rather than a judgement. Surface it as a
      // non-blocking hook error with a recognizable message instead of feeding
      // the error text into JSON parsing (2.1.100 #21/#87).
      if (response.isApiErrorMessage) {
        const apiErrorText = extractTextContent(response.message.content).trim()
        logForDebugging(`Hooks: prompt-hook evaluator API error: ${apiErrorText}`, { level: 'error' })
        return {
          hook,
          outcome: 'non_blocking_error',
          message: createAttachmentMessage({
            type: 'hook_non_blocking_error',
            hookName,
            toolUseID: effectiveToolUseID,
            hookEvent,
            stderr: `Hook evaluator API error: ${apiErrorText}`,
            stdout: '',
            exitCode: 1,
          }),
        }
      }

      // Extract text content from response
      const content = extractTextContent(response.message.content)

      // Update response length for spinner display
      toolUseContext.setResponseLength((length) => length + content.length)

      const fullResponse = content.trim()
      logForDebugging(`Hooks: Model response: ${fullResponse}`)

      const json = safeParseJSON(fullResponse)
      if (!json) {
        logForDebugging(`Hooks: error parsing response as JSON: ${fullResponse}`)
        return {
          hook,
          outcome: 'non_blocking_error',
          message: createAttachmentMessage({
            type: 'hook_non_blocking_error',
            hookName,
            toolUseID: effectiveToolUseID,
            hookEvent,
            stderr: 'JSON validation failed',
            stdout: fullResponse,
            exitCode: 1,
          }),
        }
      }

      const parsed = hookResponseSchema().safeParse(json)
      if (!parsed.success) {
        logForDebugging(`Hooks: model response does not conform to expected schema: ${parsed.error.message}`)
        return {
          hook,
          outcome: 'non_blocking_error',
          message: createAttachmentMessage({
            type: 'hook_non_blocking_error',
            hookName,
            toolUseID: effectiveToolUseID,
            hookEvent,
            stderr: `Schema validation failed: ${parsed.error.message}`,
            stdout: fullResponse,
            exitCode: 1,
          }),
        }
      }

      // Failed to meet condition. Stop-class hooks report the miss as a
      // blocking error but must not set preventContinuation — the stop flow
      // decides whether to continue; non-Stop prompt hooks still do.
      if (!parsed.data.ok) {
        logForDebugging(`Hooks: Prompt hook condition was not met: ${parsed.data.reason}`)
        return {
          hook,
          outcome: 'blocking',
          blockingError: {
            blockingError: `[${hook.prompt}]: ${parsed.data.reason}`,
            command: hook.prompt,
          },
          preventContinuation: !isStopHook,
          stopReason: parsed.data.reason,
        }
      }

      // Condition was met
      logForDebugging(`Hooks: Prompt hook condition was met: ${parsed.data.reason}`)
      return {
        hook,
        outcome: 'success',
        message: createAttachmentMessage({
          type: 'hook_success',
          hookName,
          toolUseID: effectiveToolUseID,
          hookEvent,
          content: '',
        }),
      }
    } catch (error) {
      cleanupSignal()

      if (combinedSignal.aborted) {
        return {
          hook,
          outcome: 'cancelled',
        }
      }
      throw error
    }
  } catch (error) {
    const errorMsg = errorMessage(error)
    logForDebugging(`Hooks: Prompt hook error: ${errorMsg}`)
    return {
      hook,
      outcome: 'non_blocking_error',
      message: createAttachmentMessage({
        type: 'hook_non_blocking_error',
        hookName,
        toolUseID: effectiveToolUseID,
        hookEvent,
        stderr: `Error executing prompt hook: ${errorMsg}`,
        stdout: '',
        exitCode: 1,
      }),
    }
  }
}
