import { getSdkBetas } from '../../bootstrap/state.js'
import { isAutoCompactEnabled } from '../../services/compact/autoCompact.js'
import type { ToolUseContext } from '../../Tool.js'
import { getContextWindowForModel } from '../../utils/context.js'
import { formatTokens } from '../../utils/format.js'
import { getInitialSettings, updateSettingsForSource } from '../../utils/settings/settings.js'
import { AUTOCOMPACT_MAX_WINDOW, AUTOCOMPACT_MIN_WINDOW, parseAutocompactArgs } from './index.js'

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

/** Mirrors upstream `s2Y`: the multi-line status shown by `/autocompact` with no args. */
export function showAutocompactWindow(model: string, settingsWindow: number | undefined): string {
  const { window, configured, source } = resolveAutocompactWindow(model, settingsWindow)
  const sourceSuffix =
    source === 'env'
      ? ' (from CLAUDE_CODE_AUTO_COMPACT_WINDOW)'
      : source === 'settings'
        ? ' (from settings)'
        : ' (model default)'
  const capped = configured > window ? ` · capped to ${formatTokens(window)} by model` : ''

  const lines = [`Auto-compact window: ${formatTokens(configured)} tokens${sourceSuffix}${capped}`]
  if (!isAutoCompactEnabled()) {
    lines.push('Auto-compact is currently disabled (see /config)')
  }
  lines.push(
    "Auto-compact summarizes the conversation when context usage approaches this limit. The actual threshold is the minimum of this setting and your model's context window.",
  )
  return lines.join('\n')
}

/**
 * Mirrors upstream `b78`: set or reset `autoCompactWindow` in user settings,
 * update AppState, and return the user-visible result.
 */
export function applyAutocompactWindow(args: string, context: ToolUseContext): string {
  if (process.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW) {
    return 'CLAUDE_CODE_AUTO_COMPACT_WINDOW is set and takes precedence. Unset it to change this setting.'
  }

  const raw = args.trim()
  const parsed = parseAutocompactArgs(raw)

  if (parsed.action === 'show') {
    return showAutocompactWindow(context.options.mainLoopModel, context.getAppState().autoCompactWindow)
  }
  if (parsed.action === 'invalid') {
    return `Invalid argument: ${raw}. Expected 100k–1M tokens (e.g. 500k, 200000, or 200 as shorthand) or 'reset'`
  }

  const next = parsed.action === 'reset' ? undefined : parsed.window

  updateSettingsForSource('userSettings', { autoCompactWindow: next })
  context.setAppState((prev) => (prev.autoCompactWindow === next ? prev : { ...prev, autoCompactWindow: next }))

  const settingsWindow = getInitialSettings().autoCompactWindow
  const { window, source } = resolveAutocompactWindow(context.options.mainLoopModel, settingsWindow)
  const overridden = source === 'env' || settingsWindow !== next

  if (parsed.action === 'reset') {
    return overridden
      ? `Auto-compact window reset in settings, but a higher-priority override is active (${formatTokens(window)} tokens)`
      : 'Auto-compact window reset to model default'
  }

  let suffix = ''
  if (overridden) {
    suffix = `, but a higher-priority override is active (${formatTokens(window)} tokens)`
  } else if (window < parsed.window) {
    suffix = ` (capped to model limit of ${formatTokens(window)})`
  }
  return `Auto-compact window set to ${formatTokens(parsed.window)} tokens${suffix}`
}
