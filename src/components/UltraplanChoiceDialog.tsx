import React, { useCallback } from 'react'
import { join } from 'path'
import { stat, writeFile } from 'fs/promises'
import figures from 'figures'
import {
  Box, Text, useInput, wrapText,
} from '../ink.js'
import { Select } from './CustomSelect/index.js'
import { Dialog } from './design-system/Dialog.js'
import type { AppState } from '../state/AppStateStore.js'
import type { Message } from '../types/message.js'
import type { FileStateCache } from '../utils/fileStateCache.js'
import { useSetAppState } from 'src/state/AppState.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'
import { archiveRemoteSession } from 'src/utils/teleport.js'
import { enqueuePendingNotification } from 'src/utils/messageQueueManager.js'
import { updateTaskState } from 'src/utils/task/framework.js'
import { getSessionId } from 'src/bootstrap/state.js'
import { clearConversation } from 'src/commands/clear/conversation.js'
import { createSystemMessage } from 'src/utils/messages.js'
import { getCwd } from 'src/utils/cwd.js'
import { toRelativePath } from 'src/utils/path.js'
import type { UUID } from 'crypto'
import { getTranscriptPath } from 'src/utils/sessionStorage.js'
import { useRegisterOverlay } from 'src/context/overlayContext.js'

type ChoiceValue = 'here' | 'fresh' | 'cancel'

interface Props {
  readonly plan: string
  readonly sessionId: string
  readonly taskId: string
  readonly setMessages: (action: React.SetStateAction<Message[]>) => void
  readonly readFileState: FileStateCache
  readonly memorySelector?: unknown
  readonly getAppState: () => AppState
  readonly setConversationId: (id: UUID) => void
  readonly resultDedupState?: unknown
}

/** Maximum visible lines for the plan preview. */
const MAX_VISIBLE_LINES = 24

/** Lines reserved for chrome around the preview (title bar, options, etc.). */
const CHROME_LINES = 11

function getDateStamp(): string {
  return new Date().toISOString().split('T')[0]
}

export function UltraplanChoiceDialog({
  plan,
  sessionId,
  taskId,
  setMessages,
  readFileState,
  memorySelector: _memorySelector,
  getAppState,
  setConversationId,
  resultDedupState: _resultDedupState,
}: Props): React.ReactNode {
  useRegisterOverlay('ultraplan-choice')

  const setAppState = useSetAppState()
  const [scrollOffset, setScrollOffset] = React.useState(0)
  const { rows, columns } = useTerminalSize()

  // Compute visible lines
  const visibleHeight = React.useMemo(
    () => Math.min(MAX_VISIBLE_LINES, Math.max(1, Math.floor(rows / 2) - CHROME_LINES)),
    [rows],
  )

  const wrappedLines = React.useMemo(
    () => wrapText(plan, Math.max(1, columns - 4), 'wrap').split('\n'),
    [plan, columns],
  )
  const maxOffset = Math.max(0, wrappedLines.length - visibleHeight)

  // Clamp scroll when maxOffset shrinks (e.g. terminal resize).
  React.useEffect(() => {
    setScrollOffset(prev => Math.min(prev, maxOffset))
  }, [maxOffset])

  const isScrollable = wrappedLines.length > visibleHeight

  // Scroll input handler
  useInput((input, key) => {
    if (!isScrollable) {
      return
    }
    const halfPage = Math.max(1, Math.floor(visibleHeight / 2))

    if ((key.ctrl && input === 'd') || key.wheelDown) {
      const step = key.wheelDown ? 3 : halfPage
      setScrollOffset(prev => Math.min(prev + step, maxOffset))
    } else if ((key.ctrl && input === 'u') || key.wheelUp) {
      const step = key.wheelUp ? 3 : halfPage
      setScrollOffset(prev => Math.max(prev - step, 0))
    }
  })

  // Visible slice
  const visibleText = wrappedLines.slice(scrollOffset, scrollOffset + visibleHeight).join('\n')

  const canScrollUp = scrollOffset > 0
  const canScrollDown = scrollOffset < maxOffset

  const handleChoice = useCallback(async (choice: ChoiceValue) => {
    const savePath = join(getCwd(), `${getDateStamp()}-ultraplan.md`)
    const previousSessionId = getSessionId()
    const transcriptSaved = await stat(getTranscriptPath()).then(() => true, () => false)

    switch (choice) {
      case 'here':
        enqueuePendingNotification({
          value: [
            'Ultraplan approved in browser. Here is the plan:',
            '',
            '<ultraplan>',
            plan,
            '</ultraplan>',
            '',
            'The user approved this plan in the remote session. Give them a brief summary, then start implementing.',
          ].join('\n'),
          mode: 'task-notification',
        })
        break
      case 'fresh':
        await clearConversation({
          setMessages,
          readFileState,
          getAppState,
          setAppState,
          setConversationId,
        })

        if (transcriptSaved) {
          setMessages(prev => [
            ...prev,
            createSystemMessage(`Previous session saved · resume with: claude --resume ${previousSessionId}`, 'suggestion'),
          ])
        }

        enqueuePendingNotification({
          value: `Here is the approved implementation plan:\n\n${plan}\n\nImplement this plan.`,
          mode: 'prompt',
        })
        break
      case 'cancel':
        await writeFile(savePath, plan, { encoding: 'utf-8' })
        setMessages(prev => [
          ...prev,
          createSystemMessage(`Ultraplan rejected · Plan saved to ${toRelativePath(savePath)}`, 'suggestion'),
        ])
        break
      default:
        break
    }

    // Mark the remote task as completed.
    updateTaskState(taskId, setAppState, task => (task.status === 'running' ? { ...task, status: 'completed', endTime: Date.now() } : task))

    // Clear the pending-choice state so the dialog unmounts.
    setAppState(prev => (prev.ultraplanPendingChoice
      ? { ...prev, ultraplanPendingChoice: undefined, ultraplanSessionUrl: undefined }
      : prev))

    // Archive the remote CCR session.
    await archiveRemoteSession(sessionId)
  }, [plan, sessionId, taskId, setMessages, getAppState, setAppState, readFileState, setConversationId])

  return (
    <Dialog
      title="Ultraplan approved"
      subtitle="How should the plan be implemented?"
      onCancel={() => {}}
      hideInputGuide
    >
      <Box flexDirection="column" marginBottom={1}>
        <Box flexDirection="column">
          <Text>{visibleText}</Text>
          {isScrollable
            ? (
              <Text dimColor>
              {canScrollUp ? figures.arrowUp : ' '}
              {canScrollDown ? figures.arrowDown : ' '}
              {scrollOffset + 1}
              –
              {Math.min(scrollOffset + visibleHeight, wrappedLines.length)}
              {' of '}
              {wrappedLines.length}
              {' · ctrl+u/ctrl+d to scroll'}
              </Text>
              )
            : null}
        </Box>

        <Select
          options={[
            {
              label: 'Implement here',
              value: 'here' as const,
              description: 'Inject plan into the current conversation',
            },
            {
              label: 'Start new session',
              value: 'fresh' as const,
              description: 'Clear conversation and start with only the plan',
            },
            {
              label: 'Cancel',
              value: 'cancel' as const,
              description: 'Don\'t implement — save plan and return',
            },
          ]}
          onChange={async value => handleChoice(value)}
        />
      </Box>
    </Dialog>
  )
}
