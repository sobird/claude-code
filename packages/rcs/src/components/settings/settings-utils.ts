/**
 * Pure helpers for the settings page.
 *
 * Kept free of React and browser APIs so they can be unit tested directly and
 * reused by both the account and admin surfaces.
 */

/** Stored API-key prefixes are `rcs_` plus eight base64url characters. */
export const API_KEY_PREFIX_MAX_LENGTH = 12

/** Minimum accepted length for a new password. */
export const MIN_PASSWORD_LENGTH = 8

const ELLIPSIS = '\u2026'

export interface PasswordChangeInput {
  current: string
  next: string
  confirm: string
}

/** Machine-readable reasons a password change was rejected; the UI maps these to `settings.password.errors.<code>`. */
export type PasswordChangeError = 'fill_all' | 'too_short' | 'mismatch' | 'same_as_current'

export interface RoleBearingUser {
  role?: string | null
}

/**
 * Render a stored key prefix for display. Stored prefixes are already
 * non-secret; the ellipsis signals that only the beginning is shown.
 * Empty input renders nothing, and overlong input is truncated.
 */
export function maskApiKey(prefix: string): string {
  const value = prefix.trim()
  if (value.length === 0) return ''
  const visible = value.length > API_KEY_PREFIX_MAX_LENGTH ? value.slice(0, API_KEY_PREFIX_MAX_LENGTH) : value
  return `${visible}${ELLIPSIS}`
}

/**
 * Validate a password change before hitting the gateway. Returns the first
 * problem as a stable code (the caller localizes it), or `null` when the input
 * is valid.
 */
export function validatePasswordChange({ current, next, confirm }: PasswordChangeInput): PasswordChangeError | null {
  if (current.length === 0 || next.length === 0 || confirm.length === 0) {
    return 'fill_all'
  }
  // Check the pair-level problems before length so a short-but-mismatched (or
  // short-but-reused) pair reports the more specific reason.
  if (next !== confirm) {
    return 'mismatch'
  }
  if (next === current) {
    return 'same_as_current'
  }
  if (next.length < MIN_PASSWORD_LENGTH) {
    return 'too_short'
  }
  return null
}

/** Only admins may manage users; `null`/`undefined` never qualifies. */
export function canManageUsers(user: RoleBearingUser | null | undefined): boolean {
  return user?.role === 'admin'
}
