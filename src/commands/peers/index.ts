import type { Command } from '../../commands.js'

const peers = {
  type: 'local',
  name: 'peers',
  description: 'List other Claude Code sessions running on this machine',
  supportsNonInteractive: true,
  load: () => import('./peers.js'),
} satisfies Command

export default peers
