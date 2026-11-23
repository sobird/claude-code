/** 消息行的记忆化比较：折叠或分组会重建数组与 Map，只有元素引用变化才算变。 */

import type { ThreadEntry } from '@/lib/session-reducer'

/** 两个消息数组是否逐元素引用相同（长度或任一元素不同即视为变化）。 */
export function sameEntryList(
  before: readonly ThreadEntry[] | undefined,
  after: readonly ThreadEntry[] | undefined,
): boolean {
  if (before === after) return true
  if (!before || !after || before.length !== after.length) return false
  for (let i = 0; i < before.length; i++) {
    if (before[i] !== after[i]) return false
  }
  return true
}

/** 给定 tool id 的子线程是否都没变；Map 本身重建但内容相同视为未变。 */
export function sameChildThreads(
  before: ReadonlyMap<string, ThreadEntry[]>,
  after: ReadonlyMap<string, ThreadEntry[]>,
  toolIds: readonly string[],
): boolean {
  if (before === after) return true
  for (const id of toolIds) {
    if (!sameEntryList(before.get(id), after.get(id))) return false
  }
  return true
}
