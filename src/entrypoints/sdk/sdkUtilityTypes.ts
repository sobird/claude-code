import type { BetaUsage as Usage } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

/**
 * `Usage` with every nullable field narrowed away — the shape accumulated by
 * `updateUsage`/`accumulateUsage` once `EMPTY_USAGE` fills in defaults.
 */
export type NonNullableUsage = {
  [K in keyof Usage]-?: NonNullable<Usage[K]>
}
