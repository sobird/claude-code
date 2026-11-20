/**
 * Reactive compaction — recovery from a real API rejection instead of a
 * proactive token-count threshold.
 *
 * When the main query 413's (prompt-too-long) or a media-size error comes
 * back, the query loop withholds the error from callers and calls
 * `tryReactiveCompact`. That summarizes every API round except the most
 * recent one and keeps the tail intact so the turn can continue without
 * re-reading the whole conversation.
 *
 * Gating: `tengu_cobalt_raccoon` is the single GrowthBook switch. When it's
 * on, proactive autocompact is suppressed in shouldAutoCompact() and this
 * module becomes the context-management path ("reactive-only mode"); when
 * it's off, no reactive recovery happens and 413s surface to the caller.
 * The module itself is only loaded under feature('REACTIVE_COMPACT').
 *
 * PreCompact hooks are run by the callers (query.ts and /compact), not here:
 * /compact runs them concurrently with cache-param construction, and both
 * callers merge the hook's userDisplayMessage with the PostCompact one (which
 * compactConversation runs). `compactConversation` is therefore called with
 * `skipPreCompactHooks: true`.
 *
 * Two approximations relative to the upstream implementation:
 * - We reuse compactConversation() for the summarize call and re-assemble
 *   the preserved tail on top of its result, rather than duplicating the
 *   ~600-line summarize path. Consequence: deferred-tools deltas inside the
 *   result are computed as 'compact_full' against [], not 'reactive_compact'
 *   against the preserved tail (see utils/toolSearch.ts call-site contract).
 * - Media recovery strips media from the summarize set and retries once. If
 *   the oversized media lives in the preserved tail the next turn repeats
 *   the media error; query.ts's hasAttemptedReactiveCompact prevents a
 *   spiral and surfaces the error instead.
 */

import type { QuerySource } from '../../constants/querySource.js'
import { getUserContext } from '../../context.js'
import type { Message } from '../../types/message.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage, hasExactErrorMessage } from '../../utils/errors.js'
import type { CacheSafeParams } from '../../utils/forkedAgent.js'
import { executePreCompactHooks } from '../../utils/hooks.js'
import { getMessagesAfterCompactBoundary } from '../../utils/messages.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import { isMediaSizeError, isMediaSizeErrorMessage, isPromptTooLongMessage } from '../api/errors.js'
import { setLastSummarizedMessageId } from '../SessionMemory/sessionMemoryUtils.js'
import { isAutoCompactEnabled } from './autoCompact.js'
import {
  annotateBoundaryWithPreservedSegment,
  type CompactionResult,
  compactConversation,
  ERROR_MESSAGE_INCOMPLETE_RESPONSE,
  ERROR_MESSAGE_NOT_ENOUGH_MESSAGES,
  ERROR_MESSAGE_PROMPT_TOO_LONG,
  ERROR_MESSAGE_USER_ABORT,
  mergeHookInstructions,
  stripImagesFromMessages,
} from './compact.js'
import { suppressCompactWarning } from './compactWarningState.js'
import { groupMessagesByApiRound } from './grouping.js'
import { runPostCompactCleanup } from './postCompactCleanup.js'

/** A single API-round group is all there is — nothing to drop, nothing to keep. */
const MIN_API_ROUND_GROUPS = 2

export type ReactiveCompactFailure = 'too_few_groups' | 'aborted' | 'exhausted' | 'media_unstrippable' | 'error'

export type ReactiveCompactOutcome =
  | { ok: true; result: CompactionResult }
  | { ok: false; reason: ReactiveCompactFailure }

/** The experimental switch doubles as "reactive-only mode" for autocompact. */
export function isReactiveCompactEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_cobalt_raccoon', false)
}

/**
 * True when proactive autocompact is suppressed by the experiment and
 * /compact should route through the reactive path.
 */
export function isReactiveOnlyMode(): boolean {
  return isReactiveCompactEnabled()
}

/**
 * Withhold a prompt-too-long error from SDK callers while the query loop
 * decides whether reactive compaction can recover it. Ungated: the message
 * itself is the only input, and the module is only loaded when the feature
 * is compiled in.
 */
export function isWithheldPromptTooLong(message: Message): boolean {
  return message.type === 'assistant' && isPromptTooLongMessage(message)
}

/**
 * Same withholding rule for media-size rejections. Callers hoist the gate so
 * the withholding decision and the recovery decision agree within a turn.
 */
export function isWithheldMediaSizeError(message: Message | undefined): boolean {
  return message?.type === 'assistant' && isMediaSizeErrorMessage(message)
}

type RecoveryErrorClass = ReactiveCompactFailure | 'media'

function classifyRecoveryError(error: unknown, cacheSafeParams: CacheSafeParams): RecoveryErrorClass {
  const { toolUseContext } = cacheSafeParams
  if (toolUseContext.abortController.signal.aborted || hasExactErrorMessage(error, ERROR_MESSAGE_USER_ABORT)) {
    return 'aborted'
  }
  if (hasExactErrorMessage(error, ERROR_MESSAGE_NOT_ENOUGH_MESSAGES)) {
    return 'too_few_groups'
  }
  // compactConversation already retried PTL internally with truncateHeadForPTLRetry,
  // so either error here means recovery ran out of groups to drop.
  if (
    hasExactErrorMessage(error, ERROR_MESSAGE_PROMPT_TOO_LONG) ||
    hasExactErrorMessage(error, ERROR_MESSAGE_INCOMPLETE_RESPONSE)
  ) {
    return 'exhausted'
  }
  if (isMediaSizeError(errorMessage(error))) {
    return 'media'
  }
  return 'error'
}

