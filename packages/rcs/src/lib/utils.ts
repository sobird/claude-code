import { type ClassValue, clsx } from 'clsx'

/** Compose class names for CSS Modules (no Tailwind conflict resolution). */
export function cx(...inputs: ClassValue[]): string {
  return clsx(inputs)
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
