import type { LocalCommandCall } from '../../types/command.js'
import { applyAutocompactWindow, showAutocompactWindow } from './window.js'

export const call: LocalCommandCall = async (args, context) => {
  const trimmed = args.trim()
  const value = trimmed
    ? applyAutocompactWindow(trimmed, context)
    : showAutocompactWindow(context.options.mainLoopModel, context.getAppState().autoCompactWindow)
  return { type: 'text', value }
}
