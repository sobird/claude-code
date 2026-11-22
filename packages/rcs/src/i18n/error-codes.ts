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
  'bridge_unavailable',
  'side_question_timeout',
  'side_question_failed',
] as const

export type KnownErrorCode = (typeof KNOWN_ERROR_CODES)[number]

/** Fully-qualified catalog key for a known code. */
export type ErrorCodeKey = `errors.codes.${KnownErrorCode}`

const CODE_KEYS: ReadonlyMap<string, ErrorCodeKey> = new Map(
  KNOWN_ERROR_CODES.map((code) => [code, `errors.codes.${code}`]),
)

/** Catalog key for a known code, or `null` when the code has no copy. */
export function apiErrorKey(code: string): ErrorCodeKey | null {
  return CODE_KEYS.get(code) ?? null
}
