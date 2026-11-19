import { activateProactive, deactivateProactive, isProactiveActive } from '../proactive/index.js'
import type { Command, LocalCommandCall } from '../types/command.js'

const call: LocalCommandCall = async () => {
  if (isProactiveActive()) {
    deactivateProactive()
    return { type: 'text', value: 'Proactive mode disabled' }
  }
  activateProactive('command')
  return { type: 'text', value: 'Proactive mode enabled' }
}

const proactive = {
  type: 'local',
  name: 'proactive',
  description: 'Toggle proactive (autonomous) mode',
  supportsNonInteractive: false,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default proactive
