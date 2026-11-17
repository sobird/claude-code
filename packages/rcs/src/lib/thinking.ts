/**
 * Thinking-mode switching over the CLI's `set_max_thinking_tokens` control
 * request.
 *
 * Semantics follow the print/SDK bridge (the `remote-control` path):
 *   null → the CLI's own default (thinking enabled by default)
 *   0    → disabled
 *   >0   → enabled with a token budget, clamped by the CLI to the model's
 *          output limit (`src/services/api/claude.ts`).
 *
 * The interactive REPL bridge inverts the null check (`enabled = max !== null`),
 * so `off` behaves like `on` there; the README calls this out.
 */

/** Explicit budget sent for "on"; the CLI clamps it per model. */
export const THINKING_ON_BUDGET = 31999

export type ThinkingChoice = 'default' | 'on' | 'off'

/** Value accepted by the CLI for a choice; `null` means "use the default". */
export function thinkingTokensFor(choice: ThinkingChoice): number | null {
  if (choice === 'on') return THINKING_ON_BUDGET
  if (choice === 'off') return 0
  return null
}

/** Recent confirmed state; `null` is the default/unknown state. */
export type ThinkingState = 'on' | 'off' | null

/** Normalize an echoed `max_thinking_tokens` value. */
export function thinkingChoiceFromPayload(value: unknown): ThinkingState {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value > 0) return 'on'
  if (value === 0) return 'off'
  return null
}

/** Envelope for the control channel. */
export function buildSetThinkingRequest(requestId: string, choice: ThinkingChoice): Record<string, unknown> {
  return {
    type: 'control_request',
    request_id: requestId,
    request: { subtype: 'set_max_thinking_tokens', max_thinking_tokens: thinkingTokensFor(choice) },
  }
}
