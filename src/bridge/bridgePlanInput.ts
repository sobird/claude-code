import { EXIT_PLAN_MODE_V2_TOOL_NAME } from '../tools/ExitPlanModeTool/constants.js'

/**
 * The plan text lives on disk, so an ExitPlanMode permission request only
 * carries `allowedPrompts`; remote clients (the web UI) cannot render the plan
 * body. Add it to the *forwarded* input for display only.
 *
 * Callers must keep the original input for the actual permission resolution:
 * ExitPlanMode treats any `input.plan` as a user edit and would rewrite the
 * plan file / echo it back in the tool result.
 */
export function augmentBridgePermissionInput(
  toolName: string,
  input: Record<string, unknown>,
  plan: string | null,
): Record<string, unknown> {
  if (toolName !== EXIT_PLAN_MODE_V2_TOOL_NAME) return input
  if (!plan || plan.trim() === '') return input
  return { ...input, plan }
}
