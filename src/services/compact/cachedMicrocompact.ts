/**
 * State and helpers for cache-editing microcompact (ant-only).
 *
 * Unlike the legacy path, nothing here rewrites local content. We track tool
 * results grouped by the user message that carried them, decide which groups
 * to delete, and emit `cache_edits` blocks. The API layer (`addCacheBreakpoints`)
 * inserts those blocks and the server removes the referenced tool results
 * without invalidating the cached prefix.
 *
 * Shapes MUST match `CachedMCEditsBlock` / `CachedMCPinnedEdits` in
 * services/api/claude.ts — the blocks are passed straight through.
 */

import { getCachedMCConfig } from './cachedMCConfig.js'

export { getCachedMCConfig } from './cachedMCConfig.js'

export type CachedMCState = {
  /** Tool-use ids whose results have been registered. */
  registeredTools: Set<string>
  /** Registration order — oldest first. */
  toolOrder: string[]
  /** Ids already queued for deletion (never re-emitted). */
  deletedRefs: Set<string>
  /** Blocks previously inserted, replayed at their original positions. */
  pinnedEdits: PinnedCacheEdits[]
  /** True once the API has acknowledged the registered results. */
  toolsSentToAPI: boolean
  /** Tool-use ids grouped by their carrying user message. */
  groups: string[][]
}

export type CacheEditsBlock = {
  type: 'cache_edits'
  edits: { type: 'delete'; cache_reference: string }[]
}

export type PinnedCacheEdits = {
  userMessageIndex: number
  block: CacheEditsBlock
}

export function isCachedMicrocompactEnabled(): boolean {
  if (process.env.USER_TYPE !== 'ant') {
    return false
  }
  return getCachedMCConfig().enabled
}

export function isModelSupportedForCacheEditing(model: string): boolean {
  if (model.length === 0) {
    return false
  }
  return getCachedMCConfig().supportedModels.some((supported) => supported.length > 0 && model.includes(supported))
}

export function createCachedMCState(): CachedMCState {
  return {
    registeredTools: new Set(),
    toolOrder: [],
    deletedRefs: new Set(),
    pinnedEdits: [],
    toolsSentToAPI: false,
    groups: [],
  }
}

export function markToolsSentToAPI(state: CachedMCState): void {
  state.toolsSentToAPI = true
}

export function resetCachedMCState(state: CachedMCState): void {
  state.registeredTools.clear()
  state.toolOrder.length = 0
  state.deletedRefs.clear()
  state.pinnedEdits.length = 0
  state.toolsSentToAPI = false
  state.groups.length = 0
}

export function registerToolResult(state: CachedMCState, toolId: string): void {
  if (state.registeredTools.has(toolId)) return
  state.registeredTools.add(toolId)
  state.toolOrder.push(toolId)
}

export function registerToolMessage(state: CachedMCState, groupIds: string[]): void {
  if (groupIds.length === 0) return
  state.groups.push([...groupIds])
}

/**
 * Oldest whole groups to delete, keeping the configured number of most-recent
 * active groups. Deletion only starts once the API has seen the results —
 * deleting before the first response would reference unknown tool uses.
 */
export function getToolResultsToDelete(state: CachedMCState): string[] {
  if (!state.toolsSentToAPI) {
    return []
  }
  const { keepRecent } = getCachedMCConfig()
  const activeGroups = state.groups.filter((group) => group.some((id) => !state.deletedRefs.has(id)))
  const excess = activeGroups.length - keepRecent
  if (excess <= 0) {
    return []
  }
  const toDelete: string[] = []
  for (const group of activeGroups.slice(0, excess)) {
    for (const id of group) {
      if (!state.deletedRefs.has(id)) {
        toDelete.push(id)
      }
    }
  }
  return toDelete
}

/** Builds a delete block and marks the ids as queued. Null when nothing is left. */
export function createCacheEditsBlock(state: CachedMCState, toolIds: string[]): CacheEditsBlock | null {
  const refs = toolIds.filter((id) => !state.deletedRefs.has(id))
  if (refs.length === 0) {
    return null
  }
  for (const id of refs) {
    state.deletedRefs.add(id)
  }
  return {
    type: 'cache_edits',
    edits: refs.map((id) => ({ type: 'delete', cache_reference: id })),
  }
}
