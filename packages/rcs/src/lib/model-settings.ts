/**
 * Model display and switching for a session.
 *
 * The CLI reports its model list in the `initialize` control response; the web
 * menu fetches it lazily and falls back to a free-form model id when the list is
 * unavailable. Every value here crosses the bridge, so parsing is defensive.
 */

export interface ModelOption {
  value: string
  displayName: string
  description?: string
}

/** Upper bound on the options the web menu renders. */
export const MAX_MODEL_OPTIONS = 40

/** Trimmed non-empty string, or null. */
export function normalizeModel(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/** Defensive parse of the `models` array in an `initialize` response. */
export function normalizeModelOptions(value: unknown): ModelOption[] {
  if (!Array.isArray(value)) return []
  const options: ModelOption[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const modelValue = normalizeModel(record.value)
    if (!modelValue || seen.has(modelValue)) continue
    seen.add(modelValue)
    const displayName = normalizeModel(record.displayName) ?? modelValue
    const description = normalizeModel(record.description)
    options.push(description ? { value: modelValue, displayName, description } : { value: modelValue, displayName })
    if (options.length >= MAX_MODEL_OPTIONS) break
  }
  return options
}

/** Envelope for `set_model`; omitting `model` resets to the CLI default. */
export function buildSetModelRequest(requestId: string, model: string | null): Record<string, unknown> {
  const normalized = normalizeModel(model)
  return {
    type: 'control_request',
    request_id: requestId,
    request: { subtype: 'set_model', ...(normalized ? { model: normalized } : {}) },
  }
}
