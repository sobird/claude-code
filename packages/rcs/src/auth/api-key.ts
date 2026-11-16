/**
 * API key generation and hashing.
 *
 * Keys are `rcs_` followed by 32 random bytes encoded as base64url. Only `generateApiKey`
 * ever returns the raw key; storage should persist `prefix` and `hash` (sha256 hex).
 */

import { createHash, randomBytes } from 'node:crypto'

const KEY_PREFIX = 'rcs_'
const KEY_BYTES = 32
const DISPLAY_PREFIX_LENGTH = 12

export interface GeneratedApiKey {
  /** Full secret; show once to the caller, never store it. */
  raw: string
  /** First 12 characters, safe to display and store for lookup. */
  prefix: string
  /** sha256 hex of `raw`. */
  hash: string
}

export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export function generateApiKey(): GeneratedApiKey {
  const raw = `${KEY_PREFIX}${randomBytes(KEY_BYTES).toString('base64url')}`
  return {
    raw,
    prefix: raw.slice(0, DISPLAY_PREFIX_LENGTH),
    hash: hashApiKey(raw),
  }
}
