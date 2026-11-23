import type { BetaUsage as Usage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

/**
 * `Usage` with every nullable field narrowed away — the shape accumulated by
 * `updateUsage`/`accumulateUsage` once `EMPTY_USAGE` fills in defaults.
 *
 * `fallback_credit` is kept nullable: its only neutral value is `null` (there
 * is no "not applied" arm for a request that never carried a token), and it
 * does not participate in the additive accumulation the other fields do.
 */
export type NonNullableUsage = Omit<{ [K in keyof Usage]-?: NonNullable<Usage[K]> }, 'fallback_credit'> & {
  fallback_credit: Usage['fallback_credit']
}