/**
 * Summarizes all but the last API-round group and preserves that last group
 * as the post-compact tail. Returns a failure reason instead of throwing so
 * both callers can map it to their own user-facing error text.
 */
export async function reactiveCompactOnPromptTooLong(
  messages: Message[],
  cacheSafeParams: CacheSafeParams,
  options: { customInstructions?: string; trigger?: 'auto' | 'manual' } = {},
): Promise<ReactiveCompactOutcome> {
  // Callers normally pass a post-boundary slice already; re-slicing keeps
  // the invariant local (and is idempotent).
  const postBoundary = getMessagesAfterCompactBoundary(messages)
  const groups = groupMessagesByApiRound(postBoundary)
  if (groups.length < MIN_API_ROUND_GROUPS) {
    return { ok: false, reason: 'too_few_groups' }
  }

  const messagesToKeep = groups[groups.length - 1]
  let messagesToSummarize = groups.slice(0, -1).flat()
  const isAutoCompact = options.trigger !== 'manual'
  const { toolUseContext } = cacheSafeParams

  const attempt = (toSummarize: Message[]): Promise<CompactionResult> =>
    compactConversation(
      toSummarize,
      toolUseContext,
      { ...cacheSafeParams, forkContextMessages: toSummarize },
      true,
      options.customInstructions,
      isAutoCompact,
      undefined,
      // PreCompact hooks are the caller's responsibility — see module doc.
      true,
    )

  let result: CompactionResult
  try {
    result = await attempt(messagesToSummarize)
  } catch (error) {
    const failure = classifyRecoveryError(error, cacheSafeParams)
    if (failure !== 'media') {
      return { ok: false, reason: failure }
    }
    // The summarize call itself tripped a media-size limit. Strip images and
    // documents (including inside tool results) and retry once.
    logForDebugging('[reactiveCompact] media-size rejection; stripping media from summarize input and retrying')
    messagesToSummarize = stripImagesFromMessages(messagesToSummarize)
    try {
      result = await attempt(messagesToSummarize)
    } catch (retryError) {
      const retryFailure = classifyRecoveryError(retryError, cacheSafeParams)
      return { ok: false, reason: retryFailure === 'media' ? 'media_unstrippable' : retryFailure }
    }
  }

  // The boundary's preserved segment points the resume loader at the tail;
  // anchor is the last summary message (suffix-preserving layout).
  const lastSummary = result.summaryMessages[result.summaryMessages.length - 1]
  const boundaryMarker = lastSummary
    ? annotateBoundaryWithPreservedSegment(result.boundaryMarker, lastSummary.uuid, messagesToKeep)
    : result.boundaryMarker

  return { ok: true, result: { ...result, boundaryMarker, messagesToKeep } }
}

/**
 * Query-loop entry point: guard, run PreCompact hooks, recover, then apply
 * the same post-success cleanup as the other compaction paths. Returns null
 * when recovery is unavailable or unsuccessful so the caller surfaces the
 * withheld error.
 */
export async function tryReactiveCompact(params: {
  hasAttempted: boolean
  querySource: QuerySource
  aborted: boolean
  messages: Message[]
  cacheSafeParams: CacheSafeParams
}): Promise<CompactionResult | null> {
  const { hasAttempted, aborted, messages, cacheSafeParams, querySource } = params
  if (hasAttempted || aborted) {
    return null
  }
  // Consults isAutoCompactEnabled directly (not shouldAutoCompact) so the
  // reactive-only and context-collapse suppressions don't disable the 413
  // fallback. An explicit DISABLE_AUTO_COMPACT still opts the user out.
  if (!isReactiveCompactEnabled() || !isAutoCompactEnabled()) {
    return null
  }

  const { toolUseContext } = cacheSafeParams
  toolUseContext.onCompactProgress?.({ type: 'hooks_start', hookType: 'pre_compact' })
  toolUseContext.setSDKStatus?.('compacting')

  let hookResult: { newCustomInstructions?: string; userDisplayMessage?: string }
  try {
    hookResult = await executePreCompactHooks(
      { trigger: 'auto', customInstructions: null },
      toolUseContext.abortController.signal,
    )
  } catch (error) {
    logForDebugging(`[reactiveCompact] PreCompact hooks failed: ${errorMessage(error)}`)
    return null
  }

  const outcome = await reactiveCompactOnPromptTooLong(messages, cacheSafeParams, {
    customInstructions: mergeHookInstructions(undefined, hookResult.newCustomInstructions),
    trigger: 'auto',
  })
  if (!outcome.ok) {
    logForDebugging(`[reactiveCompact] recovery failed: ${outcome.reason}`)
    return null
  }

  // Legacy compaction replaces all messages, so the old summarized id no
  // longer exists in the post-compact array.
  setLastSummarizedMessageId(undefined)
  runPostCompactCleanup(querySource)
  suppressCompactWarning()
  getUserContext.cache.clear?.()

  // reactiveCompactOnPromptTooLong ran PostCompact hooks but not PreCompact —
  // merge both display messages for the caller.
  const combinedMessage =
    [hookResult.userDisplayMessage, outcome.result.userDisplayMessage].filter(Boolean).join('\n') || undefined

  return { ...outcome.result, userDisplayMessage: combinedMessage }
}
