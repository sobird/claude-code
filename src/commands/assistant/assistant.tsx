import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import React, { type ReactNode, useState } from 'react'

import { readDaemonConfig, writeDaemonConfig } from '../../assistant/sessionDiscovery.js'
import { getOriginalCwd } from '../../bootstrap/state.js'
import type { LocalJSXCommandContext } from '../../commands.js'
import { ConfigurableShortcutHint } from '../../components/ConfigurableShortcutHint.js'
import { Select } from '../../components/CustomSelect/index.js'
import { Byline } from '../../components/design-system/Byline.js'
import { KeyboardShortcutHint } from '../../components/design-system/KeyboardShortcutHint.js'
import TextInput from '../../components/TextInput.js'
import { useWizard } from '../../components/wizard/index.js'
import { WizardProvider } from '../../components/wizard/index.js'
import { WizardDialogLayout } from '../../components/wizard/WizardDialogLayout.js'
import { queryDaemonStatus } from '../../daemon/state.js'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall, LocalJSXCommandOnDone } from '../../types/command.js'
import { buildCliLaunch, spawnCli } from '../../utils/cliLaunch.js'
import { logForDebugging } from '../../utils/debug.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { errorMessage } from '../../utils/errors.js'
import { findCanonicalGitRoot } from '../../utils/git.js'

type InstallWizardData = {
  dir: string
}

export interface NewInstallWizardProps {
  defaultDir: string
  onInstalled: (dir: string) => void
  onCancel: () => void
  onError: (message: string) => void
}

/** Default install location: `~/.claude/assistant`. */
export async function computeDefaultInstallDir(): Promise<string> {
  return join(getClaudeConfigHomeDir(), 'assistant')
}

async function installAssistant(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  const existing = await readDaemonConfig()
  await writeDaemonConfig({
    installedDir: dir,
    installedAt: new Date().toISOString(),
    sessions: existing?.sessions ?? [],
  })
  await startDaemon()
}

/**
 * Starts the daemon supervisor detached in the trusted workspace (canonical git
 * root, else the launching cwd) so its worker can register a bridge
 * environment. The worker itself needs longer to create a session, so the
 * wizard only reports "starting up"; `claude assistant` discovers it later.
 */
async function startDaemon(): Promise<void> {
  const originalCwd = getOriginalCwd()
  const workDir = findCanonicalGitRoot(originalCwd) ?? resolve(originalCwd)

  const status = await queryDaemonStatus()
  if (status.status === 'running') {
    logForDebugging(`[assistant] daemon already running (pid ${status.state?.pid ?? 'unknown'})`)
    return
  }

  const child = spawnCli(buildCliLaunch(['daemon', 'start', `--dir=${workDir}`]), {
    cwd: workDir,
    stdio: 'ignore',
    detached: true,
  })
  child.unref()

  // Wait briefly so a spawn failure surfaces through onError; the worker still
  // needs several more seconds to register its bridge session.
  await new Promise<void>((resolveWait, rejectWait) => {
    child.once('error', (error) => rejectWait(new Error(`Failed to start daemon: ${error.message}`)))
    setTimeout(resolveWait, 1500)
  })
}

function InstallDirStep({ defaultDir }: { defaultDir: string }): ReactNode {
  const { goNext, updateWizardData, wizardData } = useWizard<InstallWizardData>()
  const [dir, setDir] = useState(wizardData.dir || defaultDir)
  const [error, setError] = useState<string | null>(null)
  const [cursorOffset, setCursorOffset] = useState(dir.length)

  const handleSubmit = (value: string): void => {
    const trimmed = value.trim()
    if (!trimmed) {
      setError('Enter an install directory')
      return
    }
    setError(null)
    updateWizardData({ dir: trimmed })
    goNext()
  }

  return (
    <WizardDialogLayout
      subtitle="Where should the assistant daemon be installed?"
      footerText={
        <Byline>
          <KeyboardShortcutHint shortcut="Type" action="enter a path" />
          <KeyboardShortcutHint shortcut="Enter" action="continue" />
          <ConfigurableShortcutHint action="confirm:no" context="Settings" fallback="Esc" description="go back" />
        </Byline>
      }
    >
      <Box flexDirection="column">
        <Text>Install directory:</Text>
        <Box marginTop={1}>
          <TextInput
            value={dir}
            onChange={setDir}
            onSubmit={handleSubmit}
            placeholder="~/.claude/assistant"
            columns={70}
            cursorOffset={cursorOffset}
            onChangeCursorOffset={setCursorOffset}
            focus
            showCursor
          />
        </Box>
        {error && (
          <Box marginTop={1}>
            <Text color="error">{error}</Text>
          </Box>
        )}
      </Box>
    </WizardDialogLayout>
  )
}

function ConfirmInstallStep(): ReactNode {
  const { goNext, cancel, wizardData } = useWizard<InstallWizardData>()

  return (
    <WizardDialogLayout
      subtitle="Confirm installation"
      footerText={
        <Byline>
          <KeyboardShortcutHint shortcut="↑↓" action="navigate" />
          <KeyboardShortcutHint shortcut="Enter" action="select" />
          <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
        </Byline>
      }
    >
      <Box flexDirection="column">
        <Text>
          The assistant daemon will be installed in <Text bold>{wizardData.dir}</Text>.
        </Text>
        <Box marginTop={1}>
          <Select
            options={[
              { value: 'install', label: 'Install assistant' },
              { value: 'cancel', label: 'Cancel' },
            ]}
            onChange={(value: string) => (value === 'install' ? goNext() : cancel())}
            onCancel={cancel}
          />
        </Box>
      </Box>
    </WizardDialogLayout>
  )
}

/**
 * Two-step installer: pick a directory, confirm, then write `daemon.json`.
 * Used by both `/assistant` and `claude assistant` when no daemon is installed.
 */
export function NewInstallWizard({ defaultDir, onInstalled, onCancel, onError }: NewInstallWizardProps): ReactNode {
  return (
    <WizardProvider<InstallWizardData>
      steps={[() => <InstallDirStep defaultDir={defaultDir} />, ConfirmInstallStep]}
      initialData={{ dir: defaultDir }}
      title="Install assistant"
      onComplete={async (data) => {
        try {
          await installAssistant(data.dir)
          onInstalled(data.dir)
        } catch (error) {
          onError(errorMessage(error))
        }
      }}
      onCancel={onCancel}
    />
  )
}

/**
 * `/assistant` — report the installed daemon, or walk the user through
 * installation when none is present.
 */
export const call: LocalJSXCommandCall = async (
  onDone: LocalJSXCommandOnDone,
  _context: LocalJSXCommandContext,
  _args: string,
): Promise<ReactNode> => {
  const config = await readDaemonConfig()
  if (config?.installedDir) {
    onDone(`Assistant is installed in ${config.installedDir}. Run \`claude assistant\` to connect.`, {
      display: 'system',
    })
    return null
  }

  const defaultDir = await computeDefaultInstallDir()
  return (
    <NewInstallWizard
      defaultDir={defaultDir}
      onInstalled={(dir) =>
        onDone(`Assistant installed in ${dir}. Run \`claude assistant\` in a few seconds to connect.`, {
          display: 'system',
        })
      }
      onCancel={() => onDone()}
      onError={(message) => onDone(`Installation failed: ${message}`, { display: 'system' })}
    />
  )
}
