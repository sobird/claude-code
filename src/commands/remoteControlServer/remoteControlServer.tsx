import { homedir } from 'node:os'
import { resolve } from 'node:path'

import * as React from 'react'
import { useEffect, useState } from 'react'

import { getOriginalCwd } from '../../bootstrap/state.js'
import { getBridgeAccessToken } from '../../bridge/bridgeConfig.js'
import { getBridgeDisabledReason } from '../../bridge/bridgeEnabled.js'
import { BRIDGE_LOGIN_INSTRUCTION } from '../../bridge/types.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { ListItem } from '../../components/design-system/ListItem.js'
import { useRegisterOverlay } from '../../context/overlayContext.js'
import { type DaemonStateData, queryDaemonStatus, stopDaemonByPid } from '../../daemon/state.js'
import { Box, Text } from '../../ink.js'
import { useKeybindings } from '../../keybindings/useKeybinding.js'
import type { ToolUseContext } from '../../Tool.js'
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js'
import { buildCliLaunch, spawnCli } from '../../utils/cliLaunch.js'
import { errorMessage } from '../../utils/errors.js'
import { findCanonicalGitRoot } from '../../utils/git.js'

type ServerStatus = 'checking' | 'starting' | 'running'

type Props = {
  onDone: LocalJSXCommandOnDone
}

/** Time to let a spawn failure surface before we start polling the state file. */
const SPAWN_ERROR_GRACE_MS = 500
/** How long the detached supervisor may take to record itself as running. */
const STARTUP_TIMEOUT_MS = 15_000
const STARTUP_POLL_INTERVAL_MS = 200
/** Extra time to let a spawned worker hit a permanent error before reporting success. */
const WORKER_SETTLE_GRACE_MS = 2_000

/**
 * `/remote-control-server` — manage the daemon-backed bridge server.
 *
 * Starting spawns the same detached supervisor the assistant installer uses;
 * status and stop go through the state file so they work from any CLI process,
 * not just the one that started it. The command is only registered when the
 * DAEMON and BRIDGE_MODE features are on (see commands.ts).
 */
function RemoteControlServer({ onDone }: Props): React.ReactNode {
  const [status, setStatus] = useState<ServerStatus>('checking')
  const [pid, setPid] = useState<number | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const existing = await queryDaemonStatus()
      if (cancelled) return
      if (existing.status === 'running') {
        setPid(existing.state?.pid)
        setStatus('running')
        return
      }

      const checkError = await checkPrerequisites()
      if (cancelled) return
      if (checkError) {
        onDone(checkError, { display: 'system' })
        return
      }

      setStatus('starting')
      try {
        await startDaemon()
      } catch (error) {
        if (!cancelled) {
          onDone(`Remote Control Server failed to start: ${errorMessage(error)}`, { display: 'system' })
        }
        return
      }
      if (cancelled) return

      const started = await waitForDaemonRunning(STARTUP_TIMEOUT_MS)
      if (cancelled) return
      if (!started) {
        onDone('Remote Control Server did not start. Run `claude daemon status` for details.', {
          display: 'system',
        })
        return
      }

      const settled = await waitForWorkerSettled(started, WORKER_SETTLE_GRACE_MS)
      if (cancelled) return
      if (settled.parkedWorkers?.length) {
        onDone(
          `Remote Control Server started but its worker is parked: ${settled.lastError ?? 'unknown error'}. Run \`claude daemon status\` for details.`,
          { display: 'system' },
        )
      } else {
        onDone(`Remote Control Server started (PID: ${settled.pid}). Run /remote-control-server again to manage it.`, {
          display: 'system',
        })
      }
    })()
    return () => {
      cancelled = true
    }
    // Mount-only: onDone is provided once per command render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (status === 'running') {
    return <ServerManagementDialog pid={pid} onDone={onDone} />
  }
  return null
}

