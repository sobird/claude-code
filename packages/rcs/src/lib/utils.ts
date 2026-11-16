import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge conditional class names, resolving Tailwind conflicts. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/** Format epoch seconds for display; empty input renders an empty string. */
export function formatTime(ts: number | null | undefined): string {
  if (!ts) return ''
  return new Date(ts * 1000).toLocaleString()
}

/**
 * Pair items with React keys that stay unique even when the base key repeats
 * (e.g. two tool calls sharing an id). Suffixes repeats with an occurrence
 * counter instead of the array index, so keys remain stable across reorders.
 */
export function uniqueKeys<T>(items: readonly T[], keyOf: (item: T) => string): Array<{ item: T; key: string }> {
  const counts = new Map<string, number>()
  return items.map((item) => {
    const base = keyOf(item)
    const seen = counts.get(base) ?? 0
    counts.set(base, seen + 1)
    return { item, key: seen === 0 ? base : `${base}#${seen}` }
  })
}
