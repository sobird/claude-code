import { resolve } from 'node:path'

import * as React from 'react'
import { useEffect, useState } from 'react'

import { getBridgeAccessToken } from '../../bridge/bridgeConfig.js'
import { getBridgeDisabledReason } from '../../bridge/bridgeEnabled.js'
import { BRIDGE_LOGIN_INSTRUCTION } from '../../bridge/types.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { ListItem } from '../../components/design-system/ListItem.js'
import { useRegisterOverlay } from '../../context/overlayContext.js'
import { queryDaemonStatus, stopDaemonByPid } from '../../daemon/state.js'
import { Box, Text } from '../../ink.js'
import { useKeybindings } from '../../keybindings/useKeybinding.js'
import type { ToolUseContext } from '../../Tool.js'
import type { LocalJSXCommandContext, LocalJSXCommandOnDone } from '../../types/command.js'
import { buildCliLaunch, spawnCli } from '../../utils/cliLaunch.js'
import { errorMessage } from '../../utils/errors.js'

type ServerStatus = 'checking' | 'starting' | 'running'

type Props = {
  onDone: LocalJSXCommandOnDone
}

/** Time to let the detached supervisor write its state file (or fail). */
const STARTUP_WAIT_MS = 1500

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

      const after = await queryDaemonStatus()
      if (cancelled) return
      if (after.status === 'running') {
        const startedPid = after.state?.pid
        onDone(
          `Remote Control Server started${startedPid === undefined ? '' : ` (PID: ${startedPid})`}. Run /remote-control-server again to manage it.`,
          { display: 'system' },
        )
      } else {
        onDone('Remote Control Server did not start. Run `claude daemon status` for details.', {
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
      const after = await queryDaemonStatus()
      if (after.status === 'running') {
        finish(`Remote Control Server restarted${after.state ? ` (PID: ${after.state.pid})` : ''}.`)
      } else {
        finish('Remote Control Server did not restart. Run `claude daemon status` for details.')
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
  const dir = resolve('.')
  const child = spawnCli(buildCliLaunch(['daemon', 'start', `--dir=${dir}`]), {
    cwd: dir,
    stdio: 'ignore',
    detached: true,
  })
  child.unref()

  await new Promise<void>((resolveWait, rejectWait) => {
    child.once('error', (error) => rejectWait(new Error(`Failed to start daemon: ${error.message}`)))
    setTimeout(resolveWait, STARTUP_WAIT_MS)
  })
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: ToolUseContext & LocalJSXCommandContext,
  _args: string,
): Promise<React.ReactNode> {
  return <RemoteControlServer onDone={onDone} />
}
