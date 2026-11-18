import type { Command } from '../../commands.js'

const toggleMemory = {
  type: 'local',
  name: 'toggle-memory',
  description: 'Toggle automemory off/on for this session',
  // Ported from 2.1.90, where this ships disabled (`isEnabled: () => false`)
  // while the feature rolls out. Enable it so the toggle is reachable; see
  // docs/upgrade/2.1.90/notes.md.
  isHidden: false,
  supportsNonInteractive: false,
  userFacingName: () => 'toggle-memory',
  load: () => import('./toggleMemory.js'),
} satisfies Command

export default toggleMemory
