/**
 * Stable error codes emitted by the gateway and the Next API routes.
 *
 * The client maps these to `errors.codes.<code>` catalog entries; unknown codes
 * deliberately fall through to the server's own message.
 */
export const KNOWN_ERROR_CODES = [
  'unauthorized',
  'rate_limited',
  'invalid_locale',
  'session_not_found',
  'environment_not_found',
  'forbidden',
  'environment_forbidden',
  'session_closed',
  'user_not_found',
  'current_password_incorrect',
  'new_password_required',
  'api_key_not_found',
  'validation_failed',
  'username_taken',
  'invalid_role',
  'last_admin',
  'session_id_required',
] as const

export type KnownErrorCode = (typeof KNOWN_ERROR_CODES)[number]

const KNOWN_CODES: ReadonlySet<string> = new Set<string>(KNOWN_ERROR_CODES)

/** Catalog key for a known code, or `null` when the code has no copy. */
export function apiErrorKey(code: string): string | null {
  return KNOWN_CODES.has(code) ? `errors.codes.${code}` : null
}
