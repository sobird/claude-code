/**
 * UUID v4 generator that also works on insecure origins.
 *
 * `crypto.randomUUID` is only exposed in secure contexts, so the UI opened over
 * plain HTTP from another device (`http://192.168.x.x:3000`) cannot use it.
 * `crypto.getRandomValues` is available in every context.
 */
export function randomUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
