/**
 * Parent-pointer thread tree.
 *
 * The reducer keeps one flat transcript; subagent traffic carries a
 * `parentToolUseId` pointing at its Agent tool call. The view nests by that
 * pointer instead of the reducer maintaining a second, parallel structure —
 * replaying history or live frames yields the same tree.
 */

import type { ThreadEntry } from './session-reducer'

export interface ThreadTree {
  /** Entries that have no parent (or whose parent is not a tool call here). */
  top: ThreadEntry[]
  /** Direct children per parent tool call id, in transcript order. */
  childrenByParent: Map<string, ThreadEntry[]>
}

export function buildThreadTree(entries: readonly ThreadEntry[]): ThreadTree {
  // Only tool calls can own children; a pointer at anything else is treated as
  // absent so a malformed parent id never hides an entry.
  const toolCallIds = new Set(
    entries
      .filter((entry): entry is Extract<ThreadEntry, { type: 'tool_call' }> => entry.type === 'tool_call')
      .map((entry) => entry.toolCall.id),
  )

  const top: ThreadEntry[] = []
  const childrenByParent = new Map<string, ThreadEntry[]>()

  for (const entry of entries) {
    const parent = 'parentToolUseId' in entry ? entry.parentToolUseId : undefined
    if (parent && toolCallIds.has(parent)) {
      const children = childrenByParent.get(parent)
      if (children) children.push(entry)
      else childrenByParent.set(parent, [entry])
      continue
    }
    top.push(entry)
  }

  return { top, childrenByParent }
}
