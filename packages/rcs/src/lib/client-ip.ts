/**
 * Client IP extraction behind the Caddy reverse proxy.
 *
 * Uses the right-most `x-forwarded-for` entry, then `x-real-ip`. Caddy appends the real
 * peer address to `x-forwarded-for`, so the right-most hop is the one the proxy saw; the
 * left-most entry is client-supplied and trivially rotated to evade rate limiting. Returns
 * a stable `unknown` bucket when no forwarding header is present so direct connections
 * still group together.
 */

export function getClientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const hops = forwarded.split(',')
    const last = hops[hops.length - 1]?.trim()
    if (last) return last
  }

  const realIp = headers.get('x-real-ip')?.trim()
  if (realIp) return realIp

  return 'unknown'
}
