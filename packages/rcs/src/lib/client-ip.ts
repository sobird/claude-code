/**
 * Client IP extraction behind the Caddy reverse proxy.
 *
 * Prefers the left-most `x-forwarded-for` entry, then `x-real-ip`. Returns a
 * stable `unknown` bucket when no forwarding header is present so rate limiting
 * still groups direct connections.
 */

export function getClientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }

  const realIp = headers.get('x-real-ip')?.trim()
  if (realIp) return realIp

  return 'unknown'
}
