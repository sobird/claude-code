/**
 * Windowing for the transcript: a long session keeps a bounded number of
 * rendered messages instead of mounting every entry ever loaded.
 *
 * The newest window is always rendered. Once the reader reveals older items the
 * window's first key is pinned by key (not index), so streamed appends never
 * unmount what is on screen and pages prepended by "load earlier" resolve to the
 * same item rather than shifting the window.
 */

/** Grouped items rendered before the older ones must be revealed. */
export const MESSAGE_WINDOW_SIZE = 80
/** 每次揭示更早一屏的条数。取窗口的一半，让单次挂载的卡片量不至于卡顿。 */
export const MESSAGE_WINDOW_STEP = 40

/** Index of the first rendered item. */
export function windowStartIndex(
  keys: readonly string[],
  pinnedKey: string | null,
  size: number = MESSAGE_WINDOW_SIZE,
): number {
  const tail = Math.max(0, keys.length - Math.max(0, size))
  if (!pinnedKey) return tail
  const index = keys.indexOf(pinnedKey)
  return index === -1 ? tail : index
}

/** Where the window starts after revealing one more step of older items. */
export function earlierStartIndex(start: number, step: number = MESSAGE_WINDOW_STEP): number {
  return Math.max(0, start - Math.max(0, step))
}
