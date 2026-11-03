import { getIsNonInteractiveSession } from '../../bootstrap/state.js'
import { AUTOCOMPACT_MAX_WINDOW, AUTOCOMPACT_MIN_WINDOW } from '../../services/compact/autocompactWindow.js'
import type { Command } from '../../types/command.js'

export { AUTOCOMPACT_MAX_WINDOW, AUTOCOMPACT_MIN_WINDOW }

export type ParsedAutocompactArgs =
  | { action: 'show' }
  | { action: 'set'; window: number }
  | { action: 'reset' }
  | { action: 'invalid' }

/**
 * Parse the `/autocompact` argument. Mirrors upstream 2.1.89 `HfK`:
 * trim + lowercase; `reset|unset|default` reset; `m` suffix ×1e6, `k` ×1e3;
 * a bare integer in [100,1000] is shorthand for that many thousands; anything
 * else is taken as-is. The result must land in [100k, 1M] to be valid.
 */
export function parseAutocompactArgs(args: string): ParsedAutocompactArgs {
  const normalized = args.trim().toLowerCase()
  if (normalized === '') return { action: 'show' }
  if (normalized === 'reset' || normalized === 'unset' || normalized === 'default') {
    return { action: 'reset' }
  }
  const window = parseAutocompactWindow(normalized)
  return window === undefined ? { action: 'invalid' } : { action: 'set', window }
}

function parseAutocompactWindow(normalized: string): number | undefined {
  let value: number
  if (normalized.endsWith('m')) {
    value = parseFloat(normalized) * 1_000_000
  } else if (normalized.endsWith('k')) {
    value = parseFloat(normalized) * 1_000
  } else {
    const bare = parseInt(normalized, 10)
    value = bare >= 100 && bare <= 1000 ? bare * 1000 : bare
  }
  if (!Number.isFinite(value) || value < AUTOCOMPACT_MIN_WINDOW || value > AUTOCOMPACT_MAX_WINDOW) {
    return undefined
  }
  return Math.round(value)
}

export const autocompact: Command = {
  type: 'local-jsx',
  name: 'autocompact',
  description: 'Configure the auto-compact window size',
  isEnabled: () => !getIsNonInteractiveSession(),
  isHidden: false,
  argumentHint: '[tokens|reset]',
  userFacingName() {
    return 'autocompact'
  },
  load: () => import('./autocompact.js'),
}

export const autocompactNonInteractive: Command = {
  type: 'local',
  name: 'autocompact',
  supportsNonInteractive: true,
  description: 'Configure the auto-compact window size',
  get isHidden() {
    return !getIsNonInteractiveSession()
  },
  isEnabled() {
    return getIsNonInteractiveSession()
  },
  argumentHint: '[tokens|reset]',
  userFacingName() {
    return 'autocompact'
  },
  load: () => import('./autocompact-noninteractive.js'),
}
