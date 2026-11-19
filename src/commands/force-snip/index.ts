import type { Command } from '../../commands.js'

const forceSnip = {
  type: 'local',
  name: 'force-snip',
  description: 'Apply pending snip markers and drop removed messages from context',
  supportsNonInteractive: true,
  load: () => import('./force-snip.js'),
} satisfies Command

export default forceSnip
