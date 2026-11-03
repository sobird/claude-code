import * as React from 'react'

import type { LocalJSXCommandContext } from '../../commands.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { Text } from '../../ink.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { applyAutocompactWindow, showAutocompactWindow } from './window.js'

function AutocompactDialog({
  onDone,
  context,
}: {
  onDone: LocalJSXCommandOnDone
  context: LocalJSXCommandContext
}): React.ReactNode {
  const model = context.options.mainLoopModel
  const settingsWindow = context.getAppState().autoCompactWindow
  return (
    <Dialog title="Auto-compact window" onCancel={() => onDone()} hideInputGuide>
      <Text>{showAutocompactWindow(model, settingsWindow)}</Text>
      <Text dimColor>Press Esc to close.</Text>
    </Dialog>
  )
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args?: string,
): Promise<React.ReactNode> {
  const trimmed = args?.trim() || ''
  if (trimmed) {
    onDone(applyAutocompactWindow(trimmed, context))
    return null
  }
  return <AutocompactDialog onDone={onDone} context={context} />
}
