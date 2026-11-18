/**
 * Session-scoped registry of remote canonical skills.
 *
 * SkillTool intercepts `_canonical_<slug>` command names before local lookup
 * and needs the URL the discovery pass recorded for that slug. Nothing in this
 * tree populates the registry (the AKI discovery backend is not part of the
 * source), so it is a plain in-memory map: remote skill execution is
 * unreachable unless an embedder registers slugs. The lookup functions must
 * still behave correctly for that embedder, hence the real implementation
 * rather than a hard-coded null.
 */

const CANONICAL_PREFIX = '_canonical_'

const discoveredSkills = new Map<string, { url: string }>()

/**
 * Extracts the slug from a `_canonical_<slug>` command name. Returns null for
 * names that are not remote canonical skills, so callers can fall through to
 * local lookup.
 */
export function stripCanonicalPrefix(name: string): string | null {
  if (!name.startsWith(CANONICAL_PREFIX)) {
    return null
  }
  const slug = name.slice(CANONICAL_PREFIX.length)
  return slug.length > 0 ? slug : null
}

export function getDiscoveredRemoteSkill(slug: string): { url: string } | undefined {
  return discoveredSkills.get(slug)
}

/** Records a discovered remote skill so a later SkillTool call can load it. */
export function registerDiscoveredRemoteSkill(slug: string, url: string): void {
  if (slug.length === 0 || url.length === 0) return
  discoveredSkills.set(slug, { url })
}

/** Clears the registry — called when the session's discovery state resets. */
export function clearDiscoveredRemoteSkills(): void {
  discoveredSkills.clear()
}
