/**
 * `Object.entries` for partial records.
 *
 * `Partial<Record<K, V>>` only omits absent keys, so every entry that exists
 * has a defined value. This narrows the key back to `K` and drops the
 * implicit `| undefined` from the value type.
 */
export function definedEntries<K extends string, V>(record: Partial<Record<K, V>>): [K, V][] {
  return Object.entries(record).filter((entry): entry is [K, V] => entry[1] !== undefined)
}
