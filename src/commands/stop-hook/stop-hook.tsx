import * as React from 'react'
import { useState } from 'react'

import { getSessionId } from '../../bootstrap/state.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import TextInput from '../../components/TextInput.js'
import type { ExitState } from '../../hooks/useExitOnCtrlCDWithKeybindings.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { Box, Text } from '../../ink.js'
import type { KeyboardEvent } from '../../ink/events/keyboard-event.js'
import { useKeybinding } from '../../keybindings/useKeybinding.js'
import type { PromptHook } from '../../schemas/hooks.js'
import { logEvent } from '../../services/analytics/index.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { addSessionHook, getSessionHooks, removeSessionHook } from '../../utils/hooks/sessionHooks.js'

type Props = {
  initialPrompt: string
  existingHookPresent: boolean
  onSubmit: (prompt: string) => void
  onCancel: () => void
}

function StopHookDialog({ initialPrompt, existingHookPresent, onSubmit, onCancel }: Props): React.ReactNode {
  const [value, setValue] = useState(initialPrompt)
  const [cursorOffset, setCursorOffset] = useState(initialPrompt.length)
  const [mode, setMode] = useState<'input' | 'delete'>('input')
  const { columns } = useTerminalSize()

  const trimmed = value.trim()
  const isEmpty = trimmed.length === 0
  // Empty input means "delete" when a hook exists, and is a no-op otherwise.
  const deleteBlocked = existingHookPresent && isEmpty

  const submit = (): void => {
    if (isEmpty && !deleteBlocked) return
    onSubmit(trimmed)
  }

  const clear = (): void => {
    onSubmit('')
  }

  const handleKeyDown = (e: KeyboardEvent): void => {
    if (!existingHookPresent) return
    if (e.key === 'tab') {
      e.preventDefault()
      setMode((previous) => (previous === 'input' ? 'delete' : 'input'))
      return
    }
    if (mode === 'delete' && e.key === 'return') {
      e.preventDefault()
      clear()
    }
  }

  useKeybinding('confirm:no', onCancel, { context: 'Settings', isActive: true })

  const inputGuide = (exitState: ExitState): React.ReactNode =>
    exitState.pending ? (
      <Text>Press {exitState.keyName} again to exit</Text>
    ) : (
      <Text>
        Enter to{' '}
        {mode === 'delete'
          ? 'delete hook'
          : deleteBlocked
            ? 'delete hook'
            : existingHookPresent
              ? 'update hook'
              : 'add hook'}
        {existingHookPresent ? ' · Tab to switch focus' : ''} · Esc to cancel
      </Text>
    )

  const editing = mode === 'input'

  return (
    <Box flexDirection="column" tabIndex={0} autoFocus onKeyDown={handleKeyDown}>
      <Dialog
        title="Set Stop hook (this session only)"
        subtitle="Enter a stopping condition. A good condition asks whether something has been done."
        color="permission"
        onCancel={onCancel}
        inputGuide={inputGuide}
        isCancelActive={false}
      >
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1} marginTop={1}>
            <Text>&gt;</Text>
            <TextInput
              value={value}
              onChange={setValue}
              onSubmit={submit}
              focus={editing}
              showCursor={editing}
              multiline={false}
              columns={columns - 4}
              cursorOffset={cursorOffset}
              onChangeCursorOffset={setCursorOffset}
              placeholder="e.g. Has Claude completed all requested tasks?"
              disableEscapeDoublePress
            />
          </Box>
          {existingHookPresent && (
            <Box marginTop={1}>
              <Text color={mode === 'delete' ? 'error' : undefined} dimColor={mode !== 'delete'}>
                {mode === 'delete' ? '› ' : '  '}Delete this hook
              </Text>
            </Box>
          )}
        </Box>
      </Dialog>
    </Box>
  )
}

/** Prompt-type Stop hooks with no matcher — the ones this command manages. */
function getSessionStopPromptHooks(appState: Parameters<typeof getSessionHooks>[0]): PromptHook[] {
  const matchers = getSessionHooks(appState, getSessionId(), 'Stop').get('Stop') ?? []
  const hooks: PromptHook[] = []
  for (const matcher of matchers) {
    if (matcher.matcher !== '') continue
    for (const hook of matcher.hooks) {
      if (hook.type === 'prompt') hooks.push(hook)
    }
  }
  return hooks
}

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  logEvent('tengu_stop_hook_command', {})
  const setAppState = context.setAppStateForTasks ?? context.setAppState
  const sessionId = getSessionId()
  const existingHooks = getSessionStopPromptHooks(context.getAppState())
  const existingPrompt = existingHooks[0]?.prompt
  const initialPrompt = args.trim() || existingPrompt || ''

  function submit(prompt: string): void {
    if (prompt.length === 0) {
      for (const hook of existingHooks) removeSessionHook(setAppState, sessionId, 'Stop', hook)
      if (existingHooks.length > 0) logEvent('tengu_stop_hook_removed', {})
      onDone(existingHooks.length > 0 ? 'Stop hook cleared' : 'Cancelled', { display: 'system' })
      return
    }
    if (existingPrompt === prompt) {
      onDone('Stop hook unchanged', { display: 'system' })
      return
    }
    for (const hook of existingHooks) removeSessionHook(setAppState, sessionId, 'Stop', hook)
    addSessionHook(setAppState, sessionId, 'Stop', '', { type: 'prompt', prompt })
    logEvent('tengu_stop_hook_added', { promptLength: prompt.length })
    onDone(existingHooks.length === 0 ? 'Stop hook set' : 'Stop hook updated', { display: 'system' })
  }

  function cancel(): void {
    onDone('Cancelled', { display: 'system' })
  }

  return (
    <StopHookDialog
      initialPrompt={initialPrompt}
      existingHookPresent={existingPrompt !== undefined}
      onSubmit={submit}
      onCancel={cancel}
    />
  )
}
