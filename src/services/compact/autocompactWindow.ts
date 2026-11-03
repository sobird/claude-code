import { getSdkBetas } from '../../bootstrap/state.js'
import { getContextWindowForModel } from '../../utils/context.js'

/**
 * Lower bound accepted by `/autocompact` and `CLAUDE_CODE_AUTO_COMPACT_WINDOW`.
 * Mirrors upstream `D17`.
 */
export const AUTOCOMPACT_MIN_WINDOW = 100_000
/**
 * Upper bound accepted by `/autocompact` and `CLAUDE_CODE_AUTO_COMPACT_WINDOW`.
 * Mirrors upstream `jfK`.
 */
export const AUTOCOMPACT_MAX_WINDOW = 1_000_000

export type AutocompactWindowSource = 'env' | 'settings' | 'model'

export type AutocompactWindow = {
  configured: number
  window: number
  source: AutocompactWindowSource
}

/**
 * Mirrors upstream `VU` for the env override: `parseInt` only (no k/m
 * shorthand), non-positive or non-numeric values are ignored, values above the
 * maximum are capped, and values below the minimum are raised to it.
 */
export function parseAutocompactEnvWindow(raw = process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW): number | undefined {
  if (!raw) return undefined
  const value = parseInt(raw, 10)
  if (isNaN(value) || value <= 0) return undefined
  return Math.max(AUTOCOMPACT_MIN_WINDOW, Math.min(value, AUTOCOMPACT_MAX_WINDOW))
}

/** Mirrors upstream `j56`: env wins over settings, which wins over the model default. */
export function resolveAutocompactWindow(model: string, settingsWindow: number | undefined): AutocompactWindow {
  const modelWindow = getContextWindowForModel(model, getSdkBetas())

  const envWindow = parseAutocompactEnvWindow()
  if (envWindow !== undefined) {
    return { window: Math.min(modelWindow, envWindow), configured: envWindow, source: 'env' }
  }
  if (settingsWindow !== undefined) {
    return { window: Math.min(modelWindow, settingsWindow), configured: settingsWindow, source: 'settings' }
  }
  return { window: modelWindow, configured: modelWindow, source: 'model' }
}
