import { getFeatureValue_CACHED_MAY_BE_STALE } from 'src/services/analytics/growthbook.js'

/**
 * GrowthBook-gated prompt variants shared between Read/Edit/Write/Bash and the
 * agent system prompt. Kept in one leaf module so tool prompts and
 * constants/prompts.ts don't have to import each other.
 */

/** Relative file-tool paths are allowed (cwd-relative preferred for brevity). */
export function isRelativeFilePathGuidanceEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_relpath_gh7k', false)
}

/** Shift prompts toward "don't re-read after edit" guidance. */
export function isNoRereadGuidanceEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_noreread_q7m_velvet', false)
}

/** Suffix on Edit/Write results telling the model the file state is current. */
export const FILE_STATE_CURRENT_SUFFIX = ' (file state is current in your context — no need to Read it back)'

/** Variant of the "file unchanged" stub used when no-reread guidance is on. */
export const FILE_UNCHANGED_STUB_WASTED =
  'Wasted call — file unchanged since your last Read. Refer to that earlier tool_result instead.'

/** Extra Read prompt bullet: don't re-read after an edit just to verify. */
export const NO_REREAD_BULLET = [
  '',
  '- Do NOT re-read a file you just edited to verify — Edit/Write would have errored if the change failed, and the harness tracks file state for you.',
].join('\n')

/** Resolve the file_unchanged stub, honoring the no-reread experiment. */
export function getFileUnchangedStub(defaultStub: string): string {
  return isNoRereadGuidanceEnabled() ? FILE_UNCHANGED_STUB_WASTED : defaultStub
}
