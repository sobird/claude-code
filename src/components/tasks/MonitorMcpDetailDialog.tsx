import React from 'react'
import type { DeepImmutable } from 'src/types/utils.js'

import { useElapsedTime } from '../../hooks/useElapsedTime.js'
import { Box, Text } from '../../ink.js'
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js'
import { useKeybindings } from '../../keybindings/useKeybinding.js'
import type { MonitorMcpTaskState } from '../../tasks/MonitorMcpTask/MonitorMcpTask.js'
import { Byline } from '../design-system/Byline.js'
import { Dialog } from '../design-system/Dialog.js'
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js'

type Props = {
  task: DeepImmutable<MonitorMcpTaskState>
  onKill?: () => void
  onBack: () => void
}

export function MonitorMcpDetailDialog({ task, onKill, onBack }: Props): React.ReactNode {
  const elapsedTime = useElapsedTime(task.startTime, task.status === 'running', 1000, task.totalPausedMs ?? 0)

  // Dialog handles confirm:no (Esc) → onCancel. Wire confirm:yes (Enter/y) too.
  useKeybindings({ 'confirm:yes': onBack }, { context: 'Confirmation' })

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === ' ') {
      e.preventDefault()
      onBack()
    } else if (e.key === 'left') {
      e.preventDefault()
      onBack()
    } else if (e.key === 'x' && task.status === 'running' && onKill) {
      e.preventDefault()
      onKill()
    }
  }

  return (
    <Box flexDirection="column" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      <Dialog
        title="Monitor MCP"
        subtitle={
          <Text dimColor>
            {elapsedTime} · {task.status}
          </Text>
        }
        onCancel={onBack}
        color="background"
        inputGuide={(exitState) =>
          exitState.pending ? (
            <Text>Press {exitState.keyName} again to exit</Text>
          ) : (
            <Byline>
              <KeyboardShortcutHint shortcut="←" action="go back" />
              <KeyboardShortcutHint shortcut="Esc/Enter/Space" action="close" />
              {task.status === 'running' && onKill && <KeyboardShortcutHint shortcut="x" action="stop" />}
            </Byline>
          )
        }
      >
        <Box flexDirection="column" gap={1}>
          <Text>
            <Text bold>Watching:</Text> {task.description}
          </Text>
          <Text>
            <Text bold>Status:</Text>{' '}
            {task.status === 'running' ? (
              <Text color="background">running</Text>
            ) : task.status === 'completed' ? (
              <Text color="success">{task.status}</Text>
            ) : (
              <Text color="error">{task.status}</Text>
            )}
          </Text>
        </Box>
      </Dialog>
    </Box>
  )
}
