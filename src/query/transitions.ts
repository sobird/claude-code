/**
 * Why `queryLoop` stopped: returned from the generator and threaded up through
 * `query()`. Discriminated by `reason` so callers and tests can assert which
 * exit path fired without inspecting message contents.
 */
export type Terminal =
  | { reason: 'rapid_refill_breaker' }
  | { reason: 'blocking_limit' }
  | { reason: 'image_error' }
  | { reason: 'model_error'; error: unknown }
  | { reason: 'aborted_streaming' }
  | { reason: 'prompt_too_long' }
  | { reason: 'completed' }
  | { reason: 'stop_hook_prevented' }
  | { reason: 'aborted_tools' }
  | { reason: 'tool_deferred' }
  | { reason: 'hook_stopped' }
  | { reason: 'max_turns'; turnCount: number }

/**
 * Why the previous loop iteration continued. Carried on `State.transition`;
 * undefined on the first iteration. Lets recovery paths be asserted without
 * inspecting message contents.
 */
export type Continue =
  | { reason: 'collapse_drain_retry'; committed: number }
  | { reason: 'reactive_compact_retry' }
  | { reason: 'max_output_tokens_escalate' }
  | { reason: 'max_output_tokens_recovery'; attempt: number }
  | { reason: 'stop_hook_blocking' }
  | { reason: 'token_budget_continuation' }
  | { reason: 'next_turn' }
