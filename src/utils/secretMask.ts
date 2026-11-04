/** Short, non-reversible preview of a secret for on-screen display. */
export function maskSecretForDisplay(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  if (trimmed.length <= 8) return 'configured'
  return `${trimmed.slice(0, 3)}...${trimmed.slice(-3)}`
}

/** Replaces every occurrence of `secret` in `text` with its masked preview. */
export function redactSecretFromText(text: string, secret: string | null | undefined): string {
  const trimmed = secret?.trim()
  if (!trimmed || trimmed.length < 4) return text
  return text.split(trimmed).join(maskSecretForDisplay(trimmed) ?? 'configured')
}
