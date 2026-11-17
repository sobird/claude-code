/** Format epoch seconds for display in the requested locale; falsy or invalid input renders an empty string. */
export function formatEpochSeconds(ts: number | null | undefined, locale: string): string {
  if (!ts) return ''
  const date = new Date(ts * 1000)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

/** Format an ISO date string in the requested locale; missing or invalid input renders an empty string. */
export function formatIsoDate(iso: string | null | undefined, locale: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date)
}
