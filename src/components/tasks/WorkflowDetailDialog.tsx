import figures from 'figures'
import React, { useState } from 'react'
import type { DeepImmutable } from 'src/types/utils.js'

import type { CommandResultDisplay } from '../../commands.js'
import { useElapsedTime } from '../../hooks/useElapsedTime.js'
import { Box, Text } from '../../ink.js'
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js'
import { useKeybindings } from '../../keybindings/useKeybinding.js'
import type { LocalWorkflowTaskState, WorkflowAgentState } from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import { Byline } from '../design-system/Byline.js'
import { Dialog } from '../design-system/Dialog.js'
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js'

export type WorkflowDetailDialogProps = {
  workflow: DeepImmutable<LocalWorkflowTaskState>
  onDone: (result?: string, options?: { display?: CommandResultDisplay }) => void
  onKill?: () => void
  onSkipAgent?: (agentId: string) => void
  onRetryAgent?: (agentId: string) => void
  onBack: () => void
}

function isActive(status: WorkflowAgentState['status']): boolean {
  return status === 'running' || status === 'pending'
}

function isRetryable(status: WorkflowAgentState['status']): boolean {
  return status === 'failed' || status === 'skipped' || status === 'killed'
}

export function WorkflowDetailDialog({
  workflow,
  onDone,
  onKill,
  onSkipAgent,
  onRetryAgent,
  onBack,
}: WorkflowDetailDialogProps): React.ReactNode {
  const elapsedTime = useElapsedTime(
    workflow.startTime,
    workflow.status === 'running',
    1000,
    workflow.totalPausedMs ?? 0,
  )
  const agents = workflow.agents ?? []
  const [rawSelectedIndex, setRawSelectedIndex] = useState(0)
  const selectedIndex = Math.min(rawSelectedIndex, Math.max(0, agents.length - 1))
  const selected = agents[selectedIndex]

  // Dialog handles confirm:no (Esc) → onCancel.
  useKeybindings({ 'confirm:yes': onDone }, { context: 'Confirmation' })

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === ' ') {
      e.preventDefault()
      onDone()
    } else if (e.key === 'left') {
      e.preventDefault()
      onBack()
    } else if (e.key === 'up') {
      e.preventDefault()
      setRawSelectedIndex((prev) => Math.max(0, prev - 1))
    } else if (e.key === 'down') {
      e.preventDefault()
      setRawSelectedIndex((prev) => Math.min(agents.length - 1, prev + 1))
    } else if (e.key === 'x' && workflow.status === 'running' && onKill) {
      e.preventDefault()
      onKill()
    } else if (e.key === 's' && workflow.status === 'running' && selected && isActive(selected.status) && onSkipAgent) {
      e.preventDefault()
      onSkipAgent(selected.id)
    } else if (
      e.key === 'r' &&
      workflow.status === 'running' &&
      selected &&
      isRetryable(selected.status) &&
      onRetryAgent
    ) {
      e.preventDefault()
      onRetryAgent(selected.id)
    }
  }

  const title = workflow.workflowName ?? workflow.summary ?? workflow.description

  return (
    <Box flexDirection="column" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      <Dialog
        title={title}
        subtitle={
          <Text dimColor>
            {elapsedTime} · {workflow.agentCount} {workflow.agentCount === 1 ? 'agent' : 'agents'}
          </Text>
        }
        onCancel={onDone}
        color="background"
        inputGuide={(exitState) =>
          exitState.pending ? (
            <Text>Press {exitState.keyName} again to exit</Text>
          ) : (
            <Byline>
              <KeyboardShortcutHint shortcut="←" action="go back" />
              <KeyboardShortcutHint shortcut="Esc/Enter/Space" action="close" />
              {workflow.status === 'running' && onKill && <KeyboardShortcutHint shortcut="x" action="stop" />}
              {workflow.status === 'running' && selected && isActive(selected.status) && onSkipAgent && (
                <KeyboardShortcutHint shortcut="s" action="skip agent" />
              )}
              {workflow.status === 'running' && selected && isRetryable(selected.status) && onRetryAgent && (
                <KeyboardShortcutHint shortcut="r" action="retry agent" />
              )}
              {agents.length > 1 && <KeyboardShortcutHint shortcut="↑/↓" action="select" />}
            </Byline>
          )
        }
      >
        <Box flexDirection="column" gap={1}>
          <Text>
            <Text bold>Status:</Text>{' '}
            {workflow.status === 'running' ? (
              <Text color="background">running</Text>
            ) : workflow.status === 'completed' ? (
              <Text color="success">{workflow.status}</Text>
            ) : (
              <Text color="error">{workflow.status}</Text>
            )}
          </Text>

          <Box flexDirection="column">
            <Text bold dimColor>
              Agents
            </Text>
            {agents.length === 0 ? (
              <Text dimColor>{workflow.status === 'running' ? 'Starting…' : '(no agents)'}</Text>
            ) : (
              agents.map((agent, i) => (
                <Text key={agent.id} color={i === selectedIndex ? 'suggestion' : undefined}>
                  {i === selectedIndex ? figures.pointer + ' ' : '  '}
                  {agent.name ?? agent.id} <Text dimColor>· {agent.status}</Text>
                </Text>
              ))
            )}
          </Box>
        </Box>
      </Dialog>
    </Box>
  )
}
