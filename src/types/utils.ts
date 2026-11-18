/**
 * Recursively marks every property readonly. Functions are passed through
 * unchanged (their `keyof` is `never`, so mapping them would erase the call
 * signature), and collections keep their read-only counterparts so consumers
 * can still read from them without gaining mutation access.
 */
export type DeepImmutable<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends Map<infer K, infer V>
    ? ReadonlyMap<DeepImmutable<K>, DeepImmutable<V>>
    : T extends Set<infer U>
      ? ReadonlySet<DeepImmutable<U>>
      : T extends Array<infer U>
        ? ReadonlyArray<DeepImmutable<U>>
        : T extends object
          ? { readonly [K in keyof T]: DeepImmutable<T[K]> }
          : T

/** Read-only list of `T`; used to enumerate union members at call sites. */
export type Permutations<T> = readonly T[]
