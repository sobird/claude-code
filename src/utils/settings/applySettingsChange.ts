import { resolve } from 'node:path'

import type { AppState } from '../../state/AppState.js'
import type { ToolPermissionContext } from '../../Tool.js'
import { logForDebugging } from '../debug.js'
import { updateHooksConfigSnapshot } from '../hooks/hooksConfigSnapshot.js'
import { expandPath } from '../path.js'
import { syncPermissionRulesFromDisk } from '../permissions/permissions.js'
import {
  createDisabledBypassPermissionsContext,
  findOverlyBroadBashPermissions,
  isBypassPermissionsModeDisabled,
  removeDangerousPermissions,
  transitionPlanAutoMode,
} from '../permissions/permissionSetup.js'
import { loadAllPermissionRulesFromDisk } from '../permissions/permissionsLoader.js'
import { applyPermissionUpdate } from '../permissions/PermissionUpdate.js'
import type { SettingSource } from './constants.js'
import { getInitialSettings } from './settings.js'

/**
 * Apply a settings change to app state. Re-reads settings from disk,
 * reloads permissions and hooks, and pushes the new state.
 *
 * Used by both the interactive path (AppState.tsx via useSettingsChange) and
 * the headless/SDK path (print.ts direct subscribe) so that managed-settings
 * / policy changes are fully applied in both modes.
 *
 * The settings cache is reset by the notifier (changeDetector.fanOut) before
 * listeners are iterated, so getInitialSettings() here reads fresh disk
 * state. Previously this function reset the cache itself, which — combined
 * with useSettingsChange's own reset — caused N disk reloads per notification
 * for N subscribers.
 *
 * Side-effects like clearing auth caches and applying env vars are handled by
 * `onChangeAppState` which fires when `settings` changes in state.
 */
// Directory sources that are not backed by a settings file: --add-dir, the
// /add-dir command, and session-scoped grants. A settings edit must never
// revoke one of these (upstream 2.1.98 #21).
const PROTECTED_DIRECTORY_SOURCES = new Set<string>(['cliArg', 'command', 'session'])

const normalizeDirectory = (dir: string): string => resolve(expandPath(dir))

/**
 * Reconcile `additionalWorkingDirectories` with a mid-session settings edit.
 *
 * Directories removed from `permissions.additionalDirectories` lose access
 * immediately and newly added ones work without a restart (2.1.98 #20), while
 * directories granted by --add-dir / /add-dir / the session survive the edit
 * (2.1.98 #21). Untouched directories are left alone.
 */
export function reconcileAdditionalDirectories(
  context: ToolPermissionContext,
  previousDirectories: readonly string[] | undefined,
  nextDirectories: readonly string[] | undefined,
): ToolPermissionContext {
  const previous = new Set((previousDirectories ?? []).map(normalizeDirectory))
  const next = new Set((nextDirectories ?? []).map(normalizeDirectory))
  if (previous.size === next.size && [...previous].every((dir) => next.has(dir))) return context

  const dirs = context.additionalWorkingDirectories
  const isProtected = (dir: string): boolean => {
    const source = dirs.get(dir)?.source
    return source !== undefined && PROTECTED_DIRECTORY_SOURCES.has(source)
  }

  const removed = [...previous].filter((dir) => !next.has(dir) && !isProtected(dir))
  const added = [...next].filter((dir) => !previous.has(dir) && !isProtected(dir))
  if (removed.length === 0 && added.length === 0) return context

  let updated = context
  if (removed.length > 0) {
    updated = applyPermissionUpdate(updated, {
      type: 'removeDirectories',
      directories: removed,
      destination: 'localSettings',
    })
  }
  if (added.length > 0) {
    updated = applyPermissionUpdate(updated, {
      type: 'addDirectories',
      directories: added,
      destination: 'localSettings',
    })
  }
  return updated
}

export function applySettingsChange(
  source: SettingSource,
  setAppState: (f: (prev: AppState) => AppState) => void,
): void {
  const newSettings = getInitialSettings()

  logForDebugging(`Settings changed from ${source}, updating app state`)

  const updatedRules = loadAllPermissionRulesFromDisk()
  updateHooksConfigSnapshot()

  setAppState((prev) => {
    let newContext = syncPermissionRulesFromDisk(prev.toolPermissionContext, updatedRules)
    newContext = reconcileAdditionalDirectories(
      newContext,
      prev.settings.permissions?.additionalDirectories,
      newSettings.permissions?.additionalDirectories,
    )

    // Ant-only: re-strip overly broad Bash allow rules after settings sync
    if (process.env.USER_TYPE === 'ant' && process.env.CLAUDE_CODE_ENTRYPOINT !== 'local-agent') {
      const overlyBroad = findOverlyBroadBashPermissions(updatedRules, [])
      if (overlyBroad.length > 0) {
        newContext = removeDangerousPermissions(newContext, overlyBroad)
      }
    }

    if (newContext.isBypassPermissionsModeAvailable && isBypassPermissionsModeDisabled()) {
      newContext = createDisabledBypassPermissionsContext(newContext)
    }

    newContext = transitionPlanAutoMode(newContext)

    // Sync effortLevel from settings to top-level AppState when it changes
    // (e.g. via applyFlagSettings from IDE). Only propagate if the setting
    // itself changed — otherwise unrelated settings churn (e.g. tips dismissal
    // on startup) would clobber a --effort CLI flag value held in AppState.
    const prevEffort = prev.settings.effortLevel
    const newEffort = newSettings.effortLevel
    const effortChanged = prevEffort !== newEffort

    return {
      ...prev,
      settings: newSettings,
      toolPermissionContext: newContext,
      // Only propagate a defined new value — when the disk key is absent
      // (e.g. /effort max for non-ants writes undefined; --effort CLI flag),
      // prev.settings.effortLevel can be stale (internal writes suppress the
      // watcher that would resync AppState.settings), so effortChanged would
      // be true and we'd wipe a session-scoped value held in effortValue.
      ...(effortChanged && newEffort !== undefined ? { effortValue: newEffort } : {}),
    }
  })
}
