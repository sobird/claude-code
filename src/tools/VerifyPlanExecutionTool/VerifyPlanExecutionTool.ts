/**
 * VerifyPlanExecution — check whether an approved plan was actually carried out.
 *
 * Set up by exiting plan mode: AppState carries `pendingPlanVerification`
 * ({plan, verificationStarted, verificationCompleted}) and this tool consumes
 * it. The check runs as a forked agent sharing the parent's prompt cache, with
 * only read-only tools allowed, so verification observes the repository instead
 * of mutating it. Its report is returned to the caller; the tool does not
 * decide pass/fail on the model's behalf.
 *
 * Approximation: upstream may schedule this automatically after plan
 * execution. Here the model (or a hook) must call it — an explicit call keeps
 * the cost and timing visible, and the AppState flags make double-runs cheap
 * to detect.
 */

import { z } from 'zod/v4'

import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { extractResultText, getLastCacheSafeParams, runForkedAgent } from '../../utils/forkedAgent.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { createUserMessage } from '../../utils/messages.js'
import { VERIFY_PLAN_EXECUTION_TOOL_NAME } from './constants.js'

const MAX_TURNS = 12

const inputSchema = lazySchema(() =>
  z.strictObject({
    plan: z
      .string()
      .optional()
      .describe('Plan text to verify. Defaults to the plan recorded when plan mode was exited.'),
    instructions: z.string().optional().describe('Extra focus for the verification, e.g. "pay attention to tests".'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    plan: z.string(),
    report: z.string(),
    completed: z.boolean(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

const readOnlyCanUseTool: CanUseToolFn = async (tool) => {
  if (tool.isReadOnly({})) return { behavior: 'allow' }
  return {
    behavior: 'deny',
    message: `Plan verification is read-only; ${tool.name} is not available.`,
    decisionReason: { type: 'other', reason: 'plan_verification_read_only' },
  }
}

export const VerifyPlanExecutionTool = buildTool({
  name: VERIFY_PLAN_EXECUTION_TOOL_NAME,
  searchHint: 'verify an approved plan was fully implemented',
  maxResultSizeChars: 50_000,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isEnabled() {
    // Loaded only when CLAUDE_CODE_VERIFY_PLAN=true (see tools.ts).
    return true
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.plan ? `VerifyPlanExecution ${input.plan.slice(0, 80)}` : 'VerifyPlanExecution'
  },
  renderToolUseMessage() {
    return 'Verify plan execution'
  },
  async description() {
    return 'Verify that an approved plan was fully implemented, using read-only inspection.'
  },
  async prompt() {
    return 'Verify that the plan the user approved has actually been implemented. Inspect the repository with read-only tools and report, step by step, what is done, what is missing, and what looks wrong. The plan defaults to the one recorded when plan mode was exited; pass "plan" to verify a different one. This tool never edits files — report findings instead of fixing them.'
  },
  async call(input, context) {
    const pending = context.getAppState().pendingPlanVerification
    const plan = input.plan?.trim() || pending?.plan?.trim()
    if (!plan) {
      throw new Error('No plan to verify. Exit plan mode first, or pass the plan explicitly.')
    }
    if (pending?.verificationCompleted && !input.plan) {
      return { data: { plan, report: 'This plan was already verified in this session.', completed: true } }
    }
    const cacheSafeParams = getLastCacheSafeParams()
    if (!cacheSafeParams) {
      throw new Error('Plan verification needs an active model session to share prompt cache parameters.')
    }

    context.setAppState((prev) => ({
      ...prev,
      pendingPlanVerification: { plan, verificationStarted: true, verificationCompleted: false },
    }))

    const prompt = `<plan-verification>
Verify whether the following plan has been fully implemented in the current repository.
Use read-only inspection. For each numbered item, state DONE, PARTIAL, or MISSING with one line of evidence (file:line or command output).
Finish with a short overall verdict.
${input.instructions ? `\nExtra focus: ${input.instructions}` : ''}

<plan>
${plan}
</plan>
</plan-verification>`

    let report: string
    try {
      const result = await runForkedAgent({
        promptMessages: [createUserMessage({ content: prompt })],
        cacheSafeParams,
        canUseTool: readOnlyCanUseTool,
        querySource: 'verification_agent',
        forkLabel: 'plan_verification',
        maxTurns: MAX_TURNS,
        skipCacheWrite: true,
      })
      report = extractResultText(result.messages, 'The verification agent produced no report.')
    } catch (e) {
      // Clear the "started" marker so the caller can retry.
      context.setAppState((prev) => ({
        ...prev,
        pendingPlanVerification: prev.pendingPlanVerification
          ? { ...prev.pendingPlanVerification, verificationStarted: false }
          : prev.pendingPlanVerification,
      }))
      throw e
    }

    context.setAppState((prev) => ({
      ...prev,
      pendingPlanVerification: prev.pendingPlanVerification
        ? { ...prev.pendingPlanVerification, verificationCompleted: true }
        : { plan, verificationStarted: true, verificationCompleted: true },
    }))
    return { data: { plan, report, completed: true } }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: `Plan verification report:\n\n${output.report}`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
