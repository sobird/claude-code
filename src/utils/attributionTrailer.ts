import type { AttributionData, AttributionState } from './commitAttribution.js'

/**
 * Builds the git-trailer block appended to a PR body so attribution survives a
 * squash merge. Repos configured with squash_merge_commit_message=PR_BODY turn
 * the PR body into the squash commit message verbatim, so trailing `Key: value`
 * lines become real git trailers on the squash commit.
 *
 * Values are kept single-line: a session id or surface that somehow contains a
 * newline would otherwise split one trailer into two.
 */
export function buildPRTrailers(attributionData: AttributionData, attribution?: AttributionState): string[] {
  const trailers = [`Claude-Attribution: ${attributionData.summary.claudePercent}%`]

  const surfaces = attributionData.summary.surfaces.filter((surface) => surface.length > 0)
  if (surfaces.length > 0) {
    trailers.push(`Claude-Surfaces: ${surfaces.join(', ')}`)
  }

  for (const session of attributionData.sessions) {
    if (session.length > 0) {
      trailers.push(`Claude-Session: ${session}`)
    }
  }

  if (attribution) {
    // Prompts since the last attribution-aware commit — one proxy for how many
    // times the user had to steer Claude back on track.
    const steers = Math.max(0, attribution.promptCount - attribution.promptCountAtLastCommit)
    trailers.push(`Claude-Prompts: ${attribution.promptCount}`)
    trailers.push(`Claude-Steers: ${steers}`)
  }

  return trailers.map((trailer) => trailer.replace(/\r?\n/g, ' '))
}
