/**
 * `claude rollback` (ant-only) — install a previously published version.
 *
 * With no target, goes one version back from the running version. A numeric
 * target goes N versions back (`claude rollback 3`). Anything else is treated
 * as an explicit version. `--list` shows recent versions with their age.
 */

import { homedir } from 'node:os'

import { getLatestVersion, getVersionHistory, installGlobalPackage } from '../utils/autoUpdater.js'
import { execFileNoThrowWithCwd } from '../utils/execFileNoThrow.js'
import { formatRelativeTimeAgo } from '../utils/format.js'
import { jsonParse } from '../utils/slowOperations.js'

const HISTORY_LIMIT = 30
const VERSION_PATTERN = /^\d+\.\d+\.\d+/

export type RollbackOptions = {
  list?: boolean
  dryRun?: boolean
  safe?: boolean
}

/** Publish timestamps from the registry, keyed by version. */
async function getPublishTimes(): Promise<Record<string, string>> {
  const packageUrl = MACRO.NATIVE_PACKAGE_URL ?? MACRO.PACKAGE_URL
  const result = await execFileNoThrowWithCwd('npm', ['view', packageUrl, 'time', '--json', '--prefer-online'], {
    timeout: 30_000,
    cwd: homedir(),
  })
  if (result.code !== 0) return {}
  try {
    const parsed = jsonParse(result.stdout.trim()) as Record<string, unknown>
    const times: Record<string, string> = {}
    for (const [version, timestamp] of Object.entries(parsed)) {
      if (typeof timestamp === 'string') times[version] = timestamp
    }
    return times
  } catch {
    return {}
  }
}

function formatAge(timestamp: string | undefined): string {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  return ` (${formatRelativeTimeAgo(date)})`
}

async function listVersions(history: string[]): Promise<void> {
  const times = await getPublishTimes()
  console.log(`Recent versions (newest first):`)
  history.forEach((version, index) => {
    const current = version === MACRO.VERSION ? '  ← current' : ''
    console.log(`  ${index}: ${version}${formatAge(times[version])}${current}`)
  })
}

/**
 * Resolves which version the user asked for. Numeric targets are offsets from
 * the running version, matching the command's help text.
 */
function resolveVersion(target: string | undefined, history: string[]): string | null {
  const currentIndex = history.indexOf(MACRO.VERSION)

  if (target === undefined) {
    if (currentIndex === -1) return history[0] ?? null
    return history[currentIndex + 1] ?? null
  }

  if (/^\d+$/.test(target)) {
    const back = Number.parseInt(target, 10)
    if (currentIndex === -1) return history[back] ?? null
    return history[currentIndex + back] ?? null
  }

  return VERSION_PATTERN.test(target) ? target : null
}

export async function rollback(target?: string, options?: RollbackOptions): Promise<void> {
  const history = await getVersionHistory(HISTORY_LIMIT)
  if (history.length === 0) {
    console.error('Unable to fetch published versions. Check your npm registry access and try again.')
    process.exitCode = 1
    return
  }

  if (options?.list) {
    await listVersions(history)
    return
  }

  let version: string | null
  if (options?.safe) {
    // The incident-pinned safe version is served through the stable channel
    // pointer; fall back to it when oncall hasn't pinned anything separately.
    version = await getLatestVersion('stable')
    if (!version) {
      console.error('Unable to resolve the server-pinned safe version.')
      process.exitCode = 1
      return
    }
  } else {
    version = resolveVersion(target, history)
    if (!version) {
      console.error(
        target === undefined
          ? `Unable to determine the previous version for ${MACRO.VERSION}.`
          : `Unable to resolve rollback target "${target}".`,
      )
      process.exitCode = 1
      return
    }
  }

  if (version === MACRO.VERSION) {
    console.log(`Already running ${MACRO.VERSION}; nothing to roll back.`)
    return
  }

  if (options?.dryRun) {
    console.log(`Would roll back ${MACRO.VERSION} → ${version}.`)
    return
  }

  console.log(`Rolling back ${MACRO.VERSION} → ${version}...`)
  const status = await installGlobalPackage(version)

  switch (status) {
    case 'success':
      console.log(`Rolled back to ${version}. Restart Claude Code to use the older version.`)
      break
    case 'no_permissions':
      console.error('Insufficient permissions to install the package globally.')
      process.exitCode = 1
      break
    case 'in_progress':
      console.error('Another install is in progress. Try again once it finishes.')
      process.exitCode = 1
      break
    case 'install_failed':
      console.error(`Failed to install ${version}.`)
      process.exitCode = 1
      break
  }
}