/** Shown when the daemon is already running: stop, restart, or keep it. */
function ServerManagementDialog({ pid, onDone }: Props & { pid: number | undefined }): React.ReactNode {
  useRegisterOverlay('remote-control-server-dialog')
  const [focusIndex, setFocusIndex] = useState(2)
  const [busy, setBusy] = useState(false)

  function finish(message: string): void {
    onDone(message, { display: 'system' })
  }

  async function handleStop(): Promise<void> {
    if (busy) return
    setBusy(true)
    const stopped = await stopDaemonByPid()
    finish(stopped ? 'Remote Control Server stopped.' : 'Remote Control Server is not running.')
  }

  async function handleRestart(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      await stopDaemonByPid()
      await startDaemon()
      const started = await waitForDaemonRunning(STARTUP_TIMEOUT_MS)
      if (!started) {
        finish('Remote Control Server did not restart. Run `claude daemon status` for details.')
        return
      }
      const settled = await waitForWorkerSettled(started, WORKER_SETTLE_GRACE_MS)
      if (settled.parkedWorkers?.length) {
        finish(`Remote Control Server restarted, but its worker is parked: ${settled.lastError ?? 'unknown error'}.`)
      } else {
        finish(`Remote Control Server restarted (PID: ${settled.pid}).`)
      }
    } catch (error) {
      finish(`Failed to restart: ${errorMessage(error)}`)
    }
  }

  function handleContinue(): void {
    onDone(undefined, { display: 'skip' })
  }

  const ITEM_COUNT = 3

  useKeybindings(
    {
      'select:next': () => setFocusIndex((i) => (i + 1) % ITEM_COUNT),
      'select:previous': () => setFocusIndex((i) => (i - 1 + ITEM_COUNT) % ITEM_COUNT),
      'select:accept': () => {
        if (busy) return
        if (focusIndex === 0) void handleStop()
        else if (focusIndex === 1) void handleRestart()
        else handleContinue()
      },
    },
    { context: 'Select' },
  )

  return (
    <Dialog title="Remote Control Server" onCancel={handleContinue} hideInputGuide>
      <Box flexDirection="column" gap={1}>
        <Text>
          Remote Control Server is <Text bold>running</Text>
          {pid === undefined ? '' : ` (PID: ${pid})`}
        </Text>
        <Box flexDirection="column">
          <ListItem isFocused={focusIndex === 0}>
            <Text>Stop server</Text>
          </ListItem>
          <ListItem isFocused={focusIndex === 1}>
            <Text>Restart server</Text>
          </ListItem>
          <ListItem isFocused={focusIndex === 2}>
            <Text>Continue</Text>
          </ListItem>
        </Box>
        <Text dimColor>Enter to select · Esc to continue</Text>
      </Box>
    </Dialog>
  )
}

/** Same entitlement gate as the interactive `/remote-control` command. */
async function checkPrerequisites(): Promise<string | null> {
  const disabledReason = await getBridgeDisabledReason()
  if (disabledReason) return disabledReason
  if (!getBridgeAccessToken()) return BRIDGE_LOGIN_INSTRUCTION
  return null
}

/**
 * Spawns the supervisor detached so it outlives this CLI session. Rejects on
 * a spawn error; resolves after a short grace period otherwise.
 */
async function startDaemon(): Promise<void> {
  // Same workspace the assistant installer uses: the canonical git root (or the
  // launching cwd) so the worker's trust check matches the session's trust key.
  const originalCwd = getOriginalCwd()
  const dir = findCanonicalGitRoot(originalCwd) ?? resolve(originalCwd)

  // Home-dir trust is session-only (TrustDialog), so a fresh worker there fails
  // the trust check and parks. Fail here instead of launching a dead daemon.
  if (resolve(dir) === resolve(homedir())) {
    throw new Error(
      'Run `claude` from a project directory (not your home folder) so the daemon workspace can stay trusted.',
    )
  }

  const child = spawnCli(buildCliLaunch(['daemon', 'start', `--dir=${dir}`]), {
    cwd: dir,
    stdio: 'ignore',
    detached: true,
  })
  child.unref()

  await new Promise<void>((resolveWait, rejectWait) => {
    child.once('error', (error) => rejectWait(new Error(`Failed to start daemon: ${error.message}`)))
    setTimeout(resolveWait, SPAWN_ERROR_GRACE_MS)
  })
}

/**
 * Polls the state file until the supervisor records itself as running. A single
 * check right after spawning would report a false failure on slow machines —
 * the detached supervisor needs a moment to boot and write the file.
 */
async function waitForDaemonRunning(timeoutMs: number): Promise<DaemonStateData | undefined> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const result = await queryDaemonStatus()
    if (result.status === 'running') return result.state
    if (Date.now() >= deadline) return undefined
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, STARTUP_POLL_INTERVAL_MS))
  }
}

/**
 * The supervisor records itself as running before its worker boots, so a worker
 * that parks immediately (trust, entitlements) would otherwise be reported as a
 * healthy server. Re-read the state file for a short grace period and let the
 * caller surface `parkedWorkers` / `lastError` instead.
 */
async function waitForWorkerSettled(state: DaemonStateData, timeoutMs: number): Promise<DaemonStateData> {
  const deadline = Date.now() + timeoutMs
  let current = state
  for (;;) {
    if (current.parkedWorkers?.length || Date.now() >= deadline) return current
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, STARTUP_POLL_INTERVAL_MS))
    const next = await queryDaemonStatus()
    if (next.status !== 'running' || !next.state) return current
    current = next.state
  }
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: ToolUseContext & LocalJSXCommandContext,
  _args: string,
): Promise<React.ReactNode> {
  return <RemoteControlServer onDone={onDone} />
}
